import { pathToFileURL } from "node:url";

const TERMINAL_FAILURE_STATES = new Set(["Canceled", "Failed", "TimedOut"]);

export function normalizeApiBase(serverUrl) {
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

function safeHeaderToken(value) {
  if (!value) return "absent";
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9.+/-]/g, "_")
    .slice(0, 80);
}

export function responseProvenance(response) {
  const location = response.headers.get("location");
  let redirectHost = "absent";
  if (location) {
    try {
      redirectHost = safeHeaderToken(new URL(location).hostname);
    } catch {
      redirectHost = "invalid";
    }
  }

  return [
    `server=${safeHeaderToken(response.headers.get("server"))}`,
    `cf-ray=${response.headers.has("cf-ray") ? "present" : "absent"}`,
    `content-type=${safeHeaderToken(
      response.headers.get("content-type")?.split(";", 1)[0],
    )}`,
    `redirect-host=${redirectHost}`,
  ].join("; ");
}

function requestTarget(url, method) {
  const parsed = new URL(url);
  return `${method ?? "GET"} ${parsed.pathname}`;
}

export async function requestJson(
  fetchImpl,
  url,
  authenticationHeaders,
  options = {},
) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Vinifera-GitHub-Actions/1.0",
      ...authenticationHeaders,
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(
      `Octopus API request failed for ${requestTarget(
        url,
        options.method,
      )} with HTTP ${response.status} (${responseProvenance(response)})`,
    );
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function findByName(
  fetchImpl,
  apiBase,
  authenticationHeaders,
  path,
  name,
) {
  const query = new URLSearchParams({
    partialName: name,
    skip: "0",
    take: "100",
  });
  const payload = await requestJson(
    fetchImpl,
    `${apiBase}/${path}?${query}`,
    authenticationHeaders,
  );
  const match = resourceItems(payload).find((item) => item.Name === name);
  if (!match) {
    throw new Error(`Octopus resource not found: ${path} / ${name}`);
  }
  return match;
}

export function resolveFormValues(preview, promptedValues) {
  const elements = preview?.Form?.Elements;
  if (!Array.isArray(elements)) {
    throw new Error("Octopus runbook preview did not include form elements");
  }

  const formValues = {};
  const matchedNames = new Set();
  for (const element of elements) {
    const promptName = element?.Control?.Name;
    if (!promptName) continue;

    if (Object.hasOwn(promptedValues, promptName)) {
      if (
        promptName === "GitHubPAT" &&
        !isSensitivePromptControl(element.Control)
      ) {
        throw new Error(
          "Octopus GitHubPAT prompted variable must be marked sensitive",
        );
      }
      formValues[element.Name] = promptedValues[promptName];
      matchedNames.add(promptName);
    } else if (element?.Control?.Required) {
      throw new Error(`Missing required Octopus prompted variable: ${promptName}`);
    }
  }

  for (const promptName of Object.keys(promptedValues)) {
    if (!matchedNames.has(promptName)) {
      throw new Error(`Octopus prompted variable not found: ${promptName}`);
    }
  }

  return formValues;
}

function isSensitivePromptControl(control) {
  if (control?.Sensitive === true) return true;
  const typeMarkers = [
    control?.$type,
    control?.Type,
    control?.ControlType,
    control?.DisplaySettings?.ControlType,
    control?.DisplaySettings?.["Octopus.ControlType"],
  ];
  return typeMarkers.some(
    (marker) =>
      typeof marker === "string" && marker.toLowerCase().includes("sensitive"),
  );
}

export function credentialShapeSummary(environment) {
  const credentials = [
    ["cf-client-id", environment.CF_ACCESS_CLIENT_ID],
    ["cf-client-secret", environment.CF_ACCESS_CLIENT_SECRET],
    ["octopus-api-key", environment.OCTOPUS_API_KEY],
  ];
  const summaries = credentials.map(([name, value]) => {
    if (!/^[\x21-\x7e]+$/.test(value)) {
      throw new Error(`${name} must contain visible ASCII characters only`);
    }
    return `${name}-chars=${value.length}`;
  });
  summaries.push(`octopus-host=${new URL(environment.OCTOPUS_URL).hostname}`);
  return `Octopus credential shape accepted: ${summaries.join("; ")}`;
}

