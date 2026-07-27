import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../lib/errors";
import { sha256 } from "../lib/utils";
import type { WorkerEnv } from "../types";
import {
  KlaviyoClient,
  type KlaviyoProfile,
} from "../integrations/klaviyo";
import { IntegrationProviderError } from "../integrations/http";
import {
  failedIntegrationJob,
  successfulIntegrationJob,
  type IntegrationJobCompletion,
} from "../integrations/jobs";
import {
  decryptIntegrationCredentials,
} from "../integrations/security";
import {
  createApnsPushClient,
  createPushClient,
} from "../integrations/push";
import {
  databaseError,
  integrationAdmin,
  providerForJob,
  type ClaimedIntegrationJob,
} from "./integration-runtime";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KLAVIYO_LIST_ID = /^[A-Za-z0-9_-]{4,128}$/;

export interface KlaviyoFieldMapping {
  enabled: boolean;
  klaviyo_property: string;
  vinifera_field: string;
}

export interface KlaviyoListMapping {
  club_tier_id: string | null;
  enabled: boolean;
  list_id: string;
  membership_status: string | null;
}

function klaviyoChurnRiskLevel(row: Record<string, unknown>): string | null {
  if (typeof row.churn_risk_level === "string") {
    return row.churn_risk_level;
  }
  const score = Number(row.churn_risk_score);
  if (!Number.isFinite(score)) return null;
  return score <= 30 ? "low" : score <= 60 ? "medium" : "high";
}

function klaviyoSourceValue(
  row: Record<string, unknown>,
  field: string,
): string | number | boolean | null {
  if (field === "email") return String(row.email ?? "");
  if (field === "membership_status") return String(row.status ?? "");
  if (field === "churn_risk_level") return klaviyoChurnRiskLevel(row);
  if (field === "vinifera_deleted") return Boolean(row.deleted_at);
  if (field === "lifetime_value_cents") {
    return Number(row.lifetime_value_cents ?? 0);
  }
  if (field === "churn_risk_score") {
    const score = Number(row.churn_risk_score);
    return Number.isFinite(score) ? score : null;
  }
  const value = row[field];
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : null;
}

export function buildConfiguredKlaviyoProfile(
  row: Record<string, unknown>,
  mappings: KlaviyoFieldMapping[],
): KlaviyoProfile {
  const properties: KlaviyoProfile["properties"] = {};
  let firstName: string | null = null;
  let lastName: string | null = null;
  for (const mapping of mappings) {
    if (!mapping.enabled) continue;
    const value = klaviyoSourceValue(row, mapping.vinifera_field);
    if (
      mapping.vinifera_field === "email" &&
      mapping.klaviyo_property === "email"
    ) {
      continue;
    }
    if (
      mapping.vinifera_field === "first_name" &&
      mapping.klaviyo_property === "first_name"
    ) {
      firstName = typeof value === "string" ? value : null;
      continue;
    }
    if (
      mapping.vinifera_field === "last_name" &&
      mapping.klaviyo_property === "last_name"
    ) {
      lastName = typeof value === "string" ? value : null;
      continue;
    }
    properties[mapping.klaviyo_property] = value;
  }
  return {
    email: String(row.email ?? ""),
    externalId: String(row.member_id ?? row.id ?? ""),
    firstName,
    lastName,
    properties,
  };
}

export function configuredKlaviyoListIds(
  row: Record<string, unknown>,
  mappings: KlaviyoListMapping[],
): string[] {
  if (row.deleted_at) return [];
  const tierId =
    typeof row.club_tier_id === "string" ? row.club_tier_id : null;
  const status = typeof row.status === "string" ? row.status : null;
  return [
    ...new Set(
      mappings
        .filter(
          (mapping) =>
            mapping.enabled &&
            (mapping.club_tier_id === null ||
              mapping.club_tier_id === tierId) &&
            (mapping.membership_status === null ||
              mapping.membership_status === status),
        )
        .map((mapping) => mapping.list_id),
    ),
  ].sort();
}

