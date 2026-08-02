import { pathToFileURL } from "node:url";

import { executeConfigAsCodeRunbook } from "./octopus-runbook.mjs";

// ---------------------------------------------------------------------------
// Security-audit-specific runner
// ---------------------------------------------------------------------------

function resolveAuditBranch(values) {
  return values.PR_BRANCH ?? values.GITHUB_REF_NAME ?? "main";
}

function hasPrompt(preview, promptName) {
  return preview?.Form?.Elements?.some(
    (element) => element?.Control?.Name === promptName,
  );
}

function addPromptIfPresent(preview, promptedValues, promptName, value) {
  if (hasPrompt(preview, promptName)) {
    promptedValues[promptName] = value;
  }
}

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
    promptedValuesResolver: (preview, values) => {
      const branch = resolveAuditBranch(values);
      const sha = values.GITHUB_SHA ?? "0".repeat(40);
      const promptedValues = {};
      addPromptIfPresent(preview, promptedValues, "PRBranch", branch);
      addPromptIfPresent(preview, promptedValues, "PRNumber", "0");
      addPromptIfPresent(preview, promptedValues, "ExpectedBaseRef", branch);
      addPromptIfPresent(preview, promptedValues, "ExpectedBaseSHA", sha);
      addPromptIfPresent(preview, promptedValues, "ExpectedHeadSHA", sha);
      if (values.GH_PAT_FOR_OCTOPUS) {
        promptedValues.GitHubPAT = values.GH_PAT_FOR_OCTOPUS;
      }
      return promptedValues;
    },
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
