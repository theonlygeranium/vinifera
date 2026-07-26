import { AppError } from "../lib/errors";
import {
  assertCloudflareCustomHostnameTarget,
  type ProviderTargetPolicy,
  providerTargetPolicy,
} from "../provider-targets";
import type { WorkerEnv } from "../types";
import {
  providerRequest,
  requestIntegrationJson,
  type IntegrationRequestOptions,
} from "./http";

export interface CloudflareDomainCredentials {
  appEnvironment: WorkerEnv["APP_ENV"];
  apiToken: string;
  fallbackOrigin: string;
  targetPolicy?: ProviderTargetPolicy;
  zoneId: string;
}

export interface CustomHostnameResult {
  externalId: string;
  hostname: string;
  ownershipVerification: {
    name: string;
    type: "txt";
    value: string;
  } | null;
  sslStatus: string;
  status: string;
}

export class CloudflareCustomHostnameClient {
  private readonly fallbackOriginHostname: string;

  constructor(
    private readonly credentials: CloudflareDomainCredentials,
    private readonly options: {
      fetcher?: (input: Request) => Promise<Response>;
      sleep?: IntegrationRequestOptions["sleep"];
    } = {},
  ) {
    if (
      !credentials.apiToken ||
      !credentials.zoneId ||
      !credentials.fallbackOrigin
    ) {
      throw new AppError(
        503,
        "activation_required",
        "Cloudflare custom-hostname credentials must be connected.",
      );
    }
    assertCloudflareCustomHostnameTarget(
      {
        appEnvironment: credentials.appEnvironment,
        fallbackOrigin: credentials.fallbackOrigin,
        zoneId: credentials.zoneId,
      },
      credentials.targetPolicy ?? providerTargetPolicy,
    );
    let fallbackOrigin = credentials.fallbackOrigin.trim().toLowerCase();
    if (fallbackOrigin.startsWith("https://")) {
      const parsed = new URL(fallbackOrigin);
      if (
        parsed.username ||
        parsed.password ||
        parsed.port ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
      ) {
        throw new AppError(
          503,
          "activation_required",
          "The Cloudflare fallback origin must be a bare HTTPS hostname.",
        );
      }
      fallbackOrigin = parsed.hostname;
    }
    if (
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
        fallbackOrigin,
      ) ||
      /^\d+(?:\.\d+){3}$/.test(fallbackOrigin)
    ) {
      throw new AppError(
        503,
        "activation_required",
        "The Cloudflare fallback origin hostname is invalid.",
      );
    }
    this.fallbackOriginHostname = fallbackOrigin;
  }

  private headers(): Headers {
    return new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${this.credentials.apiToken}`,
      "Content-Type": "application/json",
    });
  }

  async createHostname(
    hostname: string,
    brandId: string,
  ): Promise<CustomHostnameResult> {
    const payload = await requestIntegrationJson<{
      result?: Record<string, unknown>;
      success?: boolean;
    }>({
      attempts: 1,
      fetcher: this.options.fetcher,
      request: providerRequest(
        `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(
          this.credentials.zoneId,
        )}/custom_hostnames`,
        {
          body: JSON.stringify({
            custom_metadata: { brand_id: brandId },
            custom_origin_server: this.fallbackOriginHostname,
            hostname,
            ssl: { method: "txt", type: "dv" },
          }),
          headers: this.headers(),
          method: "POST",
        },
      ),
      sleep: this.options.sleep,
    });
    if (!payload.success || !payload.result) {
      throw new AppError(
        502,
        "upstream_error",
        "Cloudflare did not accept the custom hostname.",
      );
    }
    return normalizeHostname(payload.result);
  }

  async findHostname(
    hostname: string,
    brandId: string,
  ): Promise<CustomHostnameResult | null> {
    const endpoint = new URL(
      `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(
        this.credentials.zoneId,
      )}/custom_hostnames`,
    );
    endpoint.searchParams.set("hostname", hostname);
    endpoint.searchParams.set("per_page", "50");
    const payload = await requestIntegrationJson<{
      result?: Array<Record<string, unknown>>;
      success?: boolean;
    }>({
      fetcher: this.options.fetcher,
      request: providerRequest(endpoint.toString(), {
        headers: this.headers(),
        method: "GET",
      }),
      sleep: this.options.sleep,
    });
    if (!payload.success || !Array.isArray(payload.result)) {
      throw new AppError(
        502,
        "upstream_error",
        "Cloudflare custom-hostname lookup is unavailable.",
      );
    }
    const matches = payload.result.filter((row) => {
      const metadata =
        row.custom_metadata &&
        typeof row.custom_metadata === "object" &&
        !Array.isArray(row.custom_metadata)
          ? (row.custom_metadata as Record<string, unknown>)
          : {};
      return row.hostname === hostname && metadata.brand_id === brandId;
    });
    if (matches.length > 1) {
      throw new AppError(
        502,
        "upstream_error",
        "Cloudflare returned duplicate custom-hostname records.",
      );
    }
    return matches.length === 1 ? normalizeHostname(matches[0]!) : null;
  }

  async getHostname(externalId: string): Promise<CustomHostnameResult> {
    const payload = await requestIntegrationJson<{
      result?: Record<string, unknown>;
      success?: boolean;
    }>({
      fetcher: this.options.fetcher,
      request: providerRequest(
        `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(
          this.credentials.zoneId,
        )}/custom_hostnames/${encodeURIComponent(externalId)}`,
        { headers: this.headers(), method: "GET" },
      ),
      sleep: this.options.sleep,
    });
    if (!payload.success || !payload.result) {
      throw new AppError(
        502,
        "upstream_error",
        "Cloudflare custom-hostname status is unavailable.",
      );
    }
    return normalizeHostname(payload.result);
  }

  async deleteHostname(externalId: string): Promise<void> {
    const payload = await requestIntegrationJson<{ success?: boolean }>({
      fetcher: this.options.fetcher,
      request: providerRequest(
        `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(
          this.credentials.zoneId,
        )}/custom_hostnames/${encodeURIComponent(externalId)}`,
        { headers: this.headers(), method: "DELETE" },
      ),
      sleep: this.options.sleep,
    });
    if (!payload.success) {
      throw new AppError(
        502,
        "upstream_error",
        "Cloudflare did not confirm custom-hostname removal.",
      );
    }
  }
}

function normalizeHostname(
  row: Record<string, unknown>,
): CustomHostnameResult {
  const ownership =
    row.ownership_verification &&
    typeof row.ownership_verification === "object"
      ? (row.ownership_verification as Record<string, unknown>)
      : {};
  const ssl =
    row.ssl && typeof row.ssl === "object"
      ? (row.ssl as Record<string, unknown>)
      : {};
  return {
    externalId: String(row.id ?? ""),
    hostname: String(row.hostname ?? ""),
    ownershipVerification:
      ownership.type === "txt" &&
      typeof ownership.name === "string" &&
      typeof ownership.value === "string"
        ? {
            name: ownership.name,
            type: "txt",
            value: ownership.value,
          }
        : null,
    sslStatus: String(ssl.status ?? "initializing"),
    status: String(row.status ?? "pending"),
  };
}
