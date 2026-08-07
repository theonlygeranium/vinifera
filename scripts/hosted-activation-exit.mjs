import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const SAFE_EVIDENCE = /^[a-z0-9][a-z0-9._-]{2,119}$/u;

function exactCandidate(value) {
  const candidate = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!SHA.test(candidate))
    throw new Error("Activation exit requires one exact candidate SHA.");
  return candidate;
}

export function activationLedgerDigest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export function validateActivationLedger(ledger) {
  if (ledger?.version !== 1 || !Array.isArray(ledger.gates)) {
    throw new Error("Activation gate ledger version is unsupported.");
  }
  const gates = [...ledger.gates].sort((left, right) => left.gate - right.gate);
  if (
    gates.length !== 19 ||
    gates.some((entry, index) => entry.gate !== index + 1) ||
    new Set(gates.map((entry) => entry.gate)).size !== 19
  ) {
    throw new Error(
      "Activation gate ledger must contain Gates 1 through 19 exactly once.",
    );
  }
  for (const entry of gates) {
    if (
      entry.status !== "live-passed" ||
      !Array.isArray(entry.evidence) ||
      entry.evidence.length === 0 ||
      entry.evidence.some(
        (value) => typeof value !== "string" || !SAFE_EVIDENCE.test(value),
      )
    ) {
      throw new Error(
        `Activation Gate ${entry.gate} is not evidenced as live-passed.`,
      );
    }
  }
  return gates.map(({ evidence, gate }) => ({
    evidence: [...new Set(evidence)].sort(),
    gate,
    status: "live-passed",
  }));
}

export function createActivationExitEvidence({
  candidateRevision,
  ledger,
  ledgerSha256,
  now = () => new Date(),
}) {
  const digest = String(ledgerSha256 ?? "")
    .trim()
    .toLowerCase();
  if (!DIGEST.test(digest))
    throw new Error("Activation ledger digest is invalid.");
  return {
    schemaVersion: 1,
    candidateRevision: exactCandidate(candidateRevision),
    completionClaimed: false,
    evidenceLevel: "production-activation-exit",
    gates: validateActivationLedger(ledger),
    ledgerSha256: digest,
    result: "ready",
    capturedAt: now().toISOString(),
  };
}

export function verifyActivationExitEvidence({
  evidence,
  expectedRevision,
  ledgerSha256,
}) {
  if (
    evidence?.schemaVersion !== 1 ||
    evidence?.evidenceLevel !== "production-activation-exit" ||
    evidence?.result !== "ready" ||
    evidence?.completionClaimed !== false ||
    evidence?.candidateRevision !== exactCandidate(expectedRevision) ||
    evidence?.ledgerSha256 !==
      String(ledgerSha256 ?? "")
        .trim()
        .toLowerCase()
  ) {
    throw new Error(
      "Activation exit artifact does not match the reviewed production candidate.",
    );
  }
  validateActivationLedger({ version: 1, gates: evidence.gates });
  return true;
}

async function main() {
  const [operation, ledgerPath, evidencePath] = process.argv.slice(2);
  if (!operation || !ledgerPath || !evidencePath) {
    throw new Error(
      "Usage: hosted-activation-exit.mjs <create|verify> <ledger> <evidence>.",
    );
  }
  const ledgerContents = await readFile(ledgerPath);
  const ledgerSha256 = activationLedgerDigest(ledgerContents);
  const ledger = JSON.parse(ledgerContents.toString("utf8"));
  if (operation === "create") {
    const evidence = createActivationExitEvidence({
      candidateRevision: process.env.ACTIVATION_EXIT_GIT_SHA,
      ledger,
      ledgerSha256,
    });
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return;
  }
  if (operation === "verify") {
    verifyActivationExitEvidence({
      evidence: JSON.parse(await readFile(evidencePath, "utf8")),
      expectedRevision: process.env.ACTIVATION_EXIT_GIT_SHA,
      ledgerSha256,
    });
    return;
  }
  throw new Error("Activation exit operation is unsupported.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    console.error("Activation exit evidence validation failed.");
    process.exitCode = 1;
  });
}