export function unexplainedKlaviyoMissingProfiles(
  memberIds: string[],
  providerProfileIds: Record<string, string>,
  failedProfiles: number,
): string[] {
  const unresolved = memberIds.filter(
    (memberId) => !providerProfileIds[memberId],
  );
  return unresolved.slice(Math.max(0, failedProfiles));
}

export async function executeKlaviyoProfiles(
  env: WorkerEnv,
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
): Promise<IntegrationJobCompletion> {
  const { client } = await providerForJob(env, admin, job);
  const klaviyo = client as KlaviyoClient;
  const bulkJobId =
    typeof job.cursor_data.bulkJobId === "string"
      ? job.cursor_data.bulkJobId
      : null;
  if (bulkJobId) {
    const status = await klaviyo.getBulkImportStatus(bulkJobId);
    if (status.status === "queued" || status.status === "processing") {
      return {
        errorCode: null,
        failed: 0,
        nextAttemptAt: new Date(Date.now() + 15_000).toISOString(),
        outcome: "retry",
        processed: 0,
        providerCursor: job.cursor_data,
      };
    }
    if (status.status !== "complete") {
      throw new IntegrationProviderError(
        "provider_rejected_request",
        422,
        false,
      );
    }
    const memberIds = Array.isArray(job.cursor_data.memberIds)
      ? job.cursor_data.memberIds.filter(
          (value): value is string =>
            typeof value === "string" && UUID.test(value),
        )
      : [];
    const payloadHashes =
      job.cursor_data.payloadHashes &&
      typeof job.cursor_data.payloadHashes === "object" &&
      !Array.isArray(job.cursor_data.payloadHashes)
        ? (job.cursor_data.payloadHashes as Record<string, unknown>)
        : {};
    const desiredListIds =
      job.cursor_data.desiredListIds &&
      typeof job.cursor_data.desiredListIds === "object" &&
      !Array.isArray(job.cursor_data.desiredListIds)
        ? (job.cursor_data.desiredListIds as Record<string, unknown>)
        : {};
    const providerProfileIds = memberIds.length
      ? await klaviyo.resolveProfileIds(memberIds)
      : {};
    const unexplainedMissing = unexplainedKlaviyoMissingProfiles(
      memberIds,
      providerProfileIds,
      status.failedProfiles,
    );
    if (unexplainedMissing.length) {
      throw new IntegrationProviderError(
        "provider_unavailable",
        503,
        true,
        5_000,
      );
    }
    const resolvedMemberIds = memberIds.filter(
      (memberId) => Boolean(providerProfileIds[memberId]),
    );
    const { data: existingMappings, error: existingError } =
      resolvedMemberIds.length
      ? await admin
          .from("klaviyo_profile_mappings")
          .select("member_id,list_ids")
          .eq("connection_id", job.connection_id)
          .in("member_id", resolvedMemberIds)
      : { data: [], error: null };
    if (existingError) {
      throw databaseError(
        "The prior Klaviyo list memberships could not be loaded.",
      );
    }
    const priorLists = new Map(
      (existingMappings ?? []).map((mapping) => [
        String(mapping.member_id),
        Array.isArray(mapping.list_ids)
          ? mapping.list_ids.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
      ]),
    );
    const additions = new Map<string, string[]>();
    const removals = new Map<string, string[]>();
    for (const memberId of resolvedMemberIds) {
      const profileId = providerProfileIds[memberId]!;
      const desired = Array.isArray(desiredListIds[memberId])
        ? (desiredListIds[memberId] as unknown[]).filter(
            (value): value is string =>
              typeof value === "string" && KLAVIYO_LIST_ID.test(value),
          )
        : [];
      const previous = priorLists.get(memberId) ?? [];
      for (const listId of desired.filter(
        (listId) => !previous.includes(listId),
      )) {
        additions.set(listId, [...(additions.get(listId) ?? []), profileId]);
      }
      for (const listId of previous.filter(
        (listId) => !desired.includes(listId),
      )) {
        removals.set(listId, [...(removals.get(listId) ?? []), profileId]);
      }
    }
    for (const [listId, profileIds] of additions) {
      await klaviyo.updateListMembership(listId, profileIds, true);
    }
    for (const [listId, profileIds] of removals) {
      await klaviyo.updateListMembership(listId, profileIds, false);
    }
    for (const memberId of resolvedMemberIds) {
      const hash = payloadHashes[memberId];
      if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) continue;
      const desired = Array.isArray(desiredListIds[memberId])
        ? (desiredListIds[memberId] as unknown[]).filter(
            (value): value is string =>
              typeof value === "string" && KLAVIYO_LIST_ID.test(value),
          )
        : [];
      const { error } = await admin.rpc("upsert_klaviyo_profile_mapping", {
        p_connection_id: job.connection_id,
        p_external_profile_id: providerProfileIds[memberId],
        p_list_ids: desired,
        p_member_id: memberId,
        p_payload_hash: hash,
      });
      if (error) {
        throw databaseError(
          "The Klaviyo profile mapping could not be persisted.",
        );
      }
    }
    const afterMemberId =
      typeof job.cursor_data.afterMemberId === "string"
        ? job.cursor_data.afterMemberId
        : null;
    if (afterMemberId && job.cursor_data.hasNextPage === true) {
      const { error: nextError } = await admin.rpc(
        "enqueue_integration_sync_job",
        {
          p_connection_id: job.connection_id,
          p_cursor_data: { afterMemberId },
          p_direction: "outbound",
          p_entity_id: afterMemberId,
          p_entity_type: "member_page",
          p_idempotency_key: `klaviyo-page:${job.connection_id}:${afterMemberId}`,
          p_max_attempts: 20,
          p_payload: {},
          p_sync_type: "profiles.page",
        },
      );
      if (nextError) {
        throw databaseError(
          "The next Klaviyo profile page could not be queued.",
        );
      }
    }
    return successfulIntegrationJob({
      failed: status.failedProfiles,
      processed: status.importedProfiles,
      providerCursor: {
        afterMemberId: job.cursor_data.afterMemberId ?? null,
        bulkJobId: null,
      },
    });
  }
  const after =
    typeof job.cursor_data.afterMemberId === "string"
      ? job.cursor_data.afterMemberId
      : null;
  const deltaMemberId =
    job.sync_type === "klaviyo.profile.upsert" && job.entity_id
      ? job.entity_id
      : null;
  const sourceResult = deltaMemberId
    ? await admin
        .from("members")
        .select(
          "id,email,first_name,last_name,status,club_tier_id,lifetime_value_cents,joined_on,churn_risk_score,updated_at,deleted_at",
        )
        .eq("id", deltaMemberId)
        .eq("organization_id", job.organization_id)
        .eq("brand_id", job.brand_id)
        .maybeSingle()
    : await admin.rpc("get_klaviyo_member_source", {
        p_after_member_id: after,
        p_connection_id: job.connection_id,
        p_limit: 1_000,
      });
  if (sourceResult.error) {
    throw databaseError("The Klaviyo member source could not be loaded.");
  }
  const data = deltaMemberId
    ? sourceResult.data
      ? [
          {
            ...(sourceResult.data as Record<string, unknown>),
            member_id: (sourceResult.data as Record<string, unknown>).id,
          },
        ]
      : []
    : sourceResult.data;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (!rows.length) {
    return successfulIntegrationJob({
      processed: 0,
      providerCursor: { afterMemberId: after },
    });
  }
  const [
    { data: fieldMappings, error: fieldMappingError },
    { data: listMappings, error: listMappingError },
  ] = await Promise.all([
    admin
      .from("klaviyo_field_mappings")
      .select("vinifera_field,klaviyo_property,enabled")
      .eq("connection_id", job.connection_id)
      .eq("brand_id", job.brand_id)
      .eq("enabled", true),
    admin
      .from("klaviyo_list_mappings")
      .select("club_tier_id,membership_status,list_id,enabled")
      .eq("connection_id", job.connection_id)
      .eq("brand_id", job.brand_id)
      .eq("enabled", true),
  ]);
  if (fieldMappingError || listMappingError) {
    throw databaseError("The configured Klaviyo mappings could not be loaded.");
  }
  const profiles = rows.map((row) =>
    buildConfiguredKlaviyoProfile(
      row,
      (fieldMappings ?? []) as KlaviyoFieldMapping[],
    ),
  );
  const desiredLists = Object.fromEntries(
    rows.map((row) => [
      String(row.member_id),
      configuredKlaviyoListIds(
        row,
        (listMappings ?? []) as KlaviyoListMapping[],
      ),
    ]),
  );
  const lastMemberId = String(rows.at(-1)?.member_id ?? after ?? "");
  const result = await klaviyo.bulkImportProfiles(
    profiles,
    `klaviyo-${job.idempotency_key}`.slice(0, 200),
  );
  return {
    errorCode: null,
    failed: 0,
    nextAttemptAt: new Date(Date.now() + 15_000).toISOString(),
    outcome: "retry",
    processed: 0,
    providerCursor: {
      afterMemberId: lastMemberId,
      bulkJobId: result.jobId,
      hasNextPage: !deltaMemberId && rows.length === 1_000,
      memberIds: rows.map((row) => String(row.member_id)),
      desiredListIds: desiredLists,
      payloadHashes: Object.fromEntries(
        await Promise.all(
          profiles.map(async (profile) => [
            profile.externalId,
            await sha256(JSON.stringify(profile)),
          ]),
        ),
      ),
    },
  };
}

