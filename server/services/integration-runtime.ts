import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertAvalaraBaseUrlEnvironment,
  assertProviderEnvironment,
  assertQuickBooksRedirectUri,
} from "../config";
import { AppError, requireConfigured } from "../lib/errors";
import { createSupabaseAdminClient } from "../lib/supabase-admin";
import type {
  IntegrationType,
  WorkerEnv,
} from "../types";
import { AvalaraClient, type AvalaraCredentials } from "../integrations/avalara";
import { IntegrationProviderError } from "../integrations/http";
import { KlaviyoClient } from "../integrations/klaviyo";
import {
  MetaConversionsClient,
  normalizeMetaTestEventCode,
} from "../integrations/meta";
import {
  QuickBooksClient,
  type QuickBooksOAuthConfiguration,
  type QuickBooksRefreshLease,
} from "../integrations/quickbooks";
import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  resolveExternalIntegrationCredentials,
} from "../integrations/security";

export function databaseError(message: string): AppError {
  return new AppError(500, "upstream_error", message);
}

export function rpcRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object"
    ? (row as Record<string, unknown>)
    : null;
}

export function qboConfiguration(env: WorkerEnv): QuickBooksOAuthConfiguration {
  const environment = requireConfigured(
    env.QUICKBOOKS_ENVIRONMENT,
    "QUICKBOOKS_ENVIRONMENT",
  );
  if (environment !== "production" && environment !== "sandbox") {
    throw new AppError(
      503,
      "activation_required",
      "The QuickBooks environment is invalid.",
    );
  }
  assertProviderEnvironment(env, "QuickBooks", environment);
  return {
    clientId: requireConfigured(env.QUICKBOOKS_CLIENT_ID, "QUICKBOOKS_CLIENT_ID"),
    clientSecret: requireConfigured(
      env.QUICKBOOKS_CLIENT_SECRET,
      "QUICKBOOKS_CLIENT_SECRET",
    ),
    environment,
    redirectUri: assertQuickBooksRedirectUri(env),
  };
}

export interface ClaimedIntegrationJob {
  attempt_count: number;
  brand_id: string | null;
  connection_id: string;
  cursor_data: Record<string, unknown>;
  entity_id: string | null;
  idempotency_key: string;
  integration_type: IntegrationType;
  job_id: string;
  lease_token: string;
  max_attempts: number;
  organization_id: string;
  payload: Record<string, unknown>;
  sync_type: string;
}

export const integrationAdmin = createSupabaseAdminClient;

async function integrationRuntimeForJob(
  env: WorkerEnv,
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
): Promise<{
  credentialGeneration: number;
  credentials: Record<string, unknown>;
  storageMode: "encrypted_envelope" | "external_reference";
  syncConfig: Record<string, unknown>;
}> {
  const { data, error } = await admin.rpc("get_integration_runtime", {
    p_brand_id: job.brand_id,
    p_integration_type: job.integration_type,
    p_organization_id: job.organization_id,
    p_include_credentials: true,
  });
  const row = rpcRow(data);
  if (error || !row) {
    throw new AppError(
      503,
      "activation_required",
      "The integration runtime credentials are unavailable.",
    );
  }
  let credentials: Record<string, unknown>;
  if (row.storage_mode === "external_reference") {
    credentials = resolveExternalIntegrationCredentials(
      env,
      typeof row.external_secret_ref === "string"
        ? row.external_secret_ref
        : null,
    );
  } else if (
    row.storage_mode === "encrypted_envelope" &&
    row.algorithm === "A256GCM" &&
    row.envelope_version === 1 &&
    typeof row.credential_ciphertext === "string" &&
    typeof row.credential_iv === "string" &&
    typeof row.key_version === "string"
  ) {
    credentials = await decryptIntegrationCredentials<Record<string, unknown>>(
      env,
      {
        integrationType: job.integration_type,
        organizationId: job.organization_id,
        targetId: job.connection_id,
      },
      {
        algorithm: "A256GCM",
        ciphertext: row.credential_ciphertext,
        iv: row.credential_iv,
        keyVersion: row.key_version,
        version: 1,
      },
    );
  } else {
    throw new AppError(
      503,
      "activation_required",
      "The integration runtime credentials are unavailable.",
    );
  }
  const credentialGeneration =
    row.credential_generation === undefined
      ? 1
      : Number(row.credential_generation);
  if (!Number.isSafeInteger(credentialGeneration) || credentialGeneration < 1) {
    throw new AppError(
      503,
      "activation_required",
      "The integration credential generation is unavailable.",
    );
  }
  return {
    credentialGeneration,
    credentials,
    storageMode: row.storage_mode as
      | "encrypted_envelope"
      | "external_reference",
    syncConfig:
      row.sync_config &&
      typeof row.sync_config === "object" &&
      !Array.isArray(row.sync_config)
        ? (row.sync_config as Record<string, unknown>)
        : {},
  };
}

