import { AppError, requireConfigured } from "../lib/errors";
import {
  assertShipCompliantTarget,
  type ProviderTargetPolicy,
  providerTargetPolicy,
} from "../provider-targets";
import type {
  ComplianceStatus,
  PostalAddress,
  WorkerEnv,
} from "../types";

const REQUEST_DEADLINE_MS = 1_800;
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const complianceProviderCache = new WeakMap<
  object,
  { fetcher: typeof fetch; provider: ComplianceProvider }
>();

export interface ComplianceCheckRequest {
  destination: PostalAddress;
  organizationId: string;
  origin: PostalAddress;
  recipient: {
    dateOfBirth?: string | null;
    name: string;
  };
  shipment: {
    bottleCount: number;
    chargeAmountCents: number;
    id: string;
    yearToDateBottleCount: number;
  };
}

export interface ComplianceCheckResult {
  checkedAt: string;
  evidence: {
    ageVerified: boolean | null;
    originToRecipientAllowed: boolean | null;
    recipientStateAllowed: boolean | null;
    rulesVersion: string | null;
    volumeWithinLimit: boolean | null;
  };
  provider: "shipcompliant" | "simulated";
  providerResponseId: string | null;
  reason: string | null;
  status: ComplianceStatus;
  taxEstimateCents: number | null;
}

export interface ComplianceProvider {
  checkShipment(
    input: ComplianceCheckRequest,
  ): Promise<ComplianceCheckResult>;
}

function canonicalFingerprintText(
  value: string | null | undefined,
  uppercase = false,
): string | null {
  const normalized = value
    ?.normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) return null;
  return uppercase ? normalized.toUpperCase() : normalized.toLocaleLowerCase("en-US");
}

function recipientAge(
  dateOfBirth: string | null | undefined,
  checkedAt: Date,
): number | null {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const birthDate = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (Number.isNaN(birthDate.getTime()) || birthDate > checkedAt) return null;
  let age = checkedAt.getUTCFullYear() - birthDate.getUTCFullYear();
  if (
    checkedAt.getUTCMonth() < birthDate.getUTCMonth() ||
    (checkedAt.getUTCMonth() === birthDate.getUTCMonth() &&
      checkedAt.getUTCDate() < birthDate.getUTCDate())
  ) {
    age -= 1;
  }
  return age >= 0 && age <= 130 ? age : null;
}

function canonicalAddress(address: PostalAddress): Record<string, string | null> {
  return {
    city: canonicalFingerprintText(address.city),
    country: canonicalFingerprintText(address.country, true),
    line1: canonicalFingerprintText(address.line1),
    line2: canonicalFingerprintText(address.line2),
    postalCode: canonicalFingerprintText(address.postalCode, true),
    state: canonicalFingerprintText(address.state, true),
  };
}

/**
 * Produces an audit-only content fingerprint without persisting the recipient's
 * name, date of birth, or full address. Age is evaluated as of the compliance
 * check so the fingerprint covers the legal-age input without retaining DOB.
 */
