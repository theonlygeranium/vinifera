import { createHash } from "node:crypto";

import { AppError } from "../lib/errors";
import {
  IntegrationProviderError,
  providerRequest,
  requestIntegrationJson,
  type IntegrationRequestOptions,
} from "./http";

export const QUICKBOOKS_MINOR_VERSION = "75";

export interface QuickBooksCredentials {
  accessToken: string;
  accessTokenExpiresAt: string;
  realmId: string;
  refreshToken: string;
  refreshTokenExpiresAt?: string | null;
}

export interface QuickBooksOAuthConfiguration {
  clientId: string;
  clientSecret: string;
  environment: "production" | "sandbox";
  redirectUri: string;
}

export interface QuickBooksReceipt {
  currencyCode: string;
  customerRef: string;
  depositAccountRef: string;
  docNumber: string;
  exchangeRate?: number | null;
  lines: Array<{
    amountCents: number;
    description: string;
    itemRef: string;
    quantity?: number;
    taxCodeRef?: string | null;
    unitPriceCents?: number;
  }>;
  privateNote: string;
  shippingAddress?: {
    city: string;
    country: string;
    line1: string;
    line2?: string | null;
    postalCode: string;
    state: string;
  } | null;
  taxCents: number;
  transactionDate: string;
}

interface QuickBooksClientOptions {
  fetcher?: (input: Request) => Promise<Response>;
  persistRotatedCredentials: (
    credentials: QuickBooksCredentials,
  ) => Promise<void>;
  sleep?: IntegrationRequestOptions["sleep"];
}

const refreshLocks = new Map<string, Promise<QuickBooksCredentials>>();

function cents(value: number): number {
  return Math.round(value) / 100;
}

export function quickBooksRequestId(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 8) {
    throw new AppError(
      400,
      "invalid_request",
      "QuickBooks idempotency identity is invalid.",
    );
  }
  // Intuit accepts at most 50 characters. Truncating a human-readable key can
  // discard the cumulative refund target, so use 160 bits of SHA-256 instead.
  return `vinifera_${createHash("sha256")
    .update(normalized, "utf8")
    .digest("hex")
    .slice(0, 40)}`;
}

export class QuickBooksClient {
  private credentials: QuickBooksCredentials;

  constructor(
    private readonly integrationId: string,
    credentials: QuickBooksCredentials,
    private readonly configuration: QuickBooksOAuthConfiguration,
    private readonly options: QuickBooksClientOptions,
  ) {
    if (
      !credentials.accessToken ||
      !credentials.refreshToken ||
      !credentials.realmId
    ) {
      throw new AppError(
        503,
        "activation_required",
        "QuickBooks OAuth must be connected before synchronization.",
      );
    }
    this.credentials = credentials;
  }

  private apiOrigin(): string {
    return this.configuration.environment === "production"
      ? "https://quickbooks.api.intuit.com"
      : "https://sandbox-quickbooks.api.intuit.com";
  }

