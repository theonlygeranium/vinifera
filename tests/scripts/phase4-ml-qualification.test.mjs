import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  qualifyPhase4Ml,
  qualificationRpcPayload,
  validateQualificationEvidence,
} from "../../scripts/qualify-phase4-ml.mjs";

const actorUserId = "a1000000-0000-4000-8000-000000000001";
const evidence = {
  datasetHash: "a".repeat(64),
  sourceCoverage: {
    eligible_member_count: 500,
    reconciled_through: "2026-07-01",
    sources: Object.fromEntries(
      [
        "shipments",
        "billing",
        "email_delivery",
        "portal_activity",
        "loyalty",
        "declines",
      ].map((source) => [
        source,
        {
          eligible_member_count: 500,
          reconciled_member_count: 500,
        },
      ]),
    ),
  },
  status: "qualified",
  trainingRunId: "a2000000-0000-4000-8000-000000000001",
};

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function evidenceFile(value = evidence) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "vinifera-phase4-qualification-"),
  );
  temporaryDirectories.push(directory);
  const filename = path.join(directory, "qualification.json");
  await fs.writeFile(filename, JSON.stringify(value), "utf8");
  return filename;
}

describe("Phase 4 ML qualification operator command", () => {
  it("validates every required source denominator", () => {
    const invalid = structuredClone(evidence);
    delete invalid.sourceCoverage.sources.declines;
    expect(() => validateQualificationEvidence(invalid)).toThrow(
      /sources\.declines is required/,
    );
    const underReconciled = structuredClone(evidence);
    underReconciled.sourceCoverage.sources.billing.reconciled_member_count =
      474;
    expect(() => validateQualificationEvidence(underReconciled)).toThrow(
      /at least 95 percent/,
    );
  });

  it("builds the five-argument, database-hashed RPC payload", () => {
    const payload = qualificationRpcPayload(
      validateQualificationEvidence(evidence),
      actorUserId,
    );
    expect(payload).toEqual({
      p_actor_user_id: actorUserId,
      p_dataset_hash: evidence.datasetHash,
      p_source_coverage: evidence.sourceCoverage,
      p_status: "qualified",
      p_training_run_id: evidence.trainingRunId,
    });
    expect(payload).not.toHaveProperty("p_evidence_hash");
  });

  it("dry-runs without credentials or a provider call", async () => {
    const filename = await evidenceFile();
    const fetcher = vi.fn();
    const log = vi.fn();
    const result = await qualifyPhase4Ml({
      argv: ["--evidence", filename, "--dry-run"],
      env: { ML_PLATFORM_ACTOR_USER_ID: actorUserId },
      fetcher,
      log,
    });
    expect(result.dryRun).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"dryRun":true'),
    );
  });

  it("calls only the guarded RPC and never logs the database secret", async () => {
    const filename = await evidenceFile();
    const log = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          evidence_hash: "b".repeat(64),
          qualified_at: "2026-07-26T12:00:00.000Z",
          status: "qualified",
          training_run_id: evidence.trainingRunId,
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    await qualifyPhase4Ml({
      argv: ["--evidence", filename],
      env: {
        ML_PLATFORM_ACTOR_USER_ID: actorUserId,
        SUPABASE_SERVICE_ROLE_KEY: "server-secret",
        SUPABASE_URL: "https://project.supabase.co",
      },
      fetcher,
      log,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://project.supabase.co/rest/v1/rpc/record_ml_training_source_qualification",
      expect.objectContaining({
        body: expect.not.stringContaining("evidence_hash"),
        method: "POST",
        redirect: "error",
      }),
    );
    expect(log.mock.calls.flat().join(" ")).not.toContain("server-secret");
  });
});
