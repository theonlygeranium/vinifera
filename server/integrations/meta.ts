import { AppError } from "../lib/errors";
import {
  providerRequest,
  requestIntegrationJson,
  type IntegrationRequestOptions,
} from "./http";
import {
  assertHashedMetaUserData,
  hashMetaIdentifier,
} from "./security";

export interface MetaCredentials {
  accessToken: string;
  apiVersion: string;
  pixelId: string;
  testEventCode?: string | null;
}

export interface MetaRawUserData {
  city?: string | null;
  country?: string | null;
  dateOfBirth?: string | null;
  email?: string | null;
  externalId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  state?: string | null;
  zip?: string | null;
}

export interface MetaConversionInput {
  consented: boolean;
  customData?: Record<string, string | number | boolean | null>;
  eventId: string;
  eventName: "Lead" | "Purchase" | "referral" | "tier_upgrade";
  eventSourceUrl?: string | null;
  eventTime: string;
  userData: MetaRawUserData;
}

interface MetaClientOptions {
  fetcher?: (input: Request) => Promise<Response>;
  sleep?: IntegrationRequestOptions["sleep"];
}

export async function buildHashedMetaUserData(
  input: MetaRawUserData,
): Promise<Record<string, string[]>> {
  const values = await Promise.all([
    ["em", await hashMetaIdentifier("email", input.email)] as const,
    ["ph", await hashMetaIdentifier("phone", input.phone)] as const,
    ["fn", await hashMetaIdentifier("first_name", input.firstName)] as const,
    ["ln", await hashMetaIdentifier("last_name", input.lastName)] as const,
    ["ct", await hashMetaIdentifier("city", input.city)] as const,
    ["st", await hashMetaIdentifier("state", input.state)] as const,
    ["zp", await hashMetaIdentifier("zip", input.zip)] as const,
    ["country", await hashMetaIdentifier("country", input.country)] as const,
    [
      "db",
      await hashMetaIdentifier("date_of_birth", input.dateOfBirth),
    ] as const,
    [
      "external_id",
      await hashMetaIdentifier("external_id", input.externalId),
    ] as const,
  ]);
  return Object.fromEntries(
    values.flatMap(([key, value]) => (value ? [[key, [value]]] : [])),
  );
}

export class MetaConversionsClient {
  constructor(
    private readonly credentials: MetaCredentials,
    private readonly options: MetaClientOptions = {},
  ) {
    if (!credentials.accessToken || !credentials.pixelId) {
      throw new AppError(
        503,
        "activation_required",
        "Meta Conversions API credentials must be connected.",
      );
    }
    if (!/^v\d+\.\d+$/.test(credentials.apiVersion)) {
      throw new AppError(
        503,
        "activation_required",
        "The Meta Graph API version is invalid.",
      );
    }
  }

  async validateConnection(): Promise<void> {
    const url = new URL(
      `https://graph.facebook.com/${this.credentials.apiVersion}/${encodeURIComponent(
        this.credentials.pixelId,
      )}`,
    );
    url.searchParams.set("fields", "id");
    await requestIntegrationJson({
      attempts: 1,
      fetcher: this.options.fetcher,
      request: providerRequest(url.toString(), {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.credentials.accessToken}`,
        },
        method: "GET",
      }),
      sleep: this.options.sleep,
    });
  }

  async sendConversion(
    input: MetaConversionInput,
  ): Promise<{ eventsReceived: number; traceId: string | null }> {
    if (!input.consented) {
      throw new AppError(
        403,
        "forbidden",
        "Meta conversion tracking requires explicit member consent.",
      );
    }
    if (
      !/^[A-Za-z0-9_.:-]{8,100}$/.test(input.eventId) ||
      !Number.isFinite(Date.parse(input.eventTime))
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "Meta conversion identity is invalid.",
      );
    }
    // Hashing finishes before the Request object exists, preventing raw PII
    // from ever entering a network-serializable payload.
    const userData = await buildHashedMetaUserData(input.userData);
    assertHashedMetaUserData(userData);
    return this.sendHashedConversion({
      consented: true,
      customData: input.customData,
      eventId: input.eventId,
      eventName: input.eventName,
      eventSourceUrl: input.eventSourceUrl,
      eventTime: input.eventTime,
      userData,
    });
  }

  async sendHashedConversion(input: {
    consented: boolean;
    customData?: Record<string, string | number | boolean | null>;
    eventId: string;
    eventName: MetaConversionInput["eventName"];
    eventSourceUrl?: string | null;
    eventTime: string;
    userData: Record<string, string | string[]>;
  }): Promise<{ eventsReceived: number; traceId: string | null }> {
    if (!input.consented) {
      throw new AppError(
        403,
        "forbidden",
        "Meta conversion tracking requires explicit member consent.",
      );
    }
    if (
      !/^[A-Za-z0-9_.:-]{8,100}$/.test(input.eventId) ||
      !Number.isFinite(Date.parse(input.eventTime))
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "Meta conversion identity is invalid.",
      );
    }
    assertHashedMetaUserData(input.userData);
    const userData = Object.fromEntries(
      Object.entries(input.userData).map(([key, value]) => [
        key,
        Array.isArray(value) ? value : [value],
      ]),
    );
    const body = {
      data: [
        {
          action_source: "website",
          custom_data: input.customData ?? {},
          event_id: input.eventId,
          event_name: input.eventName,
          event_source_url: input.eventSourceUrl ?? undefined,
          event_time: Math.floor(Date.parse(input.eventTime) / 1_000),
          user_data: userData,
        },
      ],
      test_event_code: this.credentials.testEventCode ?? undefined,
    };
    const url = new URL(
      `https://graph.facebook.com/${this.credentials.apiVersion}/${encodeURIComponent(
        this.credentials.pixelId,
      )}/events`,
    );
    const payload = await requestIntegrationJson<{
      events_received?: number;
      fbtrace_id?: string;
    }>({
      attempts: 3,
      fetcher: this.options.fetcher,
      request: providerRequest(url.toString(), {
        body: JSON.stringify(body),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.credentials.accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
      sleep: this.options.sleep,
    });
    if (payload.events_received !== 1) {
      throw new AppError(
        502,
        "upstream_error",
        "Meta did not acknowledge the conversion event.",
      );
    }
    return {
      eventsReceived: payload.events_received,
      traceId: payload.fbtrace_id ?? null,
    };
  }
}