  private async refreshCredentials(): Promise<QuickBooksCredentials> {
    const existing = refreshLocks.get(this.integrationId);
    if (existing) return existing;
    const refresh = (async () => {
      const response = await requestIntegrationJson<{
        access_token: string;
        expires_in: number;
        refresh_token: string;
        x_refresh_token_expires_in?: number;
      }>({
        attempts: 1,
        fetcher: this.options.fetcher,
        request: providerRequest(
          "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
          {
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: this.credentials.refreshToken,
            }),
            headers: {
              Accept: "application/json",
              Authorization: `Basic ${Buffer.from(
                `${this.configuration.clientId}:${this.configuration.clientSecret}`,
              ).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            method: "POST",
          },
        ),
        sleep: this.options.sleep,
      });
      const now = Date.now();
      const rotated: QuickBooksCredentials = {
        ...this.credentials,
        accessToken: response.access_token,
        accessTokenExpiresAt: new Date(
          now + Math.max(60, response.expires_in) * 1_000,
        ).toISOString(),
        refreshToken: response.refresh_token,
        refreshTokenExpiresAt: response.x_refresh_token_expires_in
          ? new Date(
              now + response.x_refresh_token_expires_in * 1_000,
            ).toISOString()
          : this.credentials.refreshTokenExpiresAt,
      };
      // Rolling refresh tokens must be durably replaced before any caller uses
      // the new access token. A persistence failure leaves this client unusable.
      await this.options.persistRotatedCredentials(rotated);
      this.credentials = rotated;
      return rotated;
    })();
    refreshLocks.set(this.integrationId, refresh);
    try {
      return await refresh;
    } finally {
      if (refreshLocks.get(this.integrationId) === refresh) {
        refreshLocks.delete(this.integrationId);
      }
    }
  }

  private async accessToken(): Promise<string> {
    const expiresAt = Date.parse(this.credentials.accessTokenExpiresAt);
    if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 5 * 60 * 1_000) {
      return this.credentials.accessToken;
    }
    return (await this.refreshCredentials()).accessToken;
  }

  private receiptPayload(receipt: QuickBooksReceipt): Record<string, unknown> {
    return {
      CurrencyRef: { value: receipt.currencyCode.toUpperCase() },
      CustomerRef: { value: receipt.customerRef },
      DepositToAccountRef: { value: receipt.depositAccountRef },
      DocNumber: receipt.docNumber.slice(0, 21),
      ExchangeRate:
        receipt.currencyCode.toUpperCase() === "USD"
          ? undefined
          : receipt.exchangeRate,
      Line: receipt.lines.map((line, index) => ({
        Amount: cents(line.amountCents),
        Description: line.description.slice(0, 4_000),
        DetailType: "SalesItemLineDetail",
        LineNum: index + 1,
        SalesItemLineDetail: {
          ItemRef: { value: line.itemRef },
          Qty: line.quantity ?? 1,
          TaxCodeRef: line.taxCodeRef
            ? { value: line.taxCodeRef }
            : undefined,
          UnitPrice:
            line.unitPriceCents === undefined
              ? undefined
              : cents(line.unitPriceCents),
        },
      })),
      PrivateNote: receipt.privateNote.slice(0, 4_000),
      ShipAddr: receipt.shippingAddress
        ? {
            City: receipt.shippingAddress.city,
            Country: receipt.shippingAddress.country,
            CountrySubDivisionCode: receipt.shippingAddress.state,
            Line1: receipt.shippingAddress.line1,
            Line2: receipt.shippingAddress.line2 ?? undefined,
            PostalCode: receipt.shippingAddress.postalCode,
          }
        : undefined,
      TxnDate: receipt.transactionDate,
      TxnTaxDetail: { TotalTax: cents(receipt.taxCents) },
    };
  }

  async validateConnection(): Promise<void> {
    const url = new URL(
      `${this.apiOrigin()}/v3/company/${encodeURIComponent(
        this.credentials.realmId,
      )}/companyinfo/${encodeURIComponent(this.credentials.realmId)}`,
    );
    url.searchParams.set("minorversion", QUICKBOOKS_MINOR_VERSION);
    await requestIntegrationJson({
      attempts: 1,
      fetcher: this.options.fetcher,
      request: providerRequest(url.toString(), {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${await this.accessToken()}`,
        },
        method: "GET",
      }),
      sleep: this.options.sleep,
    });
  }

