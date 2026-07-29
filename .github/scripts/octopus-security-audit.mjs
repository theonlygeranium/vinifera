import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Shared HTTP infrastructure (mirrors octopus-runbook.mjs)
// ---------------------------------------------------------------------------

const TERMINAL_FAILURE_STATES = new Set(["Canceled", "Failed", "TimedOut"]);

function normalizeApiBase(serverUrl) {
  const url = new URL(serverUrl);
  if (url.protocol !== "https:") {
    throw new Error("OCTOPUS_URL must use HTTPS");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname.endsWith("/api") ? pathname : `${pathname}/api`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function resourceItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.Items)) return payload.Items;
  throw new Error("Octopus returned an unexpected resource-list shape");
}

async function requestJson(fetchImpl, url, authHeaders, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Octopus API request failed with HTTP ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function findByName(fetchImpl, base, authHeaders, path, name) {
  const query = new URLSearchParams({ partialName: name, skip: "0", take: "100" });
  const payload = await requestJson(fetchImpl, `${base}/${path}?${query}`, authHeaders);
  const match = resourceItems(payload).find((item) => item.Name === name);
  if (!match) throw new Error(`Octopus resource not found: ${path} / ${name}`);
  return match;
}

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
    if (!environment[name]) throw new Error(`Missing required environment variable: ${name}`);
  }

  const apiBase = normalizeApiBase(environment.OCTOPUS_URL);
  const authHeaders = {
    "CF-Access-Client-Id": environment.CF_ACCESS_CLIENT_ID,
    "CF-Access-Client-Secret": environment.CF_ACCESS_CLIENT_SECRET,
    "X-Octopus-ApiKey": environment.OCTOPUS_API_KEY,
  };

  const space       = await findByName(fetchImpl, apiBase,     authHeaders, "spaces",                          "Default");
  const spaceBase   = `${apiBase}/${space.Id}`;
  const env         = await findByName(fetchImpl, spaceBase,   authHeaders, "environments",                    "Development");
  const project     = await findByName(fetchImpl, spaceBase,   authHeaders, "projects",                        "Vinifera");
  const runbook     = await findByName(fetchImpl, spaceBase,   authHeaders, `projects/${project.Id}/runbooks`, "Security Audit");

  if (!runbook.PublishedRunbookSnapshotId) {
    throw new Error("Octopus runbook has no published snapshot: Security Audit");
  }

  // Build form values — only include GitHubPAT if the runbook prompts for it.
  const preview = await requestJson(
    fetchImpl,
    `${spaceBase}/runbooks/${runbook.Id}/runbookRuns/preview/${env.Id}`,
    authHeaders,
  );

  const formValues = {};
  const ghPat = environment.GH_PAT_FOR_OCTOPUS;
  if (Array.isArray(preview?.Form?.Elements)) {
    for (const element of preview.Form.Elements) {
      const promptName = element?.Control?.Name;
      if (promptName === "GitHubPAT" && ghPat) {
        // Enforce sensitive control to prevent PAT leakage in audit logs.
        const isSensitive =
          element?.Control?.Sensitive === true ||
          ["$type", "Type", "ControlType"].some((k) =>
            typeof element?.Control?.[k] === "string" &&
            element.Control[k].toLowerCase().includes("sensitive"),
          );
        if (!isSensitive) {
          throw new Error("Octopus GitHubPAT prompted variable must be marked sensitive");
        }
        formValues[element.Name] = ghPat;
      } else if (element?.Control?.Required && !Object.hasOwn(formValues, element.Name)) {
        throw new Error(`Missing required Octopus prompted variable: ${promptName}`);
      }
    }
  }

  const run = await requestJson(fetchImpl, `${spaceBase}/runbookRuns`, authHeaders, {
    method: "POST",
    body: JSON.stringify({
      RunbookId: runbook.Id,
      RunbookSnapshotId: runbook.PublishedRunbookSnapshotId,
      FrozenRunbookProcessId: null,
      EnvironmentId: env.Id,
      TenantId: null,
      SkipActions: [],
      QueueTime: null,
      QueueTimeExpiry: null,
      FormValues: formValues,
      ForcePackageDownload: false,
      ForcePackageRedeployment: true,
      UseGuidedFailure: false,
      SpecificMachineIds: [],
      ExcludedMachineIds: [],
    }),
  });

  if (!run.TaskId) throw new Error("Octopus runbook response did not include a task ID");
  log("Octopus Security Audit runbook queued");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await requestJson(fetchImpl, `${apiBase}/tasks/${run.TaskId}`, authHeaders);
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
    await requestJson(fetchImpl, `${apiBase}/tasks/${run.TaskId}/cancel`, authHeaders, {
      method: "POST",
      body: "{}",
    });
  } catch (err) {
    log(`Failed to cancel Octopus task ${run.TaskId}: ${err instanceof Error ? err.message : String(err)}`);
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