import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  activationLedgerDigest,
  createActivationExitEvidence,
  validateActivationLedger,
  verifyActivationExitEvidence,
} from "../../scripts/hosted-activation-exit.mjs";

const revision = "a".repeat(40);
const digest = "b".repeat(64);

function completeLedger() {
  return {
    version: 1,
    gates: Array.from({ length: 19 }, (_, index) => ({
      evidence: [`gate-${index + 1}-artifact`],
      gate: index + 1,
      status: "live-passed",
    })),
  };
}

describe("hosted activation exit evidence", () => {
  it("requires Gates 1 through 19 exactly once with retained evidence", () => {
    expect(validateActivationLedger(completeLedger())).toHaveLength(19);
    const pending = completeLedger();
    pending.gates[14] = { evidence: [], gate: 15, status: "pending" };
    expect(() => validateActivationLedger(pending)).toThrow(/Gate 15/);
    const duplicate = completeLedger();
    duplicate.gates[18].gate = 18;
    expect(() => validateActivationLedger(duplicate)).toThrow(/exactly once/);
  });

  it("binds the exit artifact to the exact current-main revision and ledger digest", () => {
    const evidence = createActivationExitEvidence({
      candidateRevision: revision,
      ledger: completeLedger(),
      ledgerSha256: digest,
      now: () => new Date("2026-08-06T12:00:00.000Z"),
    });
    expect(
      verifyActivationExitEvidence({
        evidence,
        expectedRevision: revision,
        ledgerSha256: digest,
      }),
    ).toBe(true);
    expect(() =>
      verifyActivationExitEvidence({
        evidence,
        expectedRevision: "c".repeat(40),
        ledgerSha256: digest,
      }),
    ).toThrow(/does not match/);
  });

  it("hashes the exact checked-in ledger bytes", () => {
    expect(activationLedgerDigest(Buffer.from("ledger"))).toMatch(
      /^[0-9a-f]{64}$/u,
    );
  });

  it("packages only an exact current-main ledger through a pinned read-only workflow", async () => {
    const workflow = await readFile(
      new URL(
        "../../.github/workflows/hosted-activation-exit.yml",
        import.meta.url,
      ),
      "utf8",
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain('[[ "$GITHUB_REF" == "refs/heads/main" ]]');
    expect(workflow).toContain(
      '[[ "$(git rev-parse origin/main)" == "$ACTIVATION_EXIT_GIT_SHA" ]]',
    );
    expect(workflow).toContain("retention-days: 90");
    expect(workflow).not.toMatch(/environment:\s+production/);
  });
});