export async function complianceRequestFingerprint(
  input: ComplianceCheckRequest,
  checkedAt = new Date(),
): Promise<string> {
  const canonical = JSON.stringify({
    destination: canonicalAddress(input.destination),
    organizationId: input.organizationId,
    origin: canonicalAddress(input.origin),
    recipientAge: recipientAge(input.recipient.dateOfBirth, checkedAt),
    shipment: {
      bottleCount: input.shipment.bottleCount,
      chargeAmountCents: input.shipment.chargeAmountCents,
      id: input.shipment.id,
      yearToDateBottleCount: input.shipment.yearToDateBottleCount,
    },
    version: "vinifera-compliance-request-v1",
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function permitsLabelGeneration(
  status: ComplianceStatus,
): status is "compliant" {
  return status === "compliant";
}

export function withAuditableComplianceId(
  result: ComplianceCheckResult,
  idFactory: () => string = () => crypto.randomUUID(),
): ComplianceCheckResult {
  return result.providerResponseId
    ? result
    : {
        ...result,
        providerResponseId: `local-${idFactory()}`.slice(0, 255),
      };
}

interface OAuthToken {
  accessToken: string;
  expiresAt: number;
}

interface ShipCompliantConfiguration {
  accountId: string;
  appEnvironment: WorkerEnv["APP_ENV"];
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  checkPath: string;
  contractVersion: string;
  endpointMode: WorkerEnv["SHIPCOMPLIANT_ENDPOINT_MODE"];
  licenseId: string;
  targetPolicy?: ProviderTargetPolicy;
  tokenPath: string;
}

interface ShipCompliantResponse {
  age_verified?: unknown;
  origin_to_recipient_allowed?: unknown;
  reason?: unknown;
  recipient_state_allowed?: unknown;
  response_id?: unknown;
  rules_version?: unknown;
  status?: unknown;
  tax_estimate_cents?: unknown;
  volume_within_limit?: unknown;
}

function absoluteEndpoint(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:") {
    throw new AppError(
      503,
      "activation_required",
      "ShipCompliant endpoints must use HTTPS.",
    );
  }
  return new URL(path, base).toString();
}

function normalizedPath(value: string, label: string): string {
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new AppError(
      503,
      "activation_required",
      `${label} must be an absolute HTTPS API path.`,
    );
  }
  return path;
}

class ShipCompliantProviderError extends AppError {
  readonly failureKind: "provider-error" | "timeout";

  constructor(
    message: string,
    failureKind: "provider-error" | "timeout" = "provider-error",
  ) {
    super(502, "upstream_error", message);
    this.failureKind = failureKind;
  }
}

function providerFailure(
  message: string,
  failureKind: "provider-error" | "timeout" = "provider-error",
): AppError {
  return new ShipCompliantProviderError(message, failureKind);
}

function isDeadlineAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

export function isShipCompliantTimeout(error: unknown): boolean {
  return (
    error instanceof ShipCompliantProviderError &&
    error.failureKind === "timeout"
  );
}

function remainingRequestBudget(deadlineAt: number): number {
  return Math.max(1, Math.floor(deadlineAt - Date.now()));
}

function mapShipCompliantResponse(
  value: unknown,
  checkedAt = new Date(),
): ComplianceCheckResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      checkedAt: checkedAt.toISOString(),
      evidence: {
        ageVerified: null,
        originToRecipientAllowed: null,
        recipientStateAllowed: null,
        rulesVersion: null,
        volumeWithinLimit: null,
      },
      provider: "shipcompliant",
      providerResponseId: null,
      reason: "ShipCompliant returned an unrecognized response.",
      status: "unknown",
      taxEstimateCents: null,
    };
  }
  const response = value as ShipCompliantResponse;
  const providerResponseId =
    typeof response.response_id === "string" && response.response_id.trim()
      ? response.response_id.trim().slice(0, 500)
      : null;
  const reason =
    typeof response.reason === "string" && response.reason.trim()
      ? response.reason.trim().slice(0, 2_000)
      : null;
  const taxEstimateCents =
    typeof response.tax_estimate_cents === "number" &&
    Number.isInteger(response.tax_estimate_cents) &&
    response.tax_estimate_cents >= 0
      ? response.tax_estimate_cents
      : null;
  const status =
    response.status === "compliant" ||
    response.status === "non_compliant" ||
    response.status === "unknown"
      ? response.status
      : "unknown";
  const evidence = {
    ageVerified:
      typeof response.age_verified === "boolean"
        ? response.age_verified
        : null,
    originToRecipientAllowed:
      typeof response.origin_to_recipient_allowed === "boolean"
        ? response.origin_to_recipient_allowed
        : null,
    recipientStateAllowed:
      typeof response.recipient_state_allowed === "boolean"
        ? response.recipient_state_allowed
        : null,
    rulesVersion:
      typeof response.rules_version === "string" &&
      response.rules_version.trim()
        ? response.rules_version.trim().slice(0, 120)
        : null,
    volumeWithinLimit:
      typeof response.volume_within_limit === "boolean"
        ? response.volume_within_limit
        : null,
  };

  // A positive compliance decision is usable only when it is auditable and
  // includes the tax result required by the Phase 4 contract.
  if (
    status === "compliant" &&
    (!providerResponseId ||
      taxEstimateCents === null ||
      evidence.ageVerified !== true ||
      evidence.originToRecipientAllowed !== true ||
      evidence.recipientStateAllowed !== true ||
      !evidence.rulesVersion ||
      evidence.volumeWithinLimit !== true)
  ) {
    return {
      checkedAt: checkedAt.toISOString(),
      evidence,
      provider: "shipcompliant",
      providerResponseId,
      reason: "ShipCompliant returned an incomplete compliance decision.",
      status: "unknown",
      taxEstimateCents,
    };
  }
  if (
    status === "non_compliant" &&
    (!reason ||
      !providerResponseId ||
      taxEstimateCents === null ||
      !evidence.rulesVersion)
  ) {
    return {
      checkedAt: checkedAt.toISOString(),
      evidence,
      provider: "shipcompliant",
      providerResponseId,
      reason:
        "ShipCompliant returned an incomplete non-compliant decision.",
      status: "unknown",
      taxEstimateCents,
    };
  }
  if (status === "unknown" && !reason) {
    return {
      checkedAt: checkedAt.toISOString(),
      evidence,
      provider: "shipcompliant",
      providerResponseId,
      reason: "ShipCompliant could not provide a verified compliance decision.",
      status,
      taxEstimateCents,
    };
  }
  return {
    checkedAt: checkedAt.toISOString(),
    evidence,
    provider: "shipcompliant",
    providerResponseId,
    reason,
    status,
    taxEstimateCents,
  };
}

