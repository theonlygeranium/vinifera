import { AppError } from "../lib/errors";
import {
  providerRequest,
  requestIntegrationJson,
  type IntegrationRequestOptions,
} from "./http";
import {
  constantTimeEqual,
  hmacSha256Hex,
} from "./security";

export const KLAVIYO_API_REVISION = "2026-07-15";
const KLAVIYO_API_ORIGIN = "https://a.klaviyo.com";

export interface KlaviyoCredentials {
  apiKey: string;
  webhookSecret?: string;
}

export interface KlaviyoProfile {
  email: string;
  externalId: string;
  firstName?: string | null;
  lastName?: string | null;
  listIds?: string[];
  properties: Record<string, string | number | boolean | null>;
}

export interface KlaviyoEngagementEvent {
  datetime: string;
  eventId: string;
  eventType: "email_clicked" | "email_opened";
  profileExternalId: string | null;
}

export interface ParsedKlaviyoWebhookBatch {
  events: KlaviyoEngagementEvent[];
  ignored: number;
}

export function parseKlaviyoWebhookBatch(
  payload: Uint8Array,
  webhookId?: string,
): ParsedKlaviyoWebhookBatch {
  let decoded: Record<string, unknown>;
  try {
    decoded = JSON.parse(new TextDecoder().decode(payload)) as Record<
      string,
      unknown
    >;
  } catch {
    throw new AppError(
      400,
      "invalid_request",
      "The Klaviyo webhook payload is invalid.",
    );
  }
  const meta =
    decoded.meta &&
    typeof decoded.meta === "object" &&
    !Array.isArray(decoded.meta)
      ? (decoded.meta as Record<string, unknown>)
      : null;
  const bodyWebhookId =
    typeof meta?.klaviyo_webhook_id === "string"
      ? meta.klaviyo_webhook_id
      : "";
  if (
    !webhookId ||
    !bodyWebhookId ||
    !constantTimeEqual(webhookId, bodyWebhookId)
  ) {
    throw new AppError(
      401,
      "unauthorized",
      "The Klaviyo webhook identity does not match its signed envelope.",
    );
  }
  if (!Array.isArray(decoded.data) || decoded.data.length > 1_000) {
    throw new AppError(
      400,
      "invalid_request",
      "The Klaviyo webhook batch is invalid.",
    );
  }
  let ignored = 0;
  const events: KlaviyoEngagementEvent[] = [];
  for (const itemValue of decoded.data) {
    if (
      !itemValue ||
      typeof itemValue !== "object" ||
      Array.isArray(itemValue)
    ) {
      ignored += 1;
      continue;
    }
    const item = itemValue as Record<string, unknown>;
    const topic = String(item.topic ?? "").toLowerCase();
    const eventType =
      topic.includes("clicked_email")
        ? "email_clicked"
        : topic.includes("opened_email")
          ? "email_opened"
          : null;
    if (!eventType) {
      ignored += 1;
      continue;
    }
    const payloadValue =
      item.payload &&
      typeof item.payload === "object" &&
      !Array.isArray(item.payload)
        ? (item.payload as Record<string, unknown>)
        : {};
    const eventData =
      payloadValue.data &&
      typeof payloadValue.data === "object" &&
      !Array.isArray(payloadValue.data)
        ? (payloadValue.data as Record<string, unknown>)
        : {};
    const attributes =
      eventData.attributes &&
      typeof eventData.attributes === "object" &&
      !Array.isArray(eventData.attributes)
        ? (eventData.attributes as Record<string, unknown>)
        : {};
    const eventId = String(
      item.external_id ?? eventData.id ?? attributes.unique_id ?? "",
    );
    const rawOccurredAt =
      attributes.datetime ??
      attributes.occurred_at ??
      attributes.timestamp;
    const datetime =
      typeof rawOccurredAt === "number"
        ? new Date(rawOccurredAt * 1_000).toISOString()
        : String(rawOccurredAt ?? "");
    if (
      !/^[A-Za-z0-9_.:-]{4,255}$/.test(eventId) ||
      !Number.isFinite(Date.parse(datetime))
    ) {
      ignored += 1;
      continue;
    }
    const relationships =
      eventData.relationships &&
      typeof eventData.relationships === "object" &&
      !Array.isArray(eventData.relationships)
        ? (eventData.relationships as Record<string, unknown>)
        : {};
    const profileRelationship =
      relationships.profile &&
      typeof relationships.profile === "object" &&
      !Array.isArray(relationships.profile)
        ? (relationships.profile as Record<string, unknown>)
        : {};
    const profileData =
      profileRelationship.data &&
      typeof profileRelationship.data === "object" &&
      !Array.isArray(profileRelationship.data)
        ? (profileRelationship.data as Record<string, unknown>)
        : {};
    events.push({
      datetime,
      eventId,
      eventType,
      profileExternalId: String(
        attributes.profile_external_id ??
          attributes.profile_id ??
          profileData.id ??
          "",
      ),
    });
  }
  return { events, ignored };
}