export async function executeKlaviyoEngagement(
  env: WorkerEnv,
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
): Promise<IntegrationJobCompletion> {
  const { client } = await providerForJob(env, admin, job);
  const klaviyo = client as KlaviyoClient;
  const since =
    typeof job.cursor_data.since === "string" &&
    Number.isFinite(Date.parse(job.cursor_data.since))
      ? job.cursor_data.since
      : new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  const cursor =
    typeof job.cursor_data.cursor === "string"
      ? job.cursor_data.cursor
      : null;
  const result = await klaviyo.getEngagementEvents({ cursor, since });
  let processed = 0;
  for (const event of result.events) {
    if (!event.profileExternalId) continue;
    const { data: mapping, error: mappingError } = await admin
      .from("klaviyo_profile_mappings")
      .select("member_id")
      .eq("connection_id", job.connection_id)
      .eq("brand_id", job.brand_id)
      .eq("external_profile_id", event.profileExternalId)
      .maybeSingle();
    if (mappingError) {
      throw databaseError("The Klaviyo profile mapping could not be loaded.");
    }
    if (!mapping) continue;
    const { data: inserted, error: insertError } = await admin
      .from("klaviyo_engagement_events")
      .upsert(
        {
          brand_id: job.brand_id,
          connection_id: job.connection_id,
          event_type: event.eventType,
          member_id: mapping.member_id,
          metrics: {},
          occurred_at: event.datetime,
          organization_id: job.organization_id,
          provider_event_id: event.eventId,
        },
        {
          ignoreDuplicates: true,
          onConflict: "connection_id,provider_event_id",
        },
      )
      .select("id");
    if (insertError) {
      throw databaseError("The Klaviyo engagement event could not be saved.");
    }
    processed += (inserted ?? []).length;
  }
  if (result.nextCursor) {
    const cursorHash = await sha256(result.nextCursor);
    const { error: nextError } = await admin.rpc(
      "enqueue_integration_sync_job",
      {
        p_connection_id: job.connection_id,
        p_cursor_data: { cursor: result.nextCursor, since },
        p_direction: "inbound",
        p_entity_id: job.brand_id,
        p_entity_type: "brand",
        p_idempotency_key: `klaviyo-engagement:${job.connection_id}:${cursorHash}`,
        p_max_attempts: 8,
        p_payload: {},
        p_sync_type: "engagement.poll",
      },
    );
    if (nextError) {
      throw databaseError("The next Klaviyo engagement page could not be queued.");
    }
  }
  return successfulIntegrationJob({
    processed,
    providerCursor: { cursor: result.nextCursor, since },
  });
}

