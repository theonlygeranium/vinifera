import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addCalendarDays,
  deliveryComplete,
  localDate,
  plusAddress,
  providerList,
  scopedPreShipmentTriggerArgs,
  secretsMatch,
  senderDomain,
  validateResendDomain,
  validateResendWebhook,
} from "../../scripts/hosted-gate8-acceptance.mjs";

const repositoryRoot = new URL("../../", import.meta.url);
afterEach(() => vi.unstubAllGlobals());
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
  it("paginates provider inventory with the last returned ID", async () => {
    const requests = [];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(async (url) => {
          requests.push(String(url));
          return Response.json({
            data: [{ id: "domain-first" }],
            has_more: true,
          });
        })
        .mockImplementationOnce(async (url) => {
          requests.push(String(url));
          return Response.json({
            data: [{ id: "domain-second" }],
            has_more: false,
          });
        }),
    );
    await expect(providerList("/domains", "re_test_key")).resolves.toEqual([
      { id: "domain-first" },
      { id: "domain-second" },
    ]);
    expect(requests[0]).toContain("limit=100");
    expect(requests[1]).toContain("after=domain-first");
  });

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

  it("binds pre-shipment replay to one exact tenant fixture", () => {
    expect(
      scopedPreShipmentTriggerArgs(
        {
          brandId: "brand-a",
          memberId: "member-a",
          organizationId: "organization-a",
          releaseId: "release-a",
        },
        new Date("2026-08-06T12:00:00.000Z"),
      ),
    ).toEqual({
      p_as_of: "2026-08-06T12:00:00.000Z",
      p_brand_id: "brand-a",
      p_member_id: "member-a",
      p_organization_id: "organization-a",
      p_release_id: "release-a",
    });
    expect(() =>
      scopedPreShipmentTriggerArgs(
        {
          brandId: "brand-a",
          memberId: null,
          organizationId: "organization-a",
          releaseId: "release-a",
        },
        new Date(),
      ),
    ).toThrow(/identity is incomplete/u);
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
    const gate8JobStart = workflow.indexOf("\n  gate8-acceptance:");
    expect(gate8JobStart).toBeGreaterThan(0);
    const deployJob = workflow.slice(
      workflow.indexOf("\n  deploy-staging:"),
      gate8JobStart,
    );
    const gate8Job = workflow.slice(gate8JobStart);
    expect(deployJob).not.toContain("scripts/hosted-gate8-acceptance.mjs");
    expect(gate8Job).toContain("needs: deploy-staging");
    expect(gate8Job).toContain("timeout-minutes: 85");
    expect(gate8Job).toContain('HOSTED_GATE8_WAIT_SECONDS: "4200"');
    expect(workflow).toContain(
      "cancel-in-progress: ${{ github.ref != 'refs/heads/staging' || vars.STAGING_HOSTED_GATE8_ACCEPTANCE_ENABLED != 'true' }}",
    );
  });

  it("performs read-only provider discovery and retains sanitized durable evidence", async () => {
    const controller = await readFile(
      new URL("scripts/hosted-gate8-acceptance.mjs", repositoryRoot),
      "utf8",
    );
    expect(controller).toContain('method: "GET"');
    expect(controller).toContain('providerList("/domains"');
    expect(controller).toContain('providerList("/webhooks"');
    expect(controller).not.toMatch(
      /method:\s*"(?:POST|PUT|PATCH|DELETE)"/u,
    );
    expect(controller).toContain(
      'admin.rpc(\n      "enqueue_scoped_pre_shipment_trigger"',
    );
    expect(controller).not.toContain(
      'admin.rpc("enqueue_due_email_triggers"',
    );
    expect(controller).toContain('fixtureMode: "durable-one-shot-staging"');
    expect(controller).toContain('disposition: "durable-evidence-retained"');
    expect(controller).not.toMatch(/\.delete\(/u);
    expect(controller).toContain("AbortSignal.timeout(15_000)");
    expect(controller).toContain('redirect: "error"');
    expect(controller).toContain("headers: access");
    expect(controller).toMatch(
      /\.from\("email_delivery_events"\)[\s\S]*?\.eq\("organization_id", staff\.organization_id\)[\s\S]*?\.eq\("brand_id", brandId\)[\s\S]*?\.in\("email_log_id", logIds\)/u,
    );
    expect(controller).toMatch(
      /\.from\("email_outbox"\)[\s\S]*?\.eq\("organization_id", staff\.organization_id\)[\s\S]*?\.eq\("brand_id", brandId\)[\s\S]*?\.in\("email_log_id", logIds\)/u,
    );
    expect(controller).toContain("domainIdSha256");
    expect(controller).toContain("webhookIdSha256");
    const migration = await readFile(
      new URL(
        "supabase/migrations/202608060032_gate8_scoped_pre_shipment_trigger.sql",
        repositoryRoot,
      ),
      "utf8",
    );
    for (const predicate of [
      "release.organization_id = p_organization_id",
      "release.brand_id = p_brand_id",
      "member.organization_id = p_organization_id",
      "member.brand_id = p_brand_id",
      "member.id = p_member_id",
    ]) {
      expect(migration).toContain(predicate);
    }
    expect(migration).toContain(
      "from public, anon, authenticated;",
    );
  });
});