export interface KlaviyoBulkImportStatus {
  completedAt: string | null;
  failedProfiles: number;
  importedProfiles: number;
  jobId: string;
  status: "cancelled" | "complete" | "processing" | "queued" | "unknown";
}

interface KlaviyoClientOptions {
  fetcher?: (input: Request) => Promise<Response>;
  sleep?: IntegrationRequestOptions["sleep"];
}

function assertKlaviyoCredential(credentials: KlaviyoCredentials): void {
  if (!credentials.apiKey || credentials.apiKey.length < 10) {
    throw new AppError(
      503,
      "activation_required",
      "Klaviyo credentials must be connected before synchronization.",
    );
  }
}

export class KlaviyoClient {
  constructor(
    private readonly credentials: KlaviyoCredentials,
    private readonly options: KlaviyoClientOptions = {},
  ) {
    assertKlaviyoCredential(credentials);
  }

  private headers(): Headers {
    return new Headers({
      Accept: "application/vnd.api+json",
      Authorization: `Klaviyo-API-Key ${this.credentials.apiKey}`,
      "Content-Type": "application/vnd.api+json",
      revision: KLAVIYO_API_REVISION,
    });
  }

  async validateConnection(): Promise<void> {
    await requestIntegrationJson({
      attempts: 1,
      fetcher: this.options.fetcher,
      request: providerRequest(`${KLAVIYO_API_ORIGIN}/api/accounts`, {
        headers: this.headers(),
        method: "GET",
      }),
      sleep: this.options.sleep,
    });
  }

  async importProfiles(
    profiles: KlaviyoProfile[],
    idempotencyKey: string,
  ): Promise<{ jobId: string | null }> {
    if (!profiles.length || profiles.length > 1_000) {
      throw new AppError(
        400,
        "invalid_request",
        "Klaviyo profile batches must contain between 1 and 1,000 profiles.",
      );
    }
    const listIds = [
      ...new Set(profiles.flatMap((profile) => profile.listIds ?? [])),
    ];
    const payload = await requestIntegrationJson<{
      data?: { id?: string };
    }>({
      fetcher: this.options.fetcher,
      request: providerRequest(`${KLAVIYO_API_ORIGIN}/api/profile-import`, {
        body: JSON.stringify({
          data: {
            attributes: {
              profiles: {
                data: profiles.map((profile) => ({
                  attributes: {
                    email: profile.email,
                    external_id: profile.externalId,
                    first_name: profile.firstName ?? undefined,
                    last_name: profile.lastName ?? undefined,
                    properties: profile.properties,
                  },
                  type: "profile",
                })),
              },
            },
            relationships: listIds.length
              ? {
                  lists: {
                    data: listIds.map((id) => ({ id, type: "list" })),
                  },
                }
              : undefined,
            type: "profile-import-job",
          },
        }),
        headers: new Headers({
          ...Object.fromEntries(this.headers()),
          "Idempotency-Key": idempotencyKey,
        }),
        method: "POST",
      }),
      sleep: this.options.sleep,
    });
    return { jobId: payload.data?.id ?? null };
  }

  async bulkImportProfiles(
    profiles: KlaviyoProfile[],
    idempotencyKey: string,
  ): Promise<{ jobId: string }> {
    if (!profiles.length || profiles.length > 10_000) {
      throw new AppError(
        400,
        "invalid_request",
        "Klaviyo bulk profile batches must contain between 1 and 10,000 profiles.",
      );
    }
    const body = JSON.stringify({
      data: {
        attributes: {
          profiles: {
            data: profiles.map((profile) => ({
              attributes: {
                email: profile.email,
                external_id: profile.externalId,
                first_name: profile.firstName ?? undefined,
                last_name: profile.lastName ?? undefined,
                properties: profile.properties,
              },
              type: "profile",
            })),
          },
        },
        type: "profile-bulk-import-job",
      },
    });
    if (Buffer.byteLength(body, "utf8") > 5 * 1024 * 1024) {
      throw new AppError(
        400,
        "invalid_request",
        "Klaviyo bulk profile jobs cannot exceed 5 MB.",
      );
    }
    const payload = await requestIntegrationJson<{
      data?: { id?: string };
    }>({
      fetcher: this.options.fetcher,
      request: providerRequest(
        `${KLAVIYO_API_ORIGIN}/api/profile-bulk-import-jobs`,
        {
          body,
          headers: new Headers({
            ...Object.fromEntries(this.headers()),
            "Idempotency-Key": idempotencyKey,
          }),
          method: "POST",
        },
      ),
      sleep: this.options.sleep,
    });
    const jobId = payload.data?.id;
    if (!jobId) {
      throw new AppError(
        502,
        "upstream_error",
        "Klaviyo did not return a bulk import job identifier.",
      );
    }
    return { jobId };
  }