/**
 * The vendor transport and response mapping live behind this adapter because
 * ShipCompliant's shipment-compliance contract is account-gated. Activation
 * requires an explicit contract version and endpoint path; credentials alone
 * can never silently enable a guessed payload.
 */
export class ShipCompliantProvider implements ComplianceProvider {
  private token: OAuthToken | null = null;

  constructor(
    private readonly configuration: ShipCompliantConfiguration,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    assertShipCompliantTarget(
      {
        appEnvironment: configuration.appEnvironment,
        baseUrl: configuration.baseUrl,
        endpointMode: configuration.endpointMode,
      },
      configuration.targetPolicy ?? providerTargetPolicy,
    );
  }

  private async accessToken(deadlineAt: number): Promise<string> {
    if (
      this.token &&
      this.token.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()
    ) {
      return this.token.accessToken;
    }
    const tokenUrl = absoluteEndpoint(
      this.configuration.baseUrl,
      this.configuration.tokenPath,
    );
    let response: globalThis.Response;
    let payload: {
      access_token?: unknown;
      expires_in?: unknown;
    };
    try {
      response = await this.fetcher(tokenUrl, {
        body: new URLSearchParams({ grant_type: "client_credentials" }),
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from(
            `${this.configuration.apiKey}:${this.configuration.apiSecret}`,
          ).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(remainingRequestBudget(deadlineAt)),
      });
      payload = (await response.json().catch((error: unknown) => {
        if (isDeadlineAbort(error)) throw error;
        return {};
      })) as typeof payload;
    } catch (error) {
      if (isDeadlineAbort(error)) {
        throw providerFailure(
          "ShipCompliant authentication timed out.",
          "timeout",
        );
      }
      throw providerFailure("ShipCompliant authentication is unavailable.");
    }
    if (
      !response.ok ||
      typeof payload.access_token !== "string" ||
      !payload.access_token
    ) {
      throw providerFailure("ShipCompliant authentication was rejected.");
    }
    const expiresIn =
      typeof payload.expires_in === "number" &&
      Number.isFinite(payload.expires_in) &&
      payload.expires_in > 0
        ? payload.expires_in
        : 300;
    this.token = {
      accessToken: payload.access_token,
      expiresAt: Date.now() + Math.min(expiresIn, 3_600) * 1_000,
    };
    return this.token.accessToken;
  }

  async checkShipment(
    input: ComplianceCheckRequest,
  ): Promise<ComplianceCheckResult> {
    const deadlineAt = Date.now() + REQUEST_DEADLINE_MS;
    const accessToken = await this.accessToken(deadlineAt);
    if (Date.now() >= deadlineAt) {
      throw providerFailure(
        "ShipCompliant compliance verification timed out.",
        "timeout",
      );
    }
    const checkUrl = absoluteEndpoint(
      this.configuration.baseUrl,
      this.configuration.checkPath,
    );
    let response: globalThis.Response;
    let payload: unknown;
    try {
      response = await this.fetcher(checkUrl, {
        body: JSON.stringify({
          account_id: this.configuration.accountId,
          contract_version: this.configuration.contractVersion,
          destination: {
            city: input.destination.city,
            country: input.destination.country,
            line1: input.destination.line1,
            line2: input.destination.line2 ?? undefined,
            postal_code: input.destination.postalCode,
            state: input.destination.state,
          },
          license_id: this.configuration.licenseId,
          origin: {
            city: input.origin.city,
            country: input.origin.country,
            line1: input.origin.line1,
            line2: input.origin.line2 ?? undefined,
            postal_code: input.origin.postalCode,
            state: input.origin.state,
          },
          recipient: {
            date_of_birth: input.recipient.dateOfBirth ?? undefined,
            name: input.recipient.name,
          },
          shipment: {
            bottle_count: input.shipment.bottleCount,
            charge_amount_cents: input.shipment.chargeAmountCents,
            external_id: input.shipment.id,
            year_to_date_bottle_count:
              input.shipment.yearToDateBottleCount,
          },
        }),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-ShipCompliant-Contract-Version":
            this.configuration.contractVersion,
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(remainingRequestBudget(deadlineAt)),
      });
      payload = await response.json().catch((error: unknown) => {
        if (isDeadlineAbort(error)) throw error;
        return {};
      });
    } catch (error) {
      if (isDeadlineAbort(error)) {
        throw providerFailure(
          "ShipCompliant compliance verification timed out.",
          "timeout",
        );
      }
      throw providerFailure(
        "ShipCompliant compliance verification is unavailable.",
      );
    }
    if (!response.ok) {
      throw providerFailure("ShipCompliant rejected the compliance request.");
    }
    return mapShipCompliantResponse(payload);
  }
}

