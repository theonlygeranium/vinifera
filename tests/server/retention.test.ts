import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import express from "express";
import { createApp } from "../../server/app";
import { getConfigurationReport } from "../../server/config";
import { errorHandler } from "../../server/lib/error-handler";
import { createPublicRetentionRouter } from "../../server/routes/retention";
import { createRouteContext } from "../../server/routes/shared";
import {
  awardedPoints,
  calculateChurnScore,
  cancelOutcomeMessage,
  commandRequestFingerprint,
  createTransactionalEmailProvider,
  createUnsubscribeToken,
  deliverClaimedEmails,
  deliverLoggedTestEmail,
  decodeLoyaltyLedgerCursor,
  encodeLoyaltyLedgerCursor,
  normalizeCancelFlowAnalyticsSnapshot,
  portalLoginIdempotencyKey,
  recordEmailProviderEvent,
  renderTransactionalEmail,
  resolveBrandSenderIdentity,
  ResendEmailProvider,
  sanitizeTemplateHtml,
  sanitizeTemplateSubject,
  SimulatedEmailProvider,
  runRetentionSchedule,
  verifyResendSignature,
  verifyUnsubscribeToken,
} from "../../server/services/retention";
import type {
  FoundationServiceFactory,
  RetentionService,
  WorkerEnv,
} from "../../server/types";

const organizationId = "10000000-0000-4000-8000-000000000001";
const memberId = "30000000-0000-4000-8000-000000000001";
const templateId = "40000000-0000-4000-8000-000000000001";
const commandId = "50000000-0000-4000-8000-000000000001";
const signingSecret = "test-only-signing-secret-with-enough-entropy";
const unsubscribeSignedAt = "2026-07-26T00:00:00.000Z";
const unsubscribeExpiresAt = "2026-08-25T00:00:00.000Z";

function retention(overrides: Partial<RetentionService> = {}): RetentionService {
  return {
    applyUnsubscribe: vi.fn().mockResolvedValue(undefined),
    adjustLoyaltyPoints: vi.fn().mockResolvedValue({ id: "adjustment" }),
    deleteEmailTemplate: vi.fn().mockResolvedValue(undefined),
    getCancelFlowAnalytics: vi.fn().mockResolvedValue({
      attempts: 0,
      cancelled: 0,
      recentOutcomes: [],
      retained: 0,
      retentionRate: 0,
      steps: [],
    }),
    getCancelFlowConfiguration: vi.fn().mockResolvedValue({ steps: [] }),
    getChurnScore: vi.fn().mockResolvedValue({ memberId }),
    getMemberCancelFlow: vi.fn().mockResolvedValue({ steps: [] }),
    getMemberLoyalty: vi.fn().mockResolvedValue({ ledger: [] }),
    getStaffMemberLoyalty: vi.fn().mockResolvedValue({ ledger: [] }),
    handleResendWebhook: vi.fn().mockResolvedValue({ duplicate: false }),
    listChurnScores: vi.fn().mockResolvedValue({
      calculatedAt: null,
      highCount: 0,
      items: [],
      lowCount: 0,
      mediumCount: 0,
      scoredCount: 0,
      total: 0,
    }),
    listEmailLog: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    listEmailTemplates: vi.fn().mockResolvedValue([]),
    listLoyaltyMembers: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    previewEmailTemplate: vi.fn().mockResolvedValue({
      body: "Hello Avery",
      html: "<p>Hello Avery</p>",
      subject: "Welcome",
    }),
    processCancelFlowEvent: vi.fn().mockResolvedValue({ status: "in_progress" }),
    recordLoyaltyEvent: vi.fn().mockResolvedValue({ id: "event" }),
    redeemMemberLoyalty: vi.fn().mockResolvedValue({ id: "redemption" }),
    sendEmailTemplateTest: vi.fn().mockResolvedValue({
      accepted: true,
      deliveryId: "sim_test",
    }),
    startMemberCancelFlow: vi.fn().mockResolvedValue({ attemptId: "attempt" }),
    updateCancelFlowConfiguration: vi.fn().mockResolvedValue({ steps: [] }),
    updateEmailTemplate: vi.fn().mockResolvedValue({ id: templateId }),
    upsertEmailTemplate: vi.fn().mockResolvedValue({ id: templateId }),
    ...overrides,
  };
}

function retentionApp(
  service: RetentionService,
  env: Partial<WorkerEnv> = {},
) {
  const createService = (() => service) as unknown as FoundationServiceFactory;
  return createApp({
    createService,
    getEnv: () => ({
      ALLOWED_ORIGINS: "https://vinifera.test",
      APP_ENV: "test",
      APP_ORIGIN: "https://vinifera.test",
      UNSUBSCRIBE_SIGNING_SECRET: signingSecret,
      ...env,
    }),
  });
}

