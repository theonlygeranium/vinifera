import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  consumeIntegrationWakeBatch,
  enqueueIntegrationWake,
  INTEGRATION_WAKE_KIND,
  shouldWakeIntegrationDrain,
} from "../../server/integrations/wake-queue";
import {
  INTEGRATION_DRAIN_CLAIM_LIMIT,
  integrationWakeDelaySeconds,
} from "../../server/services/integrations";

describe("Phase 5 integration wake queue", () => {
  it("sends only a tenant-free wake signal and bounds delayed delivery", async () => {
    const send = vi.fn(async () => ({ metadata: {} }));
    await expect(
      enqueueIntegrationWake(
        { INTEGRATION_WAKE_QUEUE: { send } as never },
        99_999,
        new Date("2026-07-26T20:00:00.000Z"),
      ),
    ).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith(
      {
        kind: INTEGRATION_WAKE_KIND,
        requestedAt: "2026-07-26T20:00:00.000Z",
      },
      { contentType: "json", delaySeconds: 43_200 },
    );
  });

  it("wakes after successful mutations and the QuickBooks callback only", () => {
    expect(shouldWakeIntegrationDrain("POST", "/api/members", 201)).toBe(true);
    expect(
      shouldWakeIntegrationDrain(
        "GET",
        "/api/integrations/quickbooks/callback",
        303,
      ),
    ).toBe(true);
    expect(shouldWakeIntegrationDrain("GET", "/api/members", 200)).toBe(false);
    expect(shouldWakeIntegrationDrain("POST", "/api/members", 422)).toBe(false);
    expect(shouldWakeIntegrationDrain("POST", "/app/members", 200)).toBe(false);
  });

  it("coalesces duplicate messages into one drain and schedules the retry wake", async () => {
    const ackAll = vi.fn();
    const retryAll = vi.fn();
    const drain = vi.fn(async () => ({
      claimed: 2,
      continueImmediately: true,
      nextWakeDelaySeconds: 15,
    }));
    const enqueueDelayedWake = vi.fn(async () => true);
    await consumeIntegrationWakeBatch({
      batch: {
        ackAll,
        messages: [{ id: "one" }, { id: "duplicate" }],
        retryAll,
      } as never,
      drain,
      enqueueDelayedWake,
    });
    expect(drain).toHaveBeenCalledOnce();
    expect(ackAll).toHaveBeenCalledOnce();
    expect(retryAll).not.toHaveBeenCalled();
    expect(enqueueDelayedWake.mock.calls).toEqual([[0], [15]]);
  });

  it("retries a failed wake without acknowledging it", async () => {
    const ackAll = vi.fn();
    const retryAll = vi.fn();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      consumeIntegrationWakeBatch({
        batch: { ackAll, messages: [{}], retryAll } as never,
        drain: async () => {
          throw new Error("database unavailable");
        },
        enqueueDelayedWake: async () => true,
      }),
    ).resolves.toBeUndefined();
    expect(ackAll).not.toHaveBeenCalled();
    expect(retryAll).toHaveBeenCalledWith({ delaySeconds: 5 });
    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });

  it("retries the current signal at the authoritative job delay if re-enqueue fails", async () => {
    const ackAll = vi.fn();
    const retryAll = vi.fn();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await consumeIntegrationWakeBatch({
      batch: { ackAll, messages: [{}], retryAll } as never,
      drain: async () => ({
        claimed: 1,
        continueImmediately: false,
        nextWakeDelaySeconds: 15,
      }),
      enqueueDelayedWake: async () => {
        throw new Error("queue unavailable");
      },
    });
    expect(ackAll).not.toHaveBeenCalled();
    expect(retryAll).toHaveBeenCalledWith({ delaySeconds: 15 });
    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });

  it("keeps immediate continuation independent from a delayed retry wake", () => {
    expect(INTEGRATION_DRAIN_CLAIM_LIMIT).toBe(1);
    const asOf = new Date("2026-07-26T20:00:00.000Z");
    expect(
      integrationWakeDelaySeconds({
        asOf,
        retryTimes: ["2026-07-26T20:00:15.000Z"],
      }),
    ).toBe(15);
    expect(
      integrationWakeDelaySeconds({
        asOf,
        retryTimes: [],
      }),
    ).toBeNull();
  });

  it("uses isolated production, staging, and development queue topology", async () => {
    const config = JSON.parse(
      await readFile(new URL("../../wrangler.jsonc", import.meta.url), "utf8"),
    );
    const queueName = (scope: Record<string, unknown>) =>
      (
        (scope.queues as { producers: Array<{ queue: string }> }).producers[0]
      )!.queue;
    expect(queueName(config)).toBe("vinifera-integration-wake-development");
    expect(queueName(config.env.production)).toBe(
      "vinifera-integration-wake-production",
    );
    expect(queueName(config.env.staging)).toBe(
      "vinifera-integration-wake-staging",
    );
    expect(new Set([
      queueName(config),
      queueName(config.env.production),
      queueName(config.env.staging),
    ]).size).toBe(3);
  });
});