export async function runMobilePushSchedule(
  env: WorkerEnv,
  asOf = new Date(),
): Promise<{ activationRequired: boolean; failed: number; sent: number }> {
  const admin = integrationAdmin(env);
  let apns: ReturnType<typeof createApnsPushClient>;
  let fcm: ReturnType<typeof createPushClient>;
  try {
    apns = createApnsPushClient(env);
    fcm = createPushClient(env);
  } catch {
    // Do not claim or burn attempts while deployment credentials are pending.
    return { activationRequired: true, failed: 0, sent: 0 };
  }
  const { data, error } = await admin.rpc("claim_mobile_push_messages", {
    p_as_of: asOf.toISOString(),
    p_lease_seconds: 120,
    p_limit: 50,
    p_worker: "vinifera-phase5-push",
  });
  if (error) throw databaseError("Mobile push messages could not be claimed.");
  const report = { activationRequired: false, failed: 0, sent: 0 };
  for (const push of (data ?? []) as Array<Record<string, unknown>>) {
    let sent = false;
    let providerMessageId: string | null = null;
    let errorCode: string | null = null;
    let nextAttemptAt: string | null = null;
    try {
      if (
        push.storage_mode !== "encrypted_envelope" ||
        push.algorithm !== "A256GCM" ||
        push.envelope_version !== 1
      ) {
        throw new AppError(
          503,
          "activation_required",
          "The mobile push provider or token is not activated.",
        );
      }
      const credentials = await decryptIntegrationCredentials<{ token: string }>(
        env,
        {
          integrationType: "mobile_push_token",
          organizationId: String(push.organization_id),
          targetId: String(push.device_id),
        },
        {
          algorithm: "A256GCM",
          ciphertext: String(push.push_token_ciphertext),
          iv: String(push.push_token_iv),
          keyVersion: String(push.key_version),
          version: 1,
        },
      );
      const safeData = Object.fromEntries(
        Object.entries(
          push.data && typeof push.data === "object"
            ? (push.data as Record<string, unknown>)
            : {},
        )
          .filter(
            ([key, value]) =>
              /^[a-z][a-z0-9_]{0,63}$/.test(key) &&
              ["boolean", "number", "string"].includes(typeof value),
          )
          .map(([key, value]) => [key, String(value)]),
      );
      const client = push.platform === "ios" ? apns : fcm;
      const result = await client.send({
        body: String(push.body),
        data: safeData,
        deepLinkPath:
          typeof push.deep_link_path === "string"
            ? push.deep_link_path
            : null,
        title: String(push.title),
        token: credentials.token,
      });
      sent = true;
      providerMessageId = result.providerMessageId;
      report.sent += 1;
    } catch (pushError) {
      const failed = failedIntegrationJob({
        asOf,
        attempt: Number(push.attempt_count ?? 1),
        error: pushError,
        maxAttempts: 8,
      });
      errorCode = (failed.errorCode ?? "upstream_error").toUpperCase();
      nextAttemptAt = failed.nextAttemptAt;
      report.failed += 1;
    }
    const { error: completeError } = await admin.rpc(
      "complete_mobile_push_message",
      {
        p_error_code: errorCode,
        p_lease_token: String(push.lease_token),
        p_next_attempt_at: nextAttemptAt,
        p_provider_message_id: providerMessageId,
        p_push_id: String(push.push_id),
        p_sent: sent,
      },
    );
    if (completeError) {
      throw databaseError("The mobile push outcome could not be persisted.");
    }
  }
  return report;
}