async function deterministicId(input: ComplianceCheckRequest): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${input.organizationId}:${input.shipment.id}:${input.destination.postalCode}`,
    ),
  );
  return Buffer.from(digest).toString("hex").slice(0, 24);
}

export class SimulatedComplianceProvider implements ComplianceProvider {
  async checkShipment(
    input: ComplianceCheckRequest,
  ): Promise<ComplianceCheckResult> {
    const postalCode = input.destination.postalCode;
    const status: ComplianceStatus = postalCode.endsWith("0000")
      ? "non_compliant"
      : postalCode.endsWith("9999")
        ? "unknown"
        : "compliant";
    return {
      checkedAt: new Date().toISOString(),
      evidence: {
        ageVerified: status === "compliant",
        originToRecipientAllowed: status === "compliant",
        recipientStateAllowed: status === "compliant",
        rulesVersion: "test-simulator-v1",
        volumeWithinLimit: status === "compliant",
      },
      provider: "simulated",
      providerResponseId: `simcompliance_${await deterministicId(input)}`,
      reason:
        status === "non_compliant"
          ? "Deterministic test compliance hold."
          : status === "unknown"
            ? "Deterministic test compliance uncertainty."
            : null,
      status,
      taxEstimateCents:
        status === "compliant" ? input.shipment.bottleCount * 125 : null,
    };
  }
}

export function createComplianceProvider(
  env: WorkerEnv,
  fetcher: typeof fetch = fetch,
): ComplianceProvider {
  const cached = complianceProviderCache.get(env);
  if (cached?.fetcher === fetcher) return cached.provider;
  let provider: ComplianceProvider;
  if (
    env.COMPLIANCE_PROVIDER === "simulated" &&
    env.APP_ENV === "test" &&
    env.COMPLIANCE_SIMULATOR_ENABLED === "true"
  ) {
    provider = new SimulatedComplianceProvider();
  } else if (env.COMPLIANCE_PROVIDER !== "shipcompliant") {
    throw new AppError(
      503,
      "activation_required",
      env.COMPLIANCE_PROVIDER === "simulated"
        ? "The compliance simulator is available only when APP_ENV=test and COMPLIANCE_SIMULATOR_ENABLED=true."
        : "ShipCompliant must be activated before alcohol labels can be generated.",
    );
  } else {
    provider = new ShipCompliantProvider({
      accountId: requireConfigured(
        env.SHIPCOMPLIANT_ACCOUNT_ID,
        "SHIPCOMPLIANT_ACCOUNT_ID",
      ),
      appEnvironment: env.APP_ENV,
      apiKey: requireConfigured(
        env.SHIPCOMPLIANT_API_KEY,
        "SHIPCOMPLIANT_API_KEY",
      ),
      apiSecret: requireConfigured(
        env.SHIPCOMPLIANT_API_SECRET,
        "SHIPCOMPLIANT_API_SECRET",
      ),
      baseUrl: requireConfigured(
        env.SHIPCOMPLIANT_BASE_URL,
        "SHIPCOMPLIANT_BASE_URL",
      ),
      checkPath: normalizedPath(
        requireConfigured(
          env.SHIPCOMPLIANT_CHECK_PATH,
          "SHIPCOMPLIANT_CHECK_PATH",
        ),
        "SHIPCOMPLIANT_CHECK_PATH",
      ),
      contractVersion: requireConfigured(
        env.SHIPCOMPLIANT_CONTRACT_VERSION,
        "SHIPCOMPLIANT_CONTRACT_VERSION",
      ),
      endpointMode: requireConfigured(
        env.SHIPCOMPLIANT_ENDPOINT_MODE,
        "SHIPCOMPLIANT_ENDPOINT_MODE",
      ) as WorkerEnv["SHIPCOMPLIANT_ENDPOINT_MODE"],
      licenseId: requireConfigured(
        env.SHIPCOMPLIANT_LICENSE_ID,
        "SHIPCOMPLIANT_LICENSE_ID",
      ),
      tokenPath: normalizedPath(
        requireConfigured(
          env.SHIPCOMPLIANT_TOKEN_PATH,
          "SHIPCOMPLIANT_TOKEN_PATH",
        ),
        "SHIPCOMPLIANT_TOKEN_PATH",
      ),
    }, fetcher);
  }
  complianceProviderCache.set(env, { fetcher, provider });
  return provider;
}
