import { AppError } from "../lib/errors";
import {
  providerRequest,
  requestIntegrationJson,
  type IntegrationRequestOptions,
} from "./http";

const RESEND_API_ORIGIN = "https://api.resend.com";
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,128}$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_LOCAL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/;

export interface BrandSenderIdentity {
  fromEmail: string;
  fromName: string;
}

export interface ResendDomainActivation {
  dnsRecords: Array<{
    name: string;
    record: string;
    status: string;
    type: string;
    value: string;
  }>;
  domain: string;
  providerIdentityId: string;
  status: "pending" | "verified";
}

interface ResendDomain {
  capabilities?: {
    sending?: string;
  };
  id?: string;
  name?: string;
  records?: Array<{
    name?: string;
    record?: string;
    status?: string;
    type?: string;
    value?: string;
  }>;
  status?: string;
}

interface ResendDomainClientOptions {
  fetcher?: (input: Request) => Promise<Response>;
  sleep?: IntegrationRequestOptions["sleep"];
}

export function senderDomain(value: string): string {
  const at = value.lastIndexOf("@");
  const local = value.slice(0, at);
  const domain = value.slice(at + 1).toLowerCase();
  const labels = domain.split(".");
  if (
    value !== value.trim().toLowerCase() ||
    value.length > 320 ||
    !EMAIL_LOCAL.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    domain.length > 253 ||
    labels.length < 2 ||
    labels.some((label) => !DOMAIN_LABEL.test(label))
  ) {
    throw new AppError(
      400,
      "invalid_request",
      "The brand sender email address is invalid.",
    );
  }
  return domain;
}

export function formatBrandSender(identity: BrandSenderIdentity): string {
  const fromName = identity.fromName.normalize("NFKC").trim();
  senderDomain(identity.fromEmail);
  if (
    !fromName ||
    fromName.length > 200 ||
    !/^[\p{L}\p{N}][\p{L}\p{N} &'.,-]{0,199}$/u.test(fromName)
  ) {
    throw new AppError(
      400,
      "invalid_request",
      "The brand sender name is invalid.",
    );
  }
  return `${fromName} <${identity.fromEmail}>`;
}

function safeDomain(input: ResendDomain, expectedDomain: string): ResendDomain {
  if (
    !PROVIDER_ID.test(String(input.id ?? "")) ||
    String(input.name ?? "").toLowerCase() !== expectedDomain
  ) {
    throw new AppError(
      502,
      "upstream_error",
      "The email provider returned an unsafe sender-domain identity.",
    );
  }
  return input;
}

export class ResendDomainsClient {
  constructor(
    private readonly apiKey: string,
    private readonly options: ResendDomainClientOptions = {},
  ) {
    if (!apiKey) {
      throw new AppError(
        503,
        "activation_required",
        "The Resend API key is required to activate a brand sender.",
      );
    }
  }

  private request<T>(path: string, init: RequestInit): Promise<T> {
    return requestIntegrationJson<T>({
      attempts: 2,
      fetcher: this.options.fetcher,
      request: providerRequest(`${RESEND_API_ORIGIN}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      }),
      sleep: this.options.sleep,
    });
  }

  private retrieve(id: string): Promise<ResendDomain> {
    if (!PROVIDER_ID.test(id)) {
      throw new AppError(
        503,
        "activation_required",
        "The stored email provider identity is invalid.",
      );
    }
    return this.request(`/domains/${encodeURIComponent(id)}`, {
      method: "GET",
    });
  }

  async activate(
    fromEmail: string,
    providerIdentityId?: string | null,
  ): Promise<ResendDomainActivation> {
    const domain = senderDomain(fromEmail);
    let identity: ResendDomain | undefined;
    if (providerIdentityId) {
      identity = safeDomain(await this.retrieve(providerIdentityId), domain);
    } else {
      const listed = await this.request<{ data?: ResendDomain[] }>(
        "/domains?limit=100",
        { method: "GET" },
      );
      identity = (listed.data ?? []).find(
        (candidate) => String(candidate.name ?? "").toLowerCase() === domain,
      );
      if (identity) {
        identity = safeDomain(identity, domain);
      } else {
        identity = safeDomain(
          await this.request<ResendDomain>("/domains", {
            body: JSON.stringify({ name: domain }),
            method: "POST",
          }),
          domain,
        );
      }
    }
    const id = String(identity.id);
    if (
      identity.status !== "verified" ||
      identity.capabilities?.sending !== "enabled"
    ) {
      await this.request(`/domains/${encodeURIComponent(id)}/verify`, {
        method: "POST",
      });
      identity = safeDomain(await this.retrieve(id), domain);
    }
    const verified =
      identity.status === "verified" &&
      identity.capabilities?.sending === "enabled";
    return {
      dnsRecords: (identity.records ?? []).slice(0, 20).map((record) => ({
        name: String(record.name ?? "").slice(0, 253),
        record: String(record.record ?? "").slice(0, 32),
        status: String(record.status ?? "").slice(0, 32),
        type: String(record.type ?? "").slice(0, 16),
        value: String(record.value ?? "").slice(0, 2_048),
      })),
      domain,
      providerIdentityId: id,
      status: verified ? "verified" : "pending",
    };
  }
}