function publicRetentionRouteApp(service: RetentionService) {
  const createService = (() => service) as unknown as FoundationServiceFactory;
  const getEnv = (): WorkerEnv => ({
    ALLOWED_ORIGINS: "https://vinifera.test",
    APP_ENV: "test",
    APP_ORIGIN: "https://vinifera.test",
    UNSUBSCRIBE_SIGNING_SECRET: signingSecret,
  });
  const app = express();
  app.use(
    createPublicRetentionRouter(
      createRouteContext({ createService, getEnv }),
    ),
  );
  app.use(errorHandler);
  return app;
}

describe("Phase 3 provider activation", () => {
  it("never permits the deterministic email simulator outside explicit tests", () => {
    expect(() =>
      createTransactionalEmailProvider({
        APP_ENV: "production",
        EMAIL_PROVIDER: "simulated",
        EMAIL_SIMULATOR_ENABLED: "true",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "activation_required", status: 503 }),
    );
    expect(
      createTransactionalEmailProvider({
        APP_ENV: "test",
        EMAIL_PROVIDER: "simulated",
        EMAIL_SIMULATOR_ENABLED: "true",
      }),
    ).toBeInstanceOf(SimulatedEmailProvider);
  });

  it("requires the API key, from identity, verified domain, webhook, and signing secret", () => {
    const report = getConfigurationReport({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_test_secret",
      RESEND_DOMAIN_VERIFIED: "false",
      RESEND_FROM: "Vinifera <club@example.com>",
      RESEND_SENDING_DOMAIN: "example.com",
      RESEND_WEBHOOK_SECRET: "whsec_test",
      UNSUBSCRIBE_SIGNING_SECRET: signingSecret,
    });

    expect(report.communications.configured).toBe(false);
    expect(report.communications.missing).toContain("RESEND_DOMAIN_VERIFIED");
    expect(JSON.stringify(report)).not.toContain("re_test_secret");
    expect(JSON.stringify(report)).not.toContain(signingSecret);
  });

  it("uses Resend's batch endpoint and idempotency header without leaking credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "email_1" }] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const provider = new ResendEmailProvider(
      { apiKey: "re_test_secret", from: "Club <club@example.com>" },
      fetcher,
    );
    await expect(
      provider.sendBatch(
        [
          {
            from: "Estate Club <club@estate.example.com>",
            html: "<p>Hello</p>",
            subject: "Welcome",
            to: "member@example.com",
          },
        ],
        "outbox:stable",
      ),
    ).resolves.toEqual([{ id: "email_1" }]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.resend.com/emails/batch",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "outbox:stable",
        }),
      }),
    );
    const requestBody = JSON.parse(
      String(fetcher.mock.calls[0]?.[1]?.body ?? "[]"),
    );
    expect(requestBody[0].from).toBe(
      "Estate Club <club@estate.example.com>",
    );
  });

  it("uses verified brand senders and never falls back for configured pending identities", () => {
    expect(
      resolveBrandSenderIdentity({
        fromEmail: "club@estate.example.com",
        fromName: "Estate Club",
        id: "sender-1",
        status: "verified",
      }),
    ).toBe("Estate Club <club@estate.example.com>");
    expect(resolveBrandSenderIdentity(null)).toBeUndefined();
    expect(() =>
      resolveBrandSenderIdentity({
        fromEmail: "club@estate.example.com",
        fromName: "Estate Club",
        id: "sender-1",
        status: "pending",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "activation_required", status: 503 }),
    );
  });
});