  private async writeReceipt(
    entity: "salesreceipt" | "refundreceipt",
    receipt: QuickBooksReceipt,
    idempotencyKey: string,
  ): Promise<{ id: string; syncToken: string | null }> {
    const requestId = quickBooksRequestId(idempotencyKey);
    const url = new URL(
      `${this.apiOrigin()}/v3/company/${encodeURIComponent(
        this.credentials.realmId,
      )}/${entity}`,
    );
    url.searchParams.set("minorversion", QUICKBOOKS_MINOR_VERSION);
    url.searchParams.set("requestid", requestId);
    const token = await this.accessToken();
    let payload: Record<string, unknown>;
    try {
      // Writes are attempted once. If the result is ambiguous, the read path
      // below checks the stable DocNumber before the durable job is retried.
      // The same provider requestid is retained across every job attempt.
      payload = await requestIntegrationJson<Record<string, unknown>>({
        attempts: 1,
        fetcher: this.options.fetcher,
        request: providerRequest(url.toString(), {
          body: JSON.stringify(this.receiptPayload(receipt)),
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
        sleep: this.options.sleep,
      });
    } catch (error) {
      const ambiguous =
        !(error instanceof IntegrationProviderError) || error.retryable;
      if (!ambiguous) throw error;
      const recovered = await this.findReceiptByDocNumber(
        entity,
        receipt.docNumber,
        token,
      );
      if (!recovered) throw error;
      return recovered;
    }
    const row = (payload[
      entity === "salesreceipt" ? "SalesReceipt" : "RefundReceipt"
    ] ?? {}) as Record<string, unknown>;
    const id = typeof row.Id === "string" ? row.Id : null;
    if (!id) {
      throw new AppError(
        502,
        "upstream_error",
        "QuickBooks did not return a persisted receipt identifier.",
      );
    }
    return {
      id,
      syncToken: typeof row.SyncToken === "string" ? row.SyncToken : null,
    };
  }

  private async findReceiptByDocNumber(
    entity: "salesreceipt" | "refundreceipt",
    docNumber: string,
    accessToken: string,
  ): Promise<{ id: string; syncToken: string | null } | null> {
    const entityName =
      entity === "salesreceipt" ? "SalesReceipt" : "RefundReceipt";
    const escapedDocNumber = docNumber
      .slice(0, 21)
      .replaceAll("\\", "\\\\")
      .replaceAll("'", "\\'");
    const url = new URL(
      `${this.apiOrigin()}/v3/company/${encodeURIComponent(
        this.credentials.realmId,
      )}/query`,
    );
    url.searchParams.set(
      "query",
      `select Id, SyncToken, DocNumber from ${entityName} where DocNumber = '${escapedDocNumber}' maxresults 1`,
    );
    url.searchParams.set("minorversion", QUICKBOOKS_MINOR_VERSION);
    const payload = await requestIntegrationJson<{
      QueryResponse?: Record<string, unknown>;
    }>({
      fetcher: this.options.fetcher,
      request: providerRequest(url.toString(), {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        method: "GET",
      }),
      sleep: this.options.sleep,
    });
    const rows = payload.QueryResponse?.[entityName];
    const row =
      Array.isArray(rows) && rows[0] && typeof rows[0] === "object"
        ? (rows[0] as Record<string, unknown>)
        : null;
    return row && typeof row.Id === "string"
      ? {
          id: row.Id,
          syncToken:
            typeof row.SyncToken === "string" ? row.SyncToken : null,
        }
      : null;
  }

  createSalesReceipt(
    receipt: QuickBooksReceipt,
    idempotencyKey: string,
  ): Promise<{ id: string; syncToken: string | null }> {
    return this.writeReceipt("salesreceipt", receipt, idempotencyKey);
  }

  createRefundReceipt(
    receipt: QuickBooksReceipt,
    idempotencyKey: string,
  ): Promise<{ id: string; syncToken: string | null }> {
    return this.writeReceipt("refundreceipt", receipt, idempotencyKey);
  }

  private async sumTransactionEntity(
    entity: "RefundReceipt" | "SalesReceipt",
    periodStart: string,
    periodEnd: string,
  ): Promise<number> {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "QuickBooks reconciliation requires ISO calendar dates.",
      );
    }
    const token = await this.accessToken();
    let startPosition = 1;
    let totalCents = 0;
    for (;;) {
      const url = new URL(
        `${this.apiOrigin()}/v3/company/${encodeURIComponent(
          this.credentials.realmId,
        )}/query`,
      );
      url.searchParams.set(
        "query",
        `select Id, TotalAmt, CurrencyRef from ${entity} where DocNumber like 'VIN-%' and TxnDate >= '${periodStart}' and TxnDate <= '${periodEnd}' startposition ${startPosition} maxresults 1000`,
      );
      url.searchParams.set("minorversion", QUICKBOOKS_MINOR_VERSION);
      const payload = await requestIntegrationJson<{
        QueryResponse?: Record<string, unknown>;
      }>({
        fetcher: this.options.fetcher,
        request: providerRequest(url.toString(), {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          method: "GET",
        }),
        sleep: this.options.sleep,
      });
      const rows = payload.QueryResponse?.[entity];
      const page = Array.isArray(rows)
        ? rows.filter(
            (row): row is Record<string, unknown> =>
              Boolean(row) && typeof row === "object",
          )
        : [];
      for (const row of page) {
        const total = Number(row.TotalAmt ?? 0);
        if (!Number.isFinite(total)) {
          throw new AppError(
            502,
            "upstream_error",
            "QuickBooks returned an invalid reconciliation amount.",
          );
        }
        totalCents += Math.round(total * 100);
      }
      if (page.length < 1_000) break;
      startPosition += page.length;
      if (startPosition > 100_000) {
        throw new AppError(
          502,
          "upstream_error",
          "QuickBooks reconciliation exceeded the supported monthly volume.",
        );
      }
    }
    return totalCents;
  }

  async getNetTransactionTotal(
    periodStart: string,
    periodEnd: string,
  ): Promise<number> {
    const [sales, refunds] = await Promise.all([
      this.sumTransactionEntity("SalesReceipt", periodStart, periodEnd),
      this.sumTransactionEntity("RefundReceipt", periodStart, periodEnd),
    ]);
    return sales - refunds;
  }
}

export function quickBooksAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://appcenter.intuit.com/connect/oauth2");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "com.intuit.quickbooks.accounting");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export async function exchangeQuickBooksAuthorizationCode(input: {
  code: string;
  configuration: QuickBooksOAuthConfiguration;
  fetcher?: (request: Request) => Promise<Response>;
  realmId: string;
}): Promise<QuickBooksCredentials> {
  const payload = await requestIntegrationJson<{
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    x_refresh_token_expires_in?: number;
  }>({
    attempts: 1,
    fetcher: input.fetcher,
    request: providerRequest(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      {
        body: new URLSearchParams({
          code: input.code,
          grant_type: "authorization_code",
          redirect_uri: input.configuration.redirectUri,
        }),
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from(
            `${input.configuration.clientId}:${input.configuration.clientSecret}`,
          ).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      },
    ),
  });
  if (
    !payload.access_token ||
    !payload.refresh_token ||
    !payload.expires_in
  ) {
    throw new AppError(
      502,
      "upstream_error",
      "QuickBooks OAuth did not return a complete token set.",
    );
  }
  const now = Date.now();
  return {
    accessToken: payload.access_token,
    accessTokenExpiresAt: new Date(
      now + Math.max(60, payload.expires_in) * 1_000,
    ).toISOString(),
    realmId: input.realmId,
    refreshToken: payload.refresh_token,
    refreshTokenExpiresAt: payload.x_refresh_token_expires_in
      ? new Date(
          now + payload.x_refresh_token_expires_in * 1_000,
        ).toISOString()
      : null,
  };
}
