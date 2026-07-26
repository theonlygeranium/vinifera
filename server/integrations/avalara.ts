import { AppError } from "../lib/errors";
import type { PostalAddress } from "../types";
import {
  IntegrationProviderError,
  providerRequest,
  requestIntegrationJson,
  type IntegrationRequestOptions,
} from "./http";

export interface AvalaraCredentials {
  accountId: string;
  baseUrl: string;
  companyCode: string;
  licenseKey: string;
}

export interface AvalaraTaxLine {
  amountCents: number;
  description: string;
  itemCode: string;
  quantity: number;
  taxCode: string;
}

export interface AvalaraTaxRequest {
  currencyCode: string;
  customerCode: string;
  destination: PostalAddress;
  entityUseCode?: string | null;
  exemptionNumber?: string | null;
  lines: AvalaraTaxLine[];
  origin: PostalAddress;
  transactionCode: string;
  transactionDate: string;
}

export interface AvalaraTaxQuote {
  code: string;
  currencyCode: string;
  jurisdictionSummary: Array<{
    jurisdictionName: string;
    jurisdictionType: string;
    rate: number;
    taxCents: number;
    taxableCents: number;
  }>;
  providerId: number | null;
  status: "Saved";
  taxCents: number;
  totalCents: number;
}

export interface AvalaraRefundRequest {
  refundDate: string;
  refundPercentage?: number;
  refundTransactionCode: string;
  refundType: "Full" | "Percentage";
  referenceCode: string;
}

export interface AvalaraRefundResult {
  code: string;
  jurisdictionSummary: AvalaraTaxQuote["jurisdictionSummary"];
  status: "Committed";
  taxCents: number;
  totalCents: number;
}

export interface AvalaraRefundOptions {
  reconcileFirst?: boolean;
}

interface AvalaraClientOptions {
  fetcher?: (input: Request) => Promise<Response>;
  sleep?: IntegrationRequestOptions["sleep"];
}

function dollars(cents: number): number {
  return Math.round(cents) / 100;
}

function address(value: PostalAddress): Record<string, unknown> {
  return {
    city: value.city,
    country: value.country.toUpperCase(),
    line1: value.line1,
    line2: value.line2 ?? undefined,
    postalCode: value.postalCode,
    region: value.state.toUpperCase(),
  };
}

export class AvalaraClient {
  private readonly baseUrl: string;

  constructor(
    private readonly credentials: AvalaraCredentials,
    private readonly options: AvalaraClientOptions = {},
  ) {
    if (
      !credentials.accountId ||
      !credentials.licenseKey ||
      !credentials.companyCode
    ) {
      throw new AppError(
        503,
        "activation_required",
        "Avalara credentials must be connected before tax calculation.",
      );
    }
    const parsed = new URL(credentials.baseUrl);
    if (parsed.protocol !== "https:") {
      throw new AppError(
        503,
        "activation_required",
        "Avalara must use an HTTPS endpoint.",
      );
    }
    this.baseUrl = parsed.origin;
  }

