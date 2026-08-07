import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  collectHostedGateEvidence,
  requiredConfigurationForGate,
} from "../../scripts/hosted-gates10-16-evidence.mjs";

const candidate = "a".repeat(40);
const origin = "https://vinifera-staging.edstratum-labs-staging.workers.dev";
const fixedNow = () => new Date("2026-08-06T12:00:00.000Z");

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init,
  });
}

function fetchFor(configuration, revision = candidate) {
  return vi.fn(async (url, init) => {
    expect(init).toMatchObject({ method: "GET", redirect: "error" });
    if (String(url).endsWith("/api/health")) {
      return jsonResponse({
        data: {
          environment: "staging",
          revision,
          service: "vinifera-api",
          status: "ok",
        },
      });
    }
    return jsonResponse({ data: configuration });
  });
}

describe("hosted Gates 10-16 readiness evidence", () => {
  it("binds Gate 11 readiness to the exact hosted revision and actor presence", async () => {
    const fetchImpl = fetchFor({
      app: { configured: true, missing: [] },
      database: { configured: true, missing: [] },
    });
    const report = await collectHostedGateEvidence({
      confirmation: "COLLECT VINIFERA GATE 11 READINESS EVIDENCE",
      enabled: true,
      expectedRevision: candidate,
      fetchImpl,
      gate: 11,
      mlActorConfigured: true,
      now: fixedNow,
      origin,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({
      blockers: [],
      candidateRevision: candidate,
      completionClaimed: false,
      evidenceLevel: "hosted-readiness",
      gate: 11,
      mlPlatformActorConfigured: true,
      result: "ready",
      runtime: { exactRevision: true, environment: "staging", reachable: true },
    });
    expect(report.externalEvidenceRemaining).toContain(
      "completed-30-day-comparison",
    );
  });

  it("fails closed on revision drift, incomplete configuration, and a missing actor", async () => {
    const report = await collectHostedGateEvidence({
      confirmation: "COLLECT VINIFERA GATE 11 READINESS EVIDENCE",
      enabled: true,
      expectedRevision: candidate,
      fetchImpl: fetchFor(
        {
          app: { configured: true, missing: [] },
          database: {
            configured: false,
            missing: ["SUPABASE_URL", "unsafe provider value", "SUPABASE_URL"],
          },
        },
        "b".repeat(40),
      ),
      gate: 11,
      mlActorConfigured: false,
      now: fixedNow,
      origin,
    });

    expect(report.result).toBe("blocked");
    expect(report.blockers).toEqual([
      "configuration_database_incomplete",
      "ml_platform_actor_missing",
      "runtime_revision_mismatch",
    ]);
    expect(report.configuration.database.missing).toEqual(["SUPABASE_URL"]);
    expect(JSON.stringify(report)).not.toContain("unsafe provider value");
  });

  it("does not retain an unexpected runtime environment value", async () => {
    const fetchImpl = vi.fn(async (url) =>
      String(url).endsWith("/api/health")
        ? jsonResponse({
            data: {
              environment: "production-secret-context",
              revision: candidate,
              service: "vinifera-api",
              status: "ok",
            },
          })
        : jsonResponse({
            data: {
              app: { configured: true, missing: [] },
              database: { configured: true, missing: [] },
            },
          }),
    );
    const report = await collectHostedGateEvidence({
      confirmation: "COLLECT VINIFERA GATE 10 READINESS EVIDENCE",
      enabled: true,
      expectedRevision: candidate,
      fetchImpl,
      gate: 10,
      now: fixedNow,
      origin,
    });

    expect(report.runtime.environment).toBeNull();
    expect(report.blockers).toContain("runtime_environment_mismatch");
    expect(JSON.stringify(report)).not.toContain("production-secret-context");
  });

  it("selects only gate-specific configuration and never claims completion", async () => {
    expect(requiredConfigurationForGate(13)).toEqual([
      "billing",
      "compliance",
      "shipping",
    ]);
    const report = await collectHostedGateEvidence({
      confirmation: "COLLECT VINIFERA GATE 13 READINESS EVIDENCE",
      enabled: true,
      expectedRevision: candidate,
      fetchImpl: fetchFor({
        billing: { configured: true, missing: [] },
        compliance: { configured: true, missing: [] },
        shipping: { configured: true, missing: [] },
        unrelatedSecret: { configured: true, missing: ["SENSITIVE_VALUE"] },
      }),
      gate: 13,
      now: fixedNow,
      origin,
    });

    expect(report.result).toBe("ready");
    expect(report.configuration).not.toHaveProperty("unrelatedSecret");
    expect(report.completionClaimed).toBe(false);
    expect(report.externalEvidenceRemaining).toContain(
      "vendor-sandbox-contract",
    );
  });

  it("runs Gate 15 core evidence only after exact runtime readiness", async () => {
    const gate15Collector = vi.fn(async () => ({
      result: "core-ready",
      completionClaimed: false,
      externalEvidenceRemaining: ["hostname-context-after-gate-16"],
    }));
    const report = await collectHostedGateEvidence({
      confirmation: "COLLECT VINIFERA GATE 15 READINESS EVIDENCE",
      enabled: true,
      expectedRevision: candidate,
      fetchImpl: fetchFor({
        app: { configured: true, missing: [] },
        billing: { configured: true, missing: [] },
        database: { configured: true, missing: [] },
        security: { configured: true, missing: [] },
      }),
      gate: 15,
      gate15Collector,
      gate15Options: { marker: "bounded" },
      now: fixedNow,
      origin,
    });
    expect(gate15Collector).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: candidate,
        marker: "bounded",
        workerOrigin: origin,
      }),
    );
    expect(report.result).toBe("ready");
    expect(report.gateSpecificEvidence.result).toBe("core-ready");
    expect(report.completionClaimed).toBe(false);
  });

  it("requires an explicit gate toggle, exact confirmation, SHA, and canonical origin", async () => {
    const base = {
      confirmation: "COLLECT VINIFERA GATE 10 READINESS EVIDENCE",
      enabled: true,
      expectedRevision: candidate,
      fetchImpl: vi.fn(),
      gate: 10,
      origin,
    };
    await expect(
      collectHostedGateEvidence({ ...base, enabled: false }),
    ).rejects.toThrow(/not enabled/);
    await expect(
      collectHostedGateEvidence({
        ...base,
        confirmation: "COLLECT SOMETHING ELSE",
      }),
    ).rejects.toThrow(/confirmation is invalid/);
    await expect(
      collectHostedGateEvidence({ ...base, expectedRevision: "main" }),
    ).rejects.toThrow(/40-character/);
    await expect(
      collectHostedGateEvidence({ ...base, origin: `${origin}/api` }),
    ).rejects.toThrow(/canonical HTTPS Worker origin/);
    await expect(
      collectHostedGateEvidence({
        ...base,
        origin: "https://attacker.example",
      }),
    ).rejects.toThrow(/not an approved staging target/);
    expect(base.fetchImpl).not.toHaveBeenCalled();
  });

  it("wires opt-in sanitized artifacts and the ML actor into the staging deployment", async () => {
    const workflow = await readFile(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toContain(
      "ML_PLATFORM_ACTOR_USER_ID: ${{ secrets.STAGING_ML_PLATFORM_ACTOR_USER_ID }}",
    );
    expect(workflow).toContain("STAGING_GATE_10_EVIDENCE_ENABLED");
    expect(workflow).toContain("STAGING_GATE_16_EVIDENCE_ENABLED");
    expect(workflow).toContain("scripts/hosted-gates10-16-evidence.mjs");
    expect(workflow).toContain("hosted-gates10-16-readiness");
    expect(workflow).toContain("completionClaimed");
  });
});