  async getBulkImportStatus(jobId: string): Promise<KlaviyoBulkImportStatus> {
    if (!/^[A-Za-z0-9_-]{4,200}$/.test(jobId)) {
      throw new AppError(
        400,
        "invalid_request",
        "The Klaviyo bulk import job identifier is invalid.",
      );
    }
    const payload = await requestIntegrationJson<{
      data?: {
        attributes?: {
          completed_at?: string | null;
          failed_profiles?: number;
          imported_profiles?: number;
          status?: string;
        };
        id?: string;
      };
    }>({
      fetcher: this.options.fetcher,
      request: providerRequest(
        `${KLAVIYO_API_ORIGIN}/api/profile-bulk-import-jobs/${encodeURIComponent(
          jobId,
        )}`,
        { headers: this.headers(), method: "GET" },
      ),
      sleep: this.options.sleep,
    });
    const attributes = payload.data?.attributes ?? {};
    const providerStatus = String(attributes.status ?? "").toLowerCase();
    const status =
      providerStatus === "complete" ||
      providerStatus === "completed"
        ? "complete"
        : providerStatus === "queued"
          ? "queued"
          : providerStatus === "processing"
            ? "processing"
            : providerStatus === "cancelled" ||
                providerStatus === "canceled"
              ? "cancelled"
              : "unknown";
    return {
      completedAt:
        typeof attributes.completed_at === "string"
          ? attributes.completed_at
          : null,
      failedProfiles: Math.max(
        0,
        Number(attributes.failed_profiles ?? 0),
      ),
      importedProfiles: Math.max(
        0,
        Number(attributes.imported_profiles ?? 0),
      ),
      jobId: payload.data?.id ?? jobId,
      status,
    };
  }

  async updateListMembership(
    listId: string,
    profileIds: string[],
    active: boolean,
  ): Promise<void> {
    if (!listId || !profileIds.length || profileIds.length > 1_000) {
      throw new AppError(
        400,
        "invalid_request",
        "Klaviyo list membership input is invalid.",
      );
    }
    await requestIntegrationJson<void>({
      fetcher: this.options.fetcher,
      request: providerRequest(
        `${KLAVIYO_API_ORIGIN}/api/lists/${encodeURIComponent(
          listId,
        )}/relationships/profiles`,
        {
          body: JSON.stringify({
            data: profileIds.map((id) => ({ id, type: "profile" })),
          }),
          headers: this.headers(),
          method: active ? "POST" : "DELETE",
        },
      ),
      sleep: this.options.sleep,
    });
  }

