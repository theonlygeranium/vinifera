import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import { getConfigurationReport } from "../../server/config";
import {
  awardedPoints,
  calculateChurnScore,
  createTransactionalEmailProvider,
  createUnsubscribeToken,
  deliverClaimedEmails,
  deliverLoggedTestEmail,
  portalLoginIdempotencyKey,
  renderTransactionalEmail,
  resolveBrandSenderIdentity,
  ResendEmailProvider,
  sanitizeTemplateHtml,
  sanitizeTemplateSubject,
  SimulatedEmailProvider,
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
const signingSecret = "test-only-signing-secret-with-enough-entropy";

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
      email_log_id: `log-${index}`,
      member_id: memberId,
      organization_id: organizationId,
      outbox_id: `outbox-${index}`,
      payload: { member_name: `Member ${index}`, organization_name: "Winery" },
      subject: "Welcome",
      to_email: `member${index}@example.com`,
      trigger_type: "welcome" as const,
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
      member_id: null,
      organization_id: organizationId,
      payload: null,
      subject: "Welcome",
      trigger_type: "welcome" as const,
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
      expect.stringMatching(/^outbox:/),
    );
    expect(mark).toHaveBeenCalledWith(
      expect.objectContaining({ email_log_id: "log-pending" }),
      "failed",
      null,
    );
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
    const confirmation = await request(app).get(
      `/api/communications/unsubscribe?token=${encodeURIComponent(token)}`,
    );
    expect(confirmation.status).toBe(200);
    expect(confirmation.type).toBe("text/html");
    expect(confirmation.text).toContain("<form");
    expect(service.applyUnsubscribe).not.toHaveBeenCalled();

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
      .send({ recipient: "member@example.com" })
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
      email: "member@example.com",
      variables: undefined,
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
