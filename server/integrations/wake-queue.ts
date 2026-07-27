import type { WorkerEnv } from "../types";

export const INTEGRATION_WAKE_KIND = "integration-drain" as const;
export const MAX_INTEGRATION_WAKE_DELAY_SECONDS = 12 * 60 * 60;

export interface IntegrationWakeMessage {
  // The Queue carries no tenant, job, provider, or customer identifiers.
  // PostgreSQL remains the authoritative outbox and lease boundary.
  kind: typeof INTEGRATION_WAKE_KIND;
  requestedAt: string;
}

export interface IntegrationDrainWakeReport {
  claimed: number;
  continueImmediately: boolean;
  nextWakeDelaySeconds: number | null;
}

export function shouldWakeIntegrationDrain(
  method: string,
  pathname: string,
  status: number,
): boolean {
  if (
    status < 200 ||
    status >= 400 ||
    !pathname.startsWith("/api/")
  ) {
    return false;
  }
  const normalizedMethod = method.toUpperCase();
  return (
    !["GET", "HEAD", "OPTIONS"].includes(normalizedMethod) ||
    (normalizedMethod === "GET" &&
      pathname === "/api/integrations/quickbooks/callback")
  );
}

export async function enqueueIntegrationWake(
  env: Pick<WorkerEnv, "INTEGRATION_WAKE_QUEUE">,
  delaySeconds = 0,
  requestedAt = new Date(),
): Promise<boolean> {
  if (!env.INTEGRATION_WAKE_QUEUE) return false;
  const boundedDelay = Math.min(
    MAX_INTEGRATION_WAKE_DELAY_SECONDS,
    Math.max(0, Math.ceil(delaySeconds)),
  );
  await env.INTEGRATION_WAKE_QUEUE.send(
    {
      kind: INTEGRATION_WAKE_KIND,
      requestedAt: requestedAt.toISOString(),
    },
    {
      contentType: "json",
      ...(boundedDelay > 0 ? { delaySeconds: boundedDelay } : {}),
    },
  );
  return true;
}

export async function consumeIntegrationWakeBatch(input: {
  batch: MessageBatch<IntegrationWakeMessage>;
  drain: () => Promise<IntegrationDrainWakeReport>;
  enqueueDelayedWake: (delaySeconds: number) => Promise<unknown>;
}): Promise<void> {
  let retryDelaySeconds = 5;
  try {
    const report = await input.drain();
    if (report.continueImmediately) {
      await input.enqueueDelayedWake(0);
    }
    if (report.nextWakeDelaySeconds !== null) {
      retryDelaySeconds = Math.max(0, report.nextWakeDelaySeconds);
      await input.enqueueDelayedWake(report.nextWakeDelaySeconds);
    }
    input.batch.ackAll();
  } catch (error) {
    input.batch.retryAll({ delaySeconds: retryDelaySeconds });
    console.error(
      JSON.stringify({
        event: "integration.wake_consumer_failed",
        errorClass: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }
}
