import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  deliveryComplete,
  localDate,
  plusAddress,
  secretsMatch,
  senderDomain,
  validateResendDomain,
  validateResendWebhook,
} from "../../scripts/hosted-gate8-acceptance.mjs";

const repositoryRoot = new URL("../../", import.meta.url);
const requiredEvents = [
  "email.bounced",
  "email.clicked",
  "email.complained",
  "email.delivered",
  "email.delivery_delayed",
  "email.failed",
  "email.opened",
  "email.sent",
];

describe("hosted Gate 8 acceptance controller", () => {
  it("scopes recipients and validates sender domains", () => {
    expect(plusAddress("Owner+old@Example.com", "vinifera-g8-run")).toBe(
      "owner+vinifera-g8-run@example.com",
    );
    expect(senderDomain("Vinifera Staging <mail@notify.example.com>")).toBe(
      "notify.example.com",
    );
    expect(() => plusAddress("not-an-email", "run")).toThrow(/email address/u);
    expect(() => senderDomain("not-an-address")).toThrow(/email address/u);
  });

  it("requires an exact verified sending domain with verified DKIM and SPF", () => {
    const domain = {
      capabilities: { sending: "enabled" },
      id: "domain_gate8",
      name: "notify.example.com",
      records: [
        { record: "DKIM", status: "verified" },
        { record: "SPF", status: "verified" },
      ],
      status: "verified",
    };
    expect(validateResendDomain(domain, "notify.example.com")).toEqual({
      id: "domain_gate8",
      recordTypes: ["DKIM", "SPF"],
    });
    expect(() =>
      validateResendDomain(
        { ...domain, name: "other.example.com" },
        "notify.example.com",
      ),
    ).toThrow(/different sending domain/u);
    expect(() =>
      validateResendDomain(
        { ...domain, records: [{ record: "DKIM", status: "verified" }] },
        "notify.example.com",
      ),
    ).toThrow(/SPF/u);
  });

  it("requires the exact enabled staging webhook and complete event contract", () => {
    const webhook = {
      endpoint:
        "https://vinifera-staging.account.workers.dev/api/webhooks/resend",
      events: requiredEvents,
      id: "webhook_gate8",
      status: "enabled",
    };
    expect(
      validateResendWebhook(
        webhook,
        "https://vinifera-staging.account.workers.dev/api/webhooks/resend",
      ),
    ).toEqual({ events: [...requiredEvents].sort(), id: "webhook_gate8" });
    expect(() =>
      validateResendWebhook(
        {
          ...webhook,
          endpoint: "https://production.example.com/api/webhooks/resend",
        },
        "https://vinifera-staging.account.workers.dev/api/webhooks/resend",
      ),
    ).toThrow(/different webhook endpoint/u);
    expect(() =>
      validateResendWebhook(
        { ...webhook, events: requiredEvents.slice(1) },
        webhook.endpoint,
      ),
    ).toThrow(/email.bounced/u);
  });

  it("compares secrets and derives the brand-local lifecycle date", () => {
    expect(secretsMatch("whsec_same", "whsec_same")).toBe(true);
    expect(secretsMatch("whsec_same", "whsec_other")).toBe(false);
    expect(
      localDate("America/Los_Angeles", new Date("2026-08-07T02:00:00Z")),
    ).toBe("2026-08-06");
    expect(addCalendarDays("2026-08-06", 7)).toBe("2026-08-13");
  });

  it("accepts only completed outbox rows and delivered provider events", () => {
    const logIds = ["log-a", "log-b"];
    const logs = logIds.map((id) => ({
      id,
      resend_id: `provider-${id}`,
      status: "delivered",
    }));
    const events = logIds.map((email_log_id) => ({
      email_log_id,
      event_type: "delivered",
    }));
    const outbox = logIds.map((email_log_id) => ({
      email_log_id,
      status: "completed",
    }));
    expect(deliveryComplete({ events, logIds, logs, outbox })).toBe(true);
    expect(
      deliveryComplete({
        events: events.map((event) => ({ ...event, event_type: "sent" })),
        logIds,
        logs,
        outbox,
      }),
    ).toBe(false);
    expect(
      deliveryComplete({
        events,
        logIds,
        logs: logs.map((row) => ({ ...row, status: "sent" })),
        outbox,
      }),
    ).toBe(false);
    expect(
      deliveryComplete({
        events,
        logIds,
        logs,
        outbox: outbox.map((row) => ({ ...row, status: "processing" })),
      }),
    ).toBe(false);
  });

  it("is opt-in, fail-closed, and maps the exact staging runtime bindings", async () => {
    const workflow = await readFile(
      new URL(".github/workflows/ci.yml", repositoryRoot),
      "utf8",
    );
    expect(workflow).toContain(
      "vars.STAGING_HOSTED_GATE8_ACCEPTANCE_ENABLED == 'true'",
    );
    expect(workflow).toContain("scripts/hosted-gate8-acceptance.mjs");
    expect(workflow).toContain("vinifera-hosted-gate8-acceptance.json");
    for (const name of [
      "EMAIL_PROVIDER",
      "EMAIL_SIMULATOR_ENABLED",
      "RESEND_API_KEY",
      "RESEND_DOMAIN_VERIFIED",
      "RESEND_FROM",
      "RESEND_SENDING_DOMAIN",
      "RESEND_WEBHOOK_SECRET",
      "UNSUBSCRIBE_SIGNING_SECRET",
    ]) {
      expect(workflow).toContain(`${name}: \${{ secrets.STAGING_${name} }}`);
    }
    expect(workflow).toContain("timeout-minutes: 90");
    expect(workflow).toContain(
      "Gate 8 acceptance is enabled but required bindings are missing",
    );
  });

  it("performs read-only provider discovery and retains sanitized durable evidence", async () => {
    const controller = await readFile(
      new URL("scripts/hosted-gate8-acceptance.mjs", repositoryRoot),
      "utf8",
    );
    expect(controller).toContain('method: "GET"');
    expect(controller).toContain('providerJson("/domains?limit=100"');
    expect(controller).toContain('providerJson("/webhooks?limit=100"');
    expect(controller).not.toMatch(/providerJson\([^\n]+,\s*apiKey,\s*"POST"/u);
    expect(controller).toContain('admin.rpc("enqueue_due_email_triggers"');
    expect(controller).toContain('fixtureMode: "durable-one-shot-staging"');
    expect(controller).toContain('disposition: "durable-evidence-retained"');
    expect(controller).not.toContain('.from("email_log").delete()');
    expect(controller).not.toContain('.from("email_delivery_events").delete()');
    expect(controller).toMatch(
      /\.from\("email_delivery_events"\)[\s\S]*?\.eq\("organization_id", staff\.organization_id\)[\s\S]*?\.eq\("brand_id", brandId\)[\s\S]*?\.in\("email_log_id", logIds\)/u,
    );
    expect(controller).toMatch(
      /\.from\("email_outbox"\)[\s\S]*?\.eq\("organization_id", staff\.organization_id\)[\s\S]*?\.eq\("brand_id", brandId\)[\s\S]*?\.in\("email_log_id", logIds\)/u,
    );
    expect(controller).toContain("domainIdSha256");
    expect(controller).toContain("webhookIdSha256");
  });
});
