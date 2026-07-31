import { pathToFileURL } from "node:url";

import { executeConfigAsCodeRunbook } from "./octopus-runbook.mjs";

// ---------------------------------------------------------------------------
// Security-audit-specific runner (no PR variables required)
// ---------------------------------------------------------------------------

export async function runSecurityAudit({
  environment = process.env,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  pollIntervalMs = 5_000,
  timeoutMs = 15 * 60_000,
  log = console.log,
} = {}) {
  return executeConfigAsCodeRunbook({
    runbookName: "Security Audit",
    environment,
    promptedValuesResolver: (_preview, values) =>
      values.GH_PAT_FOR_OCTOPUS
        ? { GitHubPAT: values.GH_PAT_FOR_OCTOPUS }
        : {},
    fetchImpl,
    sleep,
    pollIntervalMs,
    timeoutMs,
    log,
  });
}

async function main() {
  await runSecurityAudit();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