async function persistQuickBooksRotation(
  env: WorkerEnv,
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
  credentials: Record<string, unknown>,
  lease: QuickBooksRefreshLease,
): Promise<void> {
  const envelope = await encryptIntegrationCredentials(
    env,
    {
      integrationType: "quickbooks",
      organizationId: job.organization_id,
      targetId: job.connection_id,
    },
    credentials,
  );
  const { data, error } = await admin.rpc(
    "complete_quickbooks_refresh_lease",
    {
      p_algorithm: envelope.algorithm,
      p_connection_id: job.connection_id,
      p_credential_ciphertext: envelope.ciphertext,
      p_credential_iv: envelope.iv,
      p_envelope_version: envelope.version,
      p_expected_generation: lease.credentialGeneration,
      p_key_version: envelope.keyVersion,
      p_lease_token: lease.leaseToken,
    },
  );
  if (
    error ||
    !Number.isSafeInteger(Number(data)) ||
    Number(data) !== lease.credentialGeneration + 1
  ) {
    throw databaseError(
      "The rotated QuickBooks credentials could not be persisted.",
    );
  }
}

async function claimQuickBooksRefreshLease(
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
  credentialGeneration: number,
): Promise<QuickBooksRefreshLease> {
  const { data, error } = await admin.rpc(
    "claim_quickbooks_refresh_lease",
    {
      p_connection_id: job.connection_id,
      p_expected_generation: credentialGeneration,
      p_lease_owner: `job:${job.job_id}`,
      p_lease_seconds: 120,
    },
  );
  const row = rpcRow(data);
  if (error || !row) {
    throw databaseError("The QuickBooks refresh lease could not be acquired.");
  }
  if (row.disposition !== "acquired" || typeof row.lease_token !== "string") {
    const retryAt = Date.parse(String(row.retry_after ?? ""));
    throw new IntegrationProviderError(
      "provider_conflict",
      409,
      true,
      Number.isFinite(retryAt) ? Math.max(1_000, retryAt - Date.now()) : 1_000,
    );
  }
  const leaseCredentialGeneration = Number(row.credential_generation);
  if (
    !Number.isSafeInteger(leaseCredentialGeneration) ||
    leaseCredentialGeneration < 1
  ) {
    throw new IntegrationProviderError(
      "provider_conflict",
      409,
      true,
      1_000,
    );
  }
  return {
    credentialGeneration: leaseCredentialGeneration,
    leaseToken: row.lease_token,
  };
}

async function releaseQuickBooksRefreshLease(
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
  lease: QuickBooksRefreshLease,
): Promise<void> {
  const { error } = await admin.rpc("release_quickbooks_refresh_lease", {
    p_connection_id: job.connection_id,
    p_expected_generation: lease.credentialGeneration,
    p_lease_token: lease.leaseToken,
  });
  if (error) {
    throw databaseError("The QuickBooks refresh lease could not be released.");
  }
}

export async function providerForJob(
  env: WorkerEnv,
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
): Promise<{
  client:
    | AvalaraClient
    | KlaviyoClient
    | MetaConversionsClient
    | QuickBooksClient;
  syncConfig: Record<string, unknown>;
}> {
  if (!job.brand_id) {
    throw new IntegrationProviderError(
      "provider_rejected_request",
      422,
      false,
    );
  }
  const runtime = await integrationRuntimeForJob(env, admin, job);
  if (job.integration_type === "klaviyo") {
    return {
      client: new KlaviyoClient(
        runtime.credentials as unknown as {
          apiKey: string;
          webhookSecret?: string;
        },
      ),
      syncConfig: runtime.syncConfig,
    };
  }
  if (job.integration_type === "quickbooks") {
    return {
      client: new QuickBooksClient(
        job.connection_id,
        runtime.credentials as never,
        qboConfiguration(env),
        {
          claimRefreshLease: () => {
            if (runtime.storageMode === "external_reference") {
              throw new AppError(
                503,
                "activation_required",
                "QuickBooks rolling OAuth tokens require encrypted credential storage.",
              );
            }
            return claimQuickBooksRefreshLease(
              admin,
              job,
              runtime.credentialGeneration,
            );
          },
          persistRotatedCredentials: (credentials, lease) => {
            if (runtime.storageMode === "external_reference") {
              throw new AppError(
                503,
                "activation_required",
                "QuickBooks rotated credentials must be updated in the external integration binding.",
              );
            }
            if (!lease) {
              throw new AppError(
                503,
                "activation_required",
                "QuickBooks refresh lease coordination is unavailable.",
              );
            }
            return persistQuickBooksRotation(
              env,
              admin,
              job,
              credentials as unknown as Record<string, unknown>,
              lease,
            );
          },
          releaseRefreshLease: (lease) =>
            releaseQuickBooksRefreshLease(admin, job, lease),
        },
      ),
      syncConfig: runtime.syncConfig,
    };
  }
  if (job.integration_type === "avalara") {
    const credentials = runtime.credentials as unknown as AvalaraCredentials;
    assertAvalaraBaseUrlEnvironment(env, credentials.baseUrl);
    return {
      client: new AvalaraClient(credentials),
      syncConfig: runtime.syncConfig,
    };
  }
  if (job.integration_type === "meta") {
    const testEventCode = normalizeMetaTestEventCode(
      runtime.syncConfig.testEventCode,
      env.APP_ENV !== "production",
    );
    return {
      client: new MetaConversionsClient({
        ...(runtime.credentials as unknown as {
          accessToken: string;
          apiVersion: string;
          pixelId: string;
        }),
        testEventCode,
      }),
      syncConfig: runtime.syncConfig,
    };
  }
  throw new IntegrationProviderError(
    "provider_rejected_request",
    422,
    false,
  );
}
