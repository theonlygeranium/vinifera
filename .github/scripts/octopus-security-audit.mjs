import { pathToFileURL } from "node:url";

import {
  configAsCodeRunbooksPath,
  credentialShapeSummary,
  findByName,
  normalizeApiBase,
  requestJson,
  resolveFormValues,
} from "./octopus-runbook.mjs";

const TERMINAL_FAILURE_STATES = new Set(["Canceled", "Failed", "TimedOut"]);

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
  const required = [
    "CF_ACCESS_CLIENT_ID",
    "CF_ACCESS_CLIENT_SECRET",
    "OCTOPUS_API_KEY",
    "OCTOPUS_URL",
  ];
  for (const name of required) {
    if (!environment[name]) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
  }

  log(credentialShapeSummary(environment));
  const apiBase = normalizeApiBase(environment.OCTOPUS_URL);
  const authHeaders = {
    "CF-Access-Client-Id": environment.CF_ACCESS_CLIENT_ID,
    "CF-Access-Client-Secret": environment.CF_ACCESS_CLIENT_SECRET,
    "X-Octopus-ApiKey": environment.OCTOPUS_API_KEY,
  };

  const space = await findByName(
    fetchImpl,
    apiBase,
    authHeaders,
    "spaces",
    "Default",
  );
  const spaceBase = `${apiBase}/${space.Id}`;
  const env = await findByName(
    fetchImpl,
    spaceBase,
    authHeaders,
    "environments",
    "Development",
  );
  const project = await findByName(
    fetchImpl,
    spaceBase,
    authHeaders,
    "projects",
    "Vinifera",
  );
  const runbooksPath = configAsCodeRunbooksPath(
    project.Id,
    environment.OCTOPUS_GIT_REF ?? "refs/heads/main",
  );
  const runbook = await findByName(
    fetchImpl,
    spaceBase,
    authHeaders,
    runbooksPath,
    "Security Audit",
  );

  // Build form values — only include GitHubPAT if the runbook prompts for it.
  const preview = await requestJson(
    fetchImpl,
    `${spaceBase}/${runbooksPath}/${runbook.Slug}/runbookRuns/preview/${env.Id}?includeDisabledSteps=true`,
    authHeaders,
  );

  const ghPat = environment.GH_PAT_FOR_OCTOPUS;
  const formValues = resolveFormValues(
    preview,
    ghPat ? { GitHubPAT: ghPat } : {},
  );

  const snapshotTemplate = await requestJson(
    fetchImpl,
    `${spaceBase}/${runbooksPath}/${runbook.Slug}/runbookSnapShotTemplate`,
    authHeaders,
  );
  if (
    (snapshotTemplate.Packages?.length ?? 0) !== 0 ||
    (snapshotTemplate.GitResources?.length ?? 0) !== 0
  ) {
    throw new Error(
      "Security Audit must not require package or Git-resource selection",
    );
  }

  const groupedRun = await requestJson(
    fetchImpl,
    `${spaceBase}/${runbooksPath}/${runbook.Slug}/run/v1`,
    authHeaders,
    {
      method: "POST",
      body: JSON.stringify({
        SelectedGitResources: [],
        SelectedPackages: [],
        Runs: [
          {
            EnvironmentId: env.Id,
            TenantId: null,
            SkipActions: [],
            QueueTime: null,
            QueueTimeExpiry: null,
            FormValues: formValues,
            ForcePackageDownload: false,
            UseGuidedFailure: false,
            SpecificMachineIds: [],
            ExcludedMachineIds: [],
          },
        ],
      }),
    },
  );
  const run = groupedRun?.Resources?.[0];

  if (!run?.TaskId) {
    throw new Error("Octopus runbook response did not include a task ID");
  }
  log("Octopus Security Audit runbook queued");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await requestJson(
      fetchImpl,
      `${apiBase}/tasks/${run.TaskId}`,
      authHeaders,
    );
    if (task.State === "Success") {
      log("Octopus Security Audit runbook passed");
      return { runId: run.Id, taskId: run.TaskId, state: task.State };
    }
    if (TERMINAL_FAILURE_STATES.has(task.State)) {
      throw new Error(`Octopus Security Audit runbook ended in state: ${task.State}`);
    }
    await sleep(pollIntervalMs);
  }

  // Cancel on timeout best-effort.
  try {
    await requestJson(
      fetchImpl,
      `${apiBase}/tasks/${run.TaskId}/cancel`,
      authHeaders,
      {
        method: "POST",
        body: "{}",
      },
    );
  } catch (err) {
    log(
      `Failed to cancel Octopus task ${run.TaskId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  throw new Error(`Octopus Security Audit runbook timed out after ${timeoutMs}ms`);
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