  async resolveProfileIds(
    externalIds: string[],
  ): Promise<Record<string, string>> {
    const uniqueExternalIds = [...new Set(externalIds)];
    if (
      !uniqueExternalIds.length ||
      uniqueExternalIds.length > 1_000 ||
      uniqueExternalIds.some(
        (externalId) =>
          !/^[A-Za-z0-9_.:@-]{4,255}$/.test(externalId),
      )
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "Klaviyo profile lookup input is invalid.",
      );
    }
    const resolved: Record<string, string> = {};
    for (let offset = 0; offset < uniqueExternalIds.length; offset += 100) {
      const batch = uniqueExternalIds.slice(offset, offset + 100);
      const url = new URL(`${KLAVIYO_API_ORIGIN}/api/profiles`);
      url.searchParams.set(
        "filter",
        `any(external_id,[${batch
          .map((externalId) => JSON.stringify(externalId))
          .join(",")}])`,
      );
      url.searchParams.set("fields[profile]", "external_id");
      url.searchParams.set("page[size]", "100");
      const payload = await requestIntegrationJson<{
        data?: Array<{
          attributes?: { external_id?: string };
          id?: string;
        }>;
      }>({
        fetcher: this.options.fetcher,
        request: providerRequest(url.toString(), {
          headers: this.headers(),
          method: "GET",
        }),
        sleep: this.options.sleep,
      });
      for (const profile of payload.data ?? []) {
        const externalId = profile.attributes?.external_id;
        if (externalId && profile.id) resolved[externalId] = profile.id;
      }
    }
    return resolved;
  }

  async getEngagementEvents(input: {
    cursor?: string | null;
    since: string;
  }): Promise<{
    events: KlaviyoEngagementEvent[];
    nextCursor: string | null;
  }> {
    const url = new URL(`${KLAVIYO_API_ORIGIN}/api/events`);
    url.searchParams.set(
      "filter",
      `greater-than(datetime,${input.since})`,
    );
    url.searchParams.set(
      "fields[event]",
      "datetime,event_properties,metric_id,profile_id,unique_id",
    );
    url.searchParams.set("include", "metric,profile");
    url.searchParams.set("page[size]", "100");
    if (input.cursor) url.searchParams.set("page[cursor]", input.cursor);
    const payload = await requestIntegrationJson<{
      data?: Array<{
        attributes?: {
          datetime?: string;
          event_properties?: Record<string, unknown>;
          unique_id?: string;
        };
        id?: string;
        relationships?: {
          metric?: { data?: { id?: string } };
          profile?: { data?: { id?: string } };
        };
      }>;
      included?: Array<{
        attributes?: Record<string, unknown>;
        id?: string;
        type?: string;
      }>;
      links?: { next?: string | null };
    }>({
      fetcher: this.options.fetcher,
      request: providerRequest(url.toString(), {
        headers: this.headers(),
        method: "GET",
      }),
      sleep: this.options.sleep,
    });
    const included = payload.included ?? [];
    const metricNames = new Map(
      included
        .filter((item) => item.type === "metric")
        .map((item) => [
          item.id,
          String(item.attributes?.name ?? "").toLowerCase(),
        ]),
    );
    const profileExternalIds = new Map(
      included
        .filter((item) => item.type === "profile")
        .map((item) => [
          item.id,
          typeof item.attributes?.external_id === "string"
            ? item.attributes.external_id
            : null,
        ]),
    );
    const events = (payload.data ?? []).flatMap((event) => {
      const metricName =
        metricNames.get(event.relationships?.metric?.data?.id) ?? "";
      const eventType =
        metricName.includes("click")
          ? "email_clicked"
          : metricName.includes("open")
            ? "email_opened"
            : null;
      const datetime = event.attributes?.datetime;
      const eventId = event.attributes?.unique_id ?? event.id;
      if (!eventType || !datetime || !eventId) return [];
      return [
        {
          datetime,
          eventId,
          eventType,
          profileExternalId:
            profileExternalIds.get(
              event.relationships?.profile?.data?.id,
            ) ?? null,
        },
      ] satisfies KlaviyoEngagementEvent[];
    });
    const next = payload.links?.next;
    const nextCursor = next
      ? new URL(next).searchParams.get("page[cursor]")
      : null;
    return { events, nextCursor };
  }
}

export async function verifyKlaviyoWebhook(input: {
  now?: Date;
  payload: Uint8Array;
  secret?: string;
  signature?: string;
  timestamp?: string;
}): Promise<void> {
  if (!input.secret) {
    throw new AppError(
      503,
      "activation_required",
      "Klaviyo system webhooks require an eligible account and webhook secret.",
    );
  }
  if (!input.signature || !input.timestamp) {
    throw new AppError(
      400,
      "invalid_request",
      "The Klaviyo webhook signature is missing.",
    );
  }
  const timestampMs = Date.parse(input.timestamp);
  const nowMs = (input.now ?? new Date()).getTime();
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(nowMs - timestampMs) > 5 * 60 * 1_000
  ) {
    throw new AppError(
      401,
      "unauthorized",
      "The Klaviyo webhook timestamp is outside the accepted window.",
    );
  }
  const signed = new Uint8Array([
    ...input.payload,
    ...new TextEncoder().encode(input.timestamp),
  ]);
  const expected = await hmacSha256Hex(input.secret, signed);
  const provided = input.signature.replace(/^sha256=/i, "").toLowerCase();
  if (!constantTimeEqual(expected, provided)) {
    throw new AppError(
      401,
      "unauthorized",
      "The Klaviyo webhook signature is invalid.",
    );
  }
}