  private headers(): Headers {
    return new Headers({
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(
        `${this.credentials.accountId}:${this.credentials.licenseKey}`,
      ).toString("base64")}`,
      "Content-Type": "application/json",
      "X-Avalara-Client": "Vinifera; 0.5.0; REST; AvaTaxV2",
    });
  }

  async validateConnection(): Promise<void> {
    await requestIntegrationJson({
      attempts: 1,
      fetcher: this.options.fetcher,
      request: providerRequest(
        `${this.baseUrl}/api/v2/companies/${encodeURIComponent(
          this.credentials.companyCode,
        )}`,
        { headers: this.headers(), method: "GET" },
      ),
      sleep: this.options.sleep,
    });
  }

  async createTaxQuote(input: AvalaraTaxRequest): Promise<AvalaraTaxQuote> {
    if (!input.lines.length) {
      throw new AppError(
        400,
        "invalid_request",
        "Avalara tax calculation requires at least one product line.",
      );
    }
    const payload = await requestIntegrationJson<{
      code?: string;
      currencyCode?: string;
      id?: number;
      status?: string;
      summary?: Array<{
        jurisdictionName?: string;
        jurisdictionType?: string;
        rate?: number;
        tax?: number;
        taxable?: number;
      }>;
      totalAmount?: number;
      totalTax?: number;
    }>({
      attempts: 2,
      fetcher: this.options.fetcher,
      request: providerRequest(
        `${this.baseUrl}/api/v2/transactions/create?$include=Summary,Addresses`,
        {
          body: JSON.stringify({
            addresses: {
              shipFrom: address(input.origin),
              shipTo: address(input.destination),
            },
            code: input.transactionCode,
            commit: false,
            companyCode: this.credentials.companyCode,
            currencyCode: input.currencyCode.toUpperCase(),
            customerCode: input.customerCode,
            date: input.transactionDate,
            entityUseCode: input.entityUseCode ?? undefined,
            exemptionNo: input.exemptionNumber ?? undefined,
            lines: input.lines.map((line, index) => ({
              amount: dollars(line.amountCents),
              description: line.description,
              itemCode: line.itemCode,
              number: String(index + 1),
              quantity: line.quantity,
              taxCode: line.taxCode,
            })),
            type: "SalesInvoice",
          }),
          headers: this.headers(),
          method: "POST",
        },
      ),
      sleep: this.options.sleep,
    });
    if (
      payload.code !== input.transactionCode ||
      payload.status !== "Saved" ||
      typeof payload.totalTax !== "number" ||
      !Number.isFinite(payload.totalTax)
    ) {
      throw new AppError(
        502,
        "upstream_error",
        "Avalara did not return a complete saved tax transaction.",
      );
    }
    return {
      code: payload.code,
      currencyCode:
        payload.currencyCode ?? input.currencyCode.toUpperCase(),
      jurisdictionSummary: (payload.summary ?? []).map((summary) => ({
        jurisdictionName: summary.jurisdictionName ?? "Unknown",
        jurisdictionType: summary.jurisdictionType ?? "Unknown",
        rate: Number(summary.rate ?? 0),
        taxCents: Math.round(Number(summary.tax ?? 0) * 100),
        taxableCents: Math.round(Number(summary.taxable ?? 0) * 100),
      })),
      providerId: payload.id ?? null,
      status: "Saved",
      taxCents: Math.round(payload.totalTax * 100),
      totalCents: Math.round(Number(payload.totalAmount ?? 0) * 100),
    };
  }

  async commitTransaction(transactionCode: string): Promise<void> {
    const payload = await requestIntegrationJson<{ status?: string }>({
      fetcher: this.options.fetcher,
      request: providerRequest(
        `${this.baseUrl}/api/v2/companies/${encodeURIComponent(
          this.credentials.companyCode,
        )}/transactions/${encodeURIComponent(transactionCode)}/commit`,
        {
          body: "{}",
          headers: this.headers(),
          method: "POST",
        },
      ),
      sleep: this.options.sleep,
    });
    if (payload.status !== "Committed") {
      throw new AppError(
        502,
        "upstream_error",
        "Avalara did not confirm the committed tax transaction.",
      );
    }
  }

  async refundTransaction(
    transactionCode: string,
    input: AvalaraRefundRequest,
    options: AvalaraRefundOptions = {},
  ): Promise<AvalaraRefundResult> {
    if (
      input.refundType === "Percentage" &&
      (!Number.isFinite(input.refundPercentage) ||
        Number(input.refundPercentage) <= 0 ||
        Number(input.refundPercentage) >= 100)
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "A partial Avalara refund requires a percentage between zero and one hundred.",
      );
    }
    if (options.reconcileFirst) {
      const reconciled = await this.getCommittedRefundTransaction(
        input.refundTransactionCode,
      );
      if (reconciled) return reconciled;
    }
    const payload = await requestIntegrationJson<{
      code?: string;
      status?: string;
      summary?: Array<{
        jurisdictionName?: string;
        jurisdictionType?: string;
        rate?: number;
        tax?: number;
        taxable?: number;
      }>;
      totalAmount?: number;
      totalTax?: number;
    }>({
      attempts: 1,
      fetcher: this.options.fetcher,
      request: providerRequest(
        `${this.baseUrl}/api/v2/companies/${encodeURIComponent(
          this.credentials.companyCode,
        )}/transactions/${encodeURIComponent(transactionCode)}/refund`,
        {
          body: JSON.stringify({
            refundDate: input.refundDate,
            refundPercentage:
              input.refundType === "Percentage"
                ? input.refundPercentage
                : undefined,
            refundTransactionCode: input.refundTransactionCode,
            refundType: input.refundType,
            referenceCode: input.referenceCode,
          }),
          headers: this.headers(),
          method: "POST",
        },
      ),
      sleep: this.options.sleep,
    });
    return this.parseCommittedRefund(payload, input.refundTransactionCode);
  }

  private parseCommittedRefund(
    payload: {
      code?: string;
      status?: string;
      summary?: Array<{
        jurisdictionName?: string;
        jurisdictionType?: string;
        rate?: number;
        tax?: number;
        taxable?: number;
      }>;
      totalAmount?: number;
      totalTax?: number;
    },
    expectedCode: string,
  ): AvalaraRefundResult {
    if (
      payload.code !== expectedCode ||
      payload.status !== "Committed" ||
      typeof payload.totalTax !== "number" ||
      !Number.isFinite(payload.totalTax)
    ) {
      throw new AppError(
        502,
        "upstream_error",
        "Avalara did not return a committed refund transaction.",
      );
    }
    return {
      code: payload.code,
      jurisdictionSummary: (payload.summary ?? []).map((summary) => ({
        jurisdictionName: summary.jurisdictionName ?? "Unknown",
        jurisdictionType: summary.jurisdictionType ?? "Unknown",
        rate: Number(summary.rate ?? 0),
        taxCents: Math.abs(Math.round(Number(summary.tax ?? 0) * 100)),
        taxableCents: Math.abs(
          Math.round(Number(summary.taxable ?? 0) * 100),
        ),
      })),
      status: "Committed",
      taxCents: Math.abs(Math.round(payload.totalTax * 100)),
      totalCents: Math.abs(Math.round(Number(payload.totalAmount ?? 0) * 100)),
    };
  }

  private async getCommittedRefundTransaction(
    refundTransactionCode: string,
  ): Promise<AvalaraRefundResult | null> {
    try {
      const payload = await requestIntegrationJson<{
        code?: string;
        status?: string;
        summary?: Array<{
          jurisdictionName?: string;
          jurisdictionType?: string;
          rate?: number;
          tax?: number;
          taxable?: number;
        }>;
        totalAmount?: number;
        totalTax?: number;
      }>({
        attempts: 1,
        fetcher: this.options.fetcher,
        request: providerRequest(
          `${this.baseUrl}/api/v2/companies/${encodeURIComponent(
            this.credentials.companyCode,
          )}/transactions/${encodeURIComponent(refundTransactionCode)}`,
          {
            headers: this.headers(),
            method: "GET",
          },
        ),
        sleep: this.options.sleep,
      });
      return this.parseCommittedRefund(payload, refundTransactionCode);
    } catch (error) {
      if (
        error instanceof IntegrationProviderError &&
        error.status === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  async getTransactionStatus(transactionCode: string): Promise<string> {
    const payload = await requestIntegrationJson<{ status?: string }>({
      attempts: 2,
      fetcher: this.options.fetcher,
      request: providerRequest(
        `${this.baseUrl}/api/v2/companies/${encodeURIComponent(
          this.credentials.companyCode,
        )}/transactions/${encodeURIComponent(transactionCode)}`,
        {
          headers: this.headers(),
          method: "GET",
        },
      ),
      sleep: this.options.sleep,
    });
    if (!payload.status) {
      throw new AppError(
        502,
        "upstream_error",
        "Avalara did not return the transaction status.",
      );
    }
    return payload.status;
  }

  async voidTransaction(
    transactionCode: string,
    reason: "DocDeleted" | "PostFailed" = "PostFailed",
  ): Promise<void> {
    await requestIntegrationJson<void>({
      fetcher: this.options.fetcher,
      request: providerRequest(
        `${this.baseUrl}/api/v2/companies/${encodeURIComponent(
          this.credentials.companyCode,
        )}/transactions/${encodeURIComponent(transactionCode)}/void`,
        {
          body: JSON.stringify({ code: reason }),
          headers: this.headers(),
          method: "POST",
        },
      ),
      sleep: this.options.sleep,
    });
  }
}

export async function resolveTaxFailClosed(input: {
  calculate: () => Promise<AvalaraTaxQuote>;
  connected: boolean;
  optedIn: boolean;
  persistAudit: (quote: AvalaraTaxQuote) => Promise<void>;
}): Promise<AvalaraTaxQuote | null> {
  if (!input.optedIn) return null;
  if (!input.connected) {
    throw new AppError(
      503,
      "activation_required",
      "Avalara is enabled but its credentials are not connected.",
    );
  }
  const quote = await input.calculate();
  await input.persistAudit(quote);
  return quote;
}