describe("Phase 3 email safety", () => {
  it("removes executable markup, unsafe links, inline handlers, and remote images", () => {
    const sanitized = sanitizeTemplateHtml(
      '<script>alert(1)</script><p onclick="steal()">Hello</p><a href="javascript:steal()">bad</a><img src="https://tracker.example/pixel">',
    );
    expect(sanitized).toBe("<p>Hello</p><a>bad</a>");
    expect(sanitized).not.toMatch(/script|onclick|javascript|img/i);
  });

  it("escapes variables inside responsive transactional HTML", () => {
    const rendered = renderTransactionalEmail({
      body: "<p>Hello {{member_name}}</p>",
      organizationName: "Test Winery",
      subject: "Welcome {{member_name}}",
      unsubscribeUrl: "https://vinifera.test/unsubscribe",
      variables: { member_name: '<img src=x onerror="alert(1)">' },
    });
    expect(rendered.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(rendered.html).toContain('name="viewport"');
    expect(rendered.html).toContain("Manage optional transactional email preferences");
    expect(rendered.subject).not.toContain("<img");
  });

  it("preserves template variables in stored subjects and strips header controls", () => {
    expect(
      sanitizeTemplateSubject("Welcome {{member_name}}\r\nBcc: attacker@example.com"),
    ).toBe("Welcome {{member_name}} Bcc: attacker@example.com");
    expect(
      renderTransactionalEmail({
        body: "<p>Hello</p>",
        organizationName: "Test Winery",
        subject: "Welcome {{member_name}}",
        unsubscribeUrl: "https://vinifera.test/unsubscribe",
        variables: { member_name: "O'Brien" },
      }).subject,
    ).toBe("Welcome O'Brien");
  });

  it("signs expiring unsubscribe tokens and rejects tampering or expiry", async () => {
    const env = { UNSUBSCRIBE_SIGNING_SECRET: signingSecret };
    const expiresAt = new Date("2026-07-27T00:00:00.000Z");
    const token = await createUnsubscribeToken(
      env,
      { memberId, organizationId },
      expiresAt,
    );
    await expect(
      verifyUnsubscribeToken(env, token, new Date("2026-07-26T00:00:00.000Z")),
    ).resolves.toMatchObject({ memberId, organizationId });
    await expect(
      verifyUnsubscribeToken(
        env,
        `${token.slice(0, -1)}x`,
        new Date("2026-07-26T00:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      verifyUnsubscribeToken(env, token, new Date("2026-07-28T00:00:00.000Z")),
    ).rejects.toMatchObject({ status: 410 });
  });

  it("validates Resend/Svix signatures over the exact raw body and timestamp", async () => {
    const rawSecret = Buffer.from("test-webhook-secret").toString("base64");
    const payload = Buffer.from('{"type":"email.delivered"}');
    const timestamp = "1785042000";
    const id = "msg_123";
    const key = await crypto.subtle.importKey(
      "raw",
      Buffer.from("test-webhook-secret"),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign"],
    );
    const signature = Buffer.from(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${id}.${timestamp}.${payload.toString()}`),
      ),
    ).toString("base64");
    await expect(
      verifyResendSignature(
        { RESEND_WEBHOOK_SECRET: `whsec_${rawSecret}` },
        payload,
        { id, signature: `v1,${signature}`, timestamp },
        new Date(Number(timestamp) * 1_000),
      ),
    ).resolves.toBeUndefined();
    await expect(
      verifyResendSignature(
        { RESEND_WEBHOOK_SECRET: `whsec_${rawSecret}` },
        Buffer.from('{"type":"email.failed"}'),
        { id, signature: `v1,${signature}`, timestamp },
        new Date(Number(timestamp) * 1_000),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("delivers and records a full 100-email idempotent batch", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      attempt_count: 1,
      body: "<p>Hello {{member_name}}</p>",
      completion_token: crypto.randomUUID(),
      email_log_id: `log-${index}`,
      member_id: memberId,
      organization_id: organizationId,
      outbox_id: `outbox-${index}`,
      payload: { member_name: `Member ${index}`, organization_name: "Winery" },
      subject: "Welcome",
      to_email: `member${index}@example.com`,
      trigger_type: "welcome" as const,
      unsubscribe_expires_at: unsubscribeExpiresAt,
      unsubscribe_signed_at: unsubscribeSignedAt,
    }));
    const provider = new SimulatedEmailProvider();
    const mark = vi.fn().mockResolvedValue(undefined);
    const started = performance.now();
    const result = await deliverClaimedEmails({
      appOrigin: "https://vinifera.test",
      env: { UNSUBSCRIBE_SIGNING_SECRET: signingSecret },
      mark,
      provider,
      rows,
    });

    expect(result).toEqual({ failed: 0, sent: 100 });
    expect(mark).toHaveBeenCalledTimes(100);
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  it("fails only configured unverified brand rows while delivering fallback rows", async () => {
    const provider = {
      sendBatch: vi.fn().mockResolvedValue([{ id: "fallback-delivery" }]),
    };
    const mark = vi.fn().mockResolvedValue(undefined);
    const base = {
      attempt_count: 1,
      body: "<p>Hello</p>",
      completion_token: commandId,
      member_id: null,
      organization_id: organizationId,
      payload: null,
      subject: "Welcome",
      trigger_type: "welcome" as const,
      unsubscribe_expires_at: unsubscribeExpiresAt,
      unsubscribe_signed_at: unsubscribeSignedAt,
    };
    const result = await deliverClaimedEmails({
      appOrigin: "https://vinifera.test",
      env: { UNSUBSCRIBE_SIGNING_SECRET: signingSecret },
      mark,
      provider,
      rows: [
        {
          ...base,
          email_log_id: "log-pending",
          outbox_id: "outbox-pending",
          sender_from_email: "club@estate.example.com",
          sender_from_name: "Estate Club",
          sender_identity_id: "sender-pending",
          sender_status: "pending",
          to_email: "pending@example.com",
        },
        {
          ...base,
          email_log_id: "log-fallback",
          outbox_id: "outbox-fallback",
          to_email: "fallback@example.com",
        },
      ],
    });
    expect(result).toEqual({ failed: 1, sent: 1 });
    expect(provider.sendBatch).toHaveBeenCalledWith(
      [expect.objectContaining({ to: "fallback@example.com" })],
      "outbox:outbox-fallback",
    );
    expect(mark).toHaveBeenCalledWith(
      expect.objectContaining({ email_log_id: "log-pending" }),
      "failed",
      null,
      expect.any(String),
    );
  });

  it("isolates provider failures per outbox row and uses a stable key per message", async () => {
    const row = (suffix: string) => ({
      attempt_count: 1,
      body: "<p>Hello</p>",
      completion_token: crypto.randomUUID(),
      email_log_id: `log-${suffix}`,
      member_id: null,
      organization_id: organizationId,
      outbox_id: `outbox-${suffix}`,
      payload: null,
      subject: "Welcome",
      to_email: `${suffix}@example.com`,
      trigger_type: "welcome" as const,
      unsubscribe_expires_at: unsubscribeExpiresAt,
      unsubscribe_signed_at: unsubscribeSignedAt,
    });
    const provider = {
      sendBatch: vi.fn().mockImplementation(
        async (
          messages: Array<{ to: string }>,
          idempotencyKey: string,
        ) => {
          if (messages[0]?.to === "bad@example.com") {
            throw new Error("provider unavailable");
          }
          return [{ id: `${idempotencyKey}:receipt` }];
        },
      ),
    };
    const mark = vi.fn().mockResolvedValue(undefined);
    await expect(
      deliverClaimedEmails({
        appOrigin: "https://vinifera.test",
        env: { UNSUBSCRIBE_SIGNING_SECRET: signingSecret },
        mark,
        provider,
        rows: [row("bad"), row("good")],
      }),
    ).resolves.toEqual({ failed: 1, sent: 1 });

    expect(provider.sendBatch).toHaveBeenCalledWith(
      [expect.objectContaining({ to: "bad@example.com" })],
      "outbox:outbox-bad",
    );
    expect(provider.sendBatch).toHaveBeenCalledWith(
      [expect.objectContaining({ to: "good@example.com" })],
      "outbox:outbox-good",
    );
    expect(mark).toHaveBeenCalledWith(
      expect.objectContaining({ outbox_id: "outbox-bad" }),
      "failed",
      null,
      "provider_delivery_failed",
    );
    expect(mark).toHaveBeenCalledWith(
      expect.objectContaining({ outbox_id: "outbox-good" }),
      "sent",
      "outbox:outbox-good:receipt",
    );
  });

  it("retries provider-accepted completion failures with identical content and key", async () => {
    const row = {
      attempt_count: 1,
      body: "<p>Hello {{member_name}}</p>",
      completion_token: commandId,
      email_log_id: "log-retry",
      member_id: memberId,
      organization_id: organizationId,
      outbox_id: "outbox-retry",
      payload: { member_name: "Avery", organization_name: "Winery" },
      subject: "Welcome",
      to_email: "member@example.com",
      trigger_type: "welcome" as const,
      unsubscribe_expires_at: unsubscribeExpiresAt,
      unsubscribe_signed_at: unsubscribeSignedAt,
    };
    const provider = {
      sendBatch: vi.fn().mockResolvedValue([{ id: "provider-email-1" }]),
    };
    const mark = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue(undefined);
    const registerUnsubscribe = vi.fn().mockResolvedValue(undefined);
    const deliver = () =>
      deliverClaimedEmails({
        appOrigin: "https://vinifera.test",
        env: { UNSUBSCRIBE_SIGNING_SECRET: signingSecret },
        mark,
        provider,
        registerUnsubscribe,
        rows: [row],
      });

    await expect(deliver()).resolves.toEqual({ failed: 1, sent: 0 });
    await expect(deliver()).resolves.toEqual({ failed: 0, sent: 1 });
    expect(provider.sendBatch).toHaveBeenCalledTimes(2);
    expect(provider.sendBatch.mock.calls[0]?.[1]).toBe("outbox:outbox-retry");
    expect(provider.sendBatch.mock.calls[1]?.[1]).toBe("outbox:outbox-retry");
    expect(provider.sendBatch.mock.calls[0]?.[0]).toEqual(
      provider.sendBatch.mock.calls[1]?.[0],
    );
    expect(registerUnsubscribe.mock.calls[0]?.[1]).toBe(
      registerUnsubscribe.mock.calls[1]?.[1],
    );
    expect(mark).toHaveBeenNthCalledWith(1, row, "sent", "provider-email-1");
    expect(mark).toHaveBeenNthCalledWith(2, row, "sent", "provider-email-1");
  });

  it("bounds concurrent one-message provider sends", async () => {
    let active = 0;
    let maximum = 0;
    const provider = {
      sendBatch: vi.fn().mockImplementation(async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return [{ id: crypto.randomUUID() }];
      }),
    };
    const rows = Array.from({ length: 24 }, (_, index) => ({
      attempt_count: 1,
      body: "<p>Hello</p>",
      completion_token: crypto.randomUUID(),
      email_log_id: `concurrency-log-${index}`,
      member_id: null,
      organization_id: organizationId,
      outbox_id: `concurrency-outbox-${index}`,
      payload: null,
      subject: "Welcome",
      to_email: `concurrency-${index}@example.com`,
      trigger_type: "welcome" as const,
      unsubscribe_expires_at: unsubscribeExpiresAt,
      unsubscribe_signed_at: unsubscribeSignedAt,
    }));
    await deliverClaimedEmails({
      appOrigin: "https://vinifera.test",
      env: { UNSUBSCRIBE_SIGNING_SECRET: signingSecret },
      mark: vi.fn().mockResolvedValue(undefined),
      provider,
      rows,
    });
    expect(maximum).toBeLessThanOrEqual(8);
    expect(maximum).toBeGreaterThan(1);
  });

  it("persists a test-email log before provider delivery and converges its receipt", async () => {
    const order: string[] = [];
    const enqueue = vi.fn().mockImplementation(async () => {
      order.push("enqueue");
      return "email-log-1";
    });
    const provider = {
      sendBatch: vi.fn().mockImplementation(async () => {
        order.push("provider");
        return [{ id: "resend-1" }];
      }),
    };
    const mark = vi.fn().mockImplementation(async () => {
      order.push("mark");
    });

    await expect(
      deliverLoggedTestEmail({
        enqueue,
        mark,
        message: {
          html: "<p>Preview</p>",
          subject: "Test",
          to: "staff@example.com",
        },
        provider,
      }),
    ).resolves.toEqual({
      deliveryId: "resend-1",
      emailLogId: "email-log-1",
    });
    expect(order).toEqual(["enqueue", "provider", "mark"]);
    expect(mark).toHaveBeenCalledWith("email-log-1", "sent", "resend-1");
  });
});

describe("Phase 3 explainable retention rules", () => {
  it("round-trips a deterministic loyalty snapshot cursor and rejects malformed cursors", () => {
    const cursor = encodeLoyaltyLedgerCursor({
      beforeSequence: 25,
      snapshotSequence: 50,
    });
    expect(decodeLoyaltyLedgerCursor(cursor)).toEqual({
      beforeSequence: 25,
      snapshotSequence: 50,
    });
    expect(() => decodeLoyaltyLedgerCursor("not-a-cursor")).toThrowError(
      expect.objectContaining({ code: "invalid_request", status: 400 }),
    );
    expect(() =>
      decodeLoyaltyLedgerCursor(
        Buffer.from(
          JSON.stringify({ beforeSequence: 51, snapshotSequence: 50 }),
        ).toString("base64url"),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "invalid_request", status: 400 }),
    );
  });

  it("normalizes database analytics fractions and completed-step outcomes for the UI", () => {
    expect(
      normalizeCancelFlowAnalyticsSnapshot({
        abandonedCount: 1,
        attemptCount: 3,
        cancelledCount: 1,
        recentOutcomes: [
          {
            attemptId: "attempt-1",
            completedAt: "2026-07-26T12:00:00.000Z",
            memberEmail: "avery@example.test",
            memberFirstName: "Avery",
            memberId,
            memberLastName: "Stone",
            outcome: "paused",
            status: "intercepted",
            step: "pause",
          },
        ],
        retainedCount: 1,
        retentionRate: 0.3333,
        steps: [
          {
            cancelledCount: 0,
            continuedCount: 1,
            conversionRate: 0.6667,
            interceptedCount: 2,
            stepPosition: 1,
            stepType: "pause",
            viewedCount: 3,
          },
        ],
      }),
    ).toMatchObject({
      recentOutcomes: [
        {
          memberName: "Avery Stone",
          outcome: "paused",
          step: "pause",
        },
      ],
      retentionRate: 33.33,
      steps: [{ conversionRate: 66.67, step: "pause" }],
    });
  });

  it("fingerprints canonical command payloads and uses persisted replay outcomes", async () => {
    await expect(
      Promise.all([
        commandRequestFingerprint("loyalty.adjust", {
          memberId,
          points: 25,
          reason: "Service recovery",
        }),
        commandRequestFingerprint("loyalty.adjust", {
          reason: "Service recovery",
          points: 25,
          memberId,
        }),
      ]),
    ).resolves.toEqual([expect.any(String), expect.any(String)]);
    const [left, right] = await Promise.all([
      commandRequestFingerprint("loyalty.adjust", {
        memberId,
        points: 25,
        reason: "Service recovery",
      }),
      commandRequestFingerprint("loyalty.adjust", {
        reason: "Service recovery",
        points: 25,
        memberId,
      }),
    ]);
    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
    expect(cancelOutcomeMessage("paused")).toBe(
      "Your membership pause is confirmed.",
    );
    expect(cancelOutcomeMessage("cancelled")).toBe(
      "Your membership has been cancelled.",
    );
  });

  it("persists early provider events through the reconciliation RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ duplicate: false, matched: false }],
      error: null,
    });
    await expect(
      recordEmailProviderEvent(
        { rpc } as unknown as SupabaseClient,
        {
          eventType: "delivered",
          occurredAt: "2026-07-26T00:00:00.000Z",
          payload: { data: { email_id: "early-provider-id" } },
          providerEmailId: "early-provider-id",
          providerEventId: "provider-event-1",
        },
      ),
    ).resolves.toEqual({ duplicate: false, matched: false });
    expect(rpc).toHaveBeenCalledWith("record_email_provider_event", {
      p_event_type: "delivered",
      p_occurred_at: "2026-07-26T00:00:00.000Z",
      p_payload: { data: { email_id: "early-provider-id" } },
      p_provider_email_id: "early-provider-id",
      p_provider_event_id: "provider-event-1",
    });
  });

  it("runs durable daily retention work even when email delivery is unavailable", async () => {
    const rpc = vi.fn().mockImplementation(async (name: string) => {
      if (name === "enqueue_due_email_triggers") {
        return { data: 2, error: null };
      }
      if (name === "run_retention_daily_jobs") {
        return {
          data: {
            cancelAttemptsExpired: 3,
            churnScoresWritten: 4,
            loyaltyAwardsWritten: 5,
            loyaltyLotsExpired: 6,
            membersResumed: 7,
          },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    await expect(
      runRetentionSchedule(
        {
          APP_ENV: "test",
          APP_ORIGIN: "https://vinifera.test",
          EMAIL_PROVIDER: "simulated",
          EMAIL_SIMULATOR_ENABLED: "true",
          UNSUBSCRIBE_SIGNING_SECRET: signingSecret,
        },
        new Date("2026-07-26T04:00:00.000Z"),
        {
          admin: { rpc } as unknown as SupabaseClient,
          deliverEmail: vi.fn().mockRejectedValue(new Error("provider outage")),
        },
      ),
    ).resolves.toEqual({
      cancelAttemptsExpired: 3,
      churnScoresUpdated: 4,
      email: { failed: 0, sent: 0 },
      failures: ["email_delivery"],
      loyaltyEventsProcessed: 5,
      loyaltyExpired: 6,
      membersResumed: 7,
    });
    expect(rpc).toHaveBeenCalledWith("run_retention_daily_jobs", {
      p_job_date: "2026-07-26",
    });
  });

  it("assigns deterministic low, medium, and high churn scores with factors", () => {
    const low = calculateChurnScore({
      daysSinceInteraction: 2,
      daysSincePortalLogin: 1,
      declinesLast12Months: 0,
      emailClickRate90Days: 0.4,
      emailOpenRate90Days: 0.8,
      membershipDays: 900,
      tierDowngradesLast12Months: 0,
    });
    const medium = calculateChurnScore({
      daysSinceInteraction: 45,
      daysSincePortalLogin: 45,
      declinesLast12Months: 1,
      emailClickRate90Days: 0.1,
      emailOpenRate90Days: 0.4,
      membershipDays: 200,
      tierDowngradesLast12Months: 0,
    });
    const high = calculateChurnScore({
      daysSinceInteraction: null,
      daysSincePortalLogin: null,
      declinesLast12Months: 3,
      emailClickRate90Days: 0,
      emailOpenRate90Days: 0,
      membershipDays: 20,
      tierDowngradesLast12Months: 2,
    });

    expect(low.riskLevel).toBe("low");
    expect(medium.riskLevel).toBe("medium");
    expect(high.riskLevel).toBe("high");
    expect(high.score).toBe(100);
    expect(high.contributingFactors[0]).toMatchObject({
      evidence: expect.any(String),
      points: expect.any(Number),
    });
  });

  it("bounds portal-login activity to one stable event per member and UTC day", () => {
    expect(
      portalLoginIdempotencyKey(
        memberId,
        new Date("2026-07-26T23:59:59.000Z"),
      ),
    ).toBe(`activity:portal_login:${memberId}:2026-07-26`);
    expect(
      portalLoginIdempotencyKey(
        memberId,
        new Date("2026-07-27T00:00:00.000Z"),
      ),
    ).toBe(`activity:portal_login:${memberId}:2026-07-27`);
  });

  it("applies exact loyalty tier multipliers", () => {
    expect(awardedPoints(100, "vine")).toBe(100);
    expect(awardedPoints(100, "cellar")).toBe(125);
    expect(awardedPoints(100, "estate")).toBe(150);
    expect(awardedPoints(100, "reserve")).toBe(150);
  });
});

describe("Phase 3 HTTP contracts", () => {
  it("renders a non-mutating confirmation and permits signed one-click POST without Origin", async () => {
    const service = retention();
    const token = await createUnsubscribeToken(
      { UNSUBSCRIBE_SIGNING_SECRET: signingSecret },
      { memberId, organizationId },
    );
    const app = retentionApp(service);
    const confirmation = await request(publicRetentionRouteApp(service)).get(
      `/api/communications/unsubscribe?token=${encodeURIComponent(token)}`,
    );
    expect(confirmation.status).toBe(200);
    expect(confirmation.type).toBe("text/html");
    expect(confirmation.headers["cache-control"]).toBe("no-store");
    expect(confirmation.headers["referrer-policy"]).toBe("no-referrer");
    expect(confirmation.text).toContain("<form");
    expect(service.applyUnsubscribe).not.toHaveBeenCalled();

    const invalid = await request(publicRetentionRouteApp(service)).get(
      `/api/communications/unsubscribe?token=${"x".repeat(32)}`,
    );
    expect(invalid.status).toBe(400);
    expect(invalid.headers["cache-control"]).toBe("no-store");
    expect(invalid.headers["referrer-policy"]).toBe("no-referrer");

    const oneClick = await request(app).post(
      `/api/communications/unsubscribe?token=${encodeURIComponent(token)}`,
    );
    expect(oneClick.status).toBe(200);
    expect(service.applyUnsubscribe).toHaveBeenCalledWith(token);
  });

  it("supports canonical template draft-preview, patch, and recipient aliases", async () => {
    const service = retention();
    const app = retentionApp(service);
    const origin = "https://vinifera.test";
    await request(app)
      .patch(`/api/email/templates/${templateId}`)
      .set("Origin", origin)
      .send({ body: "Updated", daysBefore: 3, enabled: true, subject: "Soon" })
      .expect(200);
    await request(app)
      .post(`/api/email/templates/${templateId}/preview`)
      .set("Origin", origin)
      .send({ body: "Draft", subject: "Draft subject" })
      .expect(200);
    await request(app)
      .post(`/api/email/templates/${templateId}/test`)
      .set("Origin", origin)
      .send({
        body: "Unsaved body",
        recipient: "member@example.com",
        subject: "Unsaved subject",
      })
      .expect(202);

    expect(service.updateEmailTemplate).toHaveBeenCalledWith(
      templateId,
      expect.objectContaining({ daysBefore: 3 }),
    );
    expect(service.previewEmailTemplate).toHaveBeenCalledWith(
      templateId,
      expect.objectContaining({ body: "Draft", subject: "Draft subject" }),
    );
    expect(service.sendEmailTemplateTest).toHaveBeenCalledWith(templateId, {
      body: "Unsaved body",
      email: "member@example.com",
      subject: "Unsaved subject",
      variables: undefined,
    });
  });

  it("does not re-enable a template when PATCH omits enabled", async () => {
    const service = retention();
    await request(retentionApp(service))
      .patch(`/api/email/templates/${templateId}`)
      .set("Origin", "https://vinifera.test")
      .send({ subject: "Updated subject" })
      .expect(200);

    expect(service.updateEmailTemplate).toHaveBeenCalledWith(templateId, {
      subject: "Updated subject",
    });
  });

  it("requires UUID command keys for cancel and manual loyalty mutations", async () => {
    const service = retention();
    const app = retentionApp(service);
    const origin = "https://vinifera.test";
    await request(app)
      .post("/api/member/cancel-flow")
      .set("Origin", origin)
      .send({ confirmed: true })
      .expect(400);
    await request(app)
      .post("/api/member/cancel-flow")
      .set("Idempotency-Key", commandId)
      .set("Origin", origin)
      .send({ confirmed: true })
      .expect(201);
    await request(app)
      .post("/api/member/cancel-flow/events")
      .set("Idempotency-Key", commandId)
      .set("Origin", origin)
      .send({ action: "paused", step: "pause" })
      .expect(200);
    await request(app)
      .post(`/api/loyalty/members/${memberId}/adjust`)
      .set("Idempotency-Key", commandId)
      .set("Origin", origin)
      .send({ points: 25, reason: "Service recovery" })
      .expect(201);

    expect(service.startMemberCancelFlow).toHaveBeenCalledWith(commandId);
    expect(service.processCancelFlowEvent).toHaveBeenCalledWith(
      expect.objectContaining({ commandId }),
    );
    expect(service.adjustLoyaltyPoints).toHaveBeenCalledWith(
      memberId,
      { points: 25, reason: "Service recovery" },
      commandId,
    );
  });

  it("explains that loyalty adjustments must be non-zero", async () => {
    const service = retention();
    const response = await request(retentionApp(service))
      .post(`/api/loyalty/members/${memberId}/adjust`)
      .set("Idempotency-Key", commandId)
      .set("Origin", "https://vinifera.test")
      .send({ points: 0, reason: "No adjustment" });

    expect(response.status).toBe(400);
    expect(response.body.error.fieldErrors.points).toBe(
      "Point adjustment cannot be zero.",
    );
    expect(service.adjustLoyaltyPoints).not.toHaveBeenCalled();
  });

  it("keeps confirmation last and validates ledger pagination", async () => {
    const service = retention();
    const app = retentionApp(service);
    const origin = "https://vinifera.test";
    await request(app)
      .patch("/api/cancel-flow/config")
      .set("Origin", origin)
      .send({
        steps: [
          { enabled: true, id: "confirm", position: 1 },
          { enabled: true, id: "pause", position: 2 },
          { enabled: true, id: "downgrade", position: 3 },
          { enabled: true, id: "swap", position: 4 },
        ],
      })
      .expect(400);
    await request(app)
      .get(`/api/loyalty/members/${memberId}?limit=20&cursor=staff-cursor`)
      .expect(200);
    await request(app)
      .get("/api/member/loyalty?limit=10&cursor=member-cursor")
      .expect(200);

    expect(service.updateCancelFlowConfiguration).not.toHaveBeenCalled();
    expect(service.getStaffMemberLoyalty).toHaveBeenCalledWith(memberId, {
      cursor: "staff-cursor",
      limit: 20,
    });
    expect(service.getMemberLoyalty).toHaveBeenCalledWith({
      cursor: "member-cursor",
      limit: 10,
    });
  });

  it("requires redemption command IDs to be UUIDs", async () => {
    const service = retention();
    const app = retentionApp(service);
    const origin = "https://vinifera.test";
    await request(app)
      .post("/api/member/loyalty/redeem")
      .set("Origin", origin)
      .send({
        idempotencyKey: "not-a-command",
        points: 100,
        shipmentId: templateId,
      })
      .expect(400);
    await request(app)
      .post("/api/member/loyalty/redeem")
      .set("Origin", origin)
      .send({
        idempotencyKey: commandId,
        points: 100,
        shipmentId: templateId,
      })
      .expect(201);
    expect(service.redeemMemberLoyalty).toHaveBeenCalledWith({
      idempotencyKey: commandId,
      points: 100,
      shipmentId: templateId,
    });
  });

  it("passes the exact raw Resend webhook body through the canonical route", async () => {
    const handle = vi.fn().mockResolvedValue({ duplicate: false });
    const service = retention({ handleResendWebhook: handle });
    const payload = '{"type":"email.delivered","data":{"email_id":"email_1"}}';
    await request(retentionApp(service))
      .post("/api/webhooks/resend")
      .set("Content-Type", "application/json")
      .set("svix-id", "msg_123")
      .set("svix-signature", "v1,test")
      .set("svix-timestamp", "1785042000")
      .send(payload)
      .expect(200);

    expect(Buffer.isBuffer(handle.mock.calls[0]?.[0])).toBe(true);
    expect(handle.mock.calls[0]?.[0].toString("utf8")).toBe(payload);
  });
});