export function configAsCodeRunbooksPath(projectId, gitRef) {
  if (!/^Projects-\d+$/.test(projectId)) {
    throw new Error("Octopus project ID has an unexpected shape");
  }
  if (!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(gitRef)) {
    throw new Error("OCTOPUS_GIT_REF must be an exact refs/heads/* reference");
  }
  // Octopus CaC API requires the bare branch name in the path segment.
  // e.g. refs/heads/main -> projects/{id}/main/runbooks
  // encodeURIComponent produces refs%2Fheads%2Fmain which returns HTTP 404.
  const branchName = gitRef.replace(/^refs\/heads\//, "");
  return `projects/${projectId}/${branchName}/runbooks`;
}

export async function executeConfigAsCodeRunbook({
  runbookName,
  environment = process.env,
  requiredEnvironment = [],
  validateEnvironment = () => {},
  promptedValuesResolver = () => ({}),
  fetchImpl = fetch,
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  pollIntervalMs = 5_000,
  timeoutMs = 15 * 60_000,
  log = console.log,
}) {
  const required = [
    "CF_ACCESS_CLIENT_ID",
    "CF_ACCESS_CLIENT_SECRET",
    "OCTOPUS_API_KEY",
    "OCTOPUS_URL",
    ...requiredEnvironment,
  ];
  for (const name of new Set(required)) {
    if (!environment[name]) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
  }
  if (!runbookName) throw new Error("Runbook name is required");
  validateEnvironment(environment);

  log(credentialShapeSummary(environment));
  const apiBase = normalizeApiBase(environment.OCTOPUS_URL);
  const authenticationHeaders = {
    "CF-Access-Client-Id": environment.CF_ACCESS_CLIENT_ID,
    "CF-Access-Client-Secret": environment.CF_ACCESS_CLIENT_SECRET,
    "X-Octopus-ApiKey": environment.OCTOPUS_API_KEY,
  };
  const space = await findByName(
    fetchImpl,
    apiBase,
    authenticationHeaders,
    "spaces",
    "Default",
  );
  const spaceBase = `${apiBase}/${space.Id}`;
  const octopusEnvironment = await findByName(
    fetchImpl,
    spaceBase,
    authenticationHeaders,
    "environments",
    "Development",
  );
  const project = await findByName(
    fetchImpl,
    spaceBase,
    authenticationHeaders,
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
    authenticationHeaders,
    runbooksPath,
    runbookName,
  );

  const preview = await requestJson(
    fetchImpl,
    `${spaceBase}/${runbooksPath}/${runbook.Slug}/runbookRuns/preview/${octopusEnvironment.Id}?includeDisabledSteps=true`,
    authenticationHeaders,
  );
  const formValues = resolveFormValues(
    preview,
    promptedValuesResolver(preview, environment),
  );
  const snapshotTemplate = await requestJson(
    fetchImpl,
    `${spaceBase}/${runbooksPath}/${runbook.Slug}/runbookSnapShotTemplate`,
    authenticationHeaders,
  );
  if (
    (snapshotTemplate.Packages?.length ?? 0) !== 0 ||
    (snapshotTemplate.GitResources?.length ?? 0) !== 0
  ) {
    throw new Error(
      `${runbookName} must not require package or Git-resource selection`,
    );
  }

  const groupedRun = await requestJson(
    fetchImpl,
    `${spaceBase}/${runbooksPath}/${runbook.Slug}/run/v1`,
    authenticationHeaders,
    {
      method: "POST",
      body: JSON.stringify({
        SelectedGitResources: [],
        SelectedPackages: [],
        Runs: [
          {
            EnvironmentId: octopusEnvironment.Id,
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

  log(`Octopus runbook queued: ${runbookName} task=${run.TaskId}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await requestJson(
      fetchImpl,
      `${apiBase}/tasks/${run.TaskId}`,
      authenticationHeaders,
    );
    if (task.State === "Success") {
      log(`Octopus runbook passed: ${runbookName} task=${run.TaskId}`);
      return { runId: run.Id, taskId: run.TaskId, state: task.State };
    }
    if (TERMINAL_FAILURE_STATES.has(task.State)) {
      throw new Error(`Octopus runbook ended in state: ${task.State} task=${run.TaskId}`);
    }
    await sleep(pollIntervalMs);
  }

  try {
    await requestJson(
      fetchImpl,
      `${apiBase}/tasks/${run.TaskId}/cancel`,
      authenticationHeaders,
      { method: "POST", body: "{}" },
    );
  } catch (error) {
    log(
      `Failed to cancel Octopus task ${run.TaskId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  throw new Error(`Octopus runbook timed out after ${timeoutMs}ms`);
}

export async function runRunbook({
  runbookName,
  environment = process.env,
  fetchImpl = fetch,
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  pollIntervalMs = 5_000,
  timeoutMs = 15 * 60_000,
  log = console.log,
}) {
  return executeConfigAsCodeRunbook({
    runbookName,
    environment,
    requiredEnvironment: [
      "PR_BRANCH",
      "PR_EXPECTED_BASE_REF",
      "PR_EXPECTED_BASE_SHA",
      "PR_EXPECTED_SHA",
      "PR_NUMBER",
    ],
    validateEnvironment: (values) => {
      if (!/^[0-9a-f]{40}$/.test(values.PR_EXPECTED_SHA)) {
        throw new Error("PR_EXPECTED_SHA must be an exact lowercase commit SHA");
      }
      if (!/^[0-9a-f]{40}$/.test(values.PR_EXPECTED_BASE_SHA)) {
        throw new Error(
          "PR_EXPECTED_BASE_SHA must be an exact lowercase commit SHA",
        );
      }
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(
          values.PR_EXPECTED_BASE_REF,
        )
      ) {
        throw new Error("PR_EXPECTED_BASE_REF contains unsupported characters");
      }
    },
    promptedValuesResolver: (preview, values) => {
      const promptedValues = {
        PRBranch: values.PR_BRANCH,
        ExpectedBaseRef: values.PR_EXPECTED_BASE_REF,
        ExpectedBaseSHA: values.PR_EXPECTED_BASE_SHA,
        ExpectedHeadSHA: values.PR_EXPECTED_SHA,
        PRNumber: values.PR_NUMBER,
      };
      const hasStaleGitHubPatPrompt = preview?.Form?.Elements?.some(
        (element) => element?.Control?.Name === "GitHubPAT",
      );
      if (hasStaleGitHubPatPrompt) {
        promptedValues.GitHubPAT = "unused-stale-octopus-prompt";
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
  await runRunbook({ runbookName: process.argv[2] });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
