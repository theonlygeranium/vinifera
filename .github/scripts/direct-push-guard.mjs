import { pathToFileURL } from "node:url";

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const MAX_PAGES = 10;
const MAX_EVIDENCE_ATTEMPTS = 3;
const EVIDENCE_RETRY_DELAY_MS = 10_000;
const GITHUB_REQUEST_TIMEOUT_MS = 5_000;

class GitHubRequestTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`GitHub associated-pull-request request timed out after ${timeoutMs}ms.`);
    this.name = "GitHubRequestTimeoutError";
  }
}

function requireValue(environment, name) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Direct Push Guard is missing required environment variable ${name}.`);
  }
  return value;
}

export function findMergeEvidence(pullRequests, { repository, targetBranch, pushedSha }) {
  if (!Array.isArray(pullRequests)) {
    throw new Error("GitHub returned an invalid associated-pull-request response.");
  }

  return pullRequests.find(
    (pullRequest) =>
      pullRequest?.state === "closed" &&
      typeof pullRequest.merged_at === "string" &&
      pullRequest.merged_at.length > 0 &&
      pullRequest?.base?.repo?.full_name === repository &&
      pullRequest?.base?.ref === targetBranch &&
      pullRequest.merge_commit_sha === pushedSha,
  );
}

export function findNextPage(linkHeader) {
  if (typeof linkHeader !== "string" || linkHeader.length === 0) {
    return undefined;
  }

  for (const link of linkHeader.split(",")) {
    const match = link.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"$/);
    if (match?.[2].split(/\s+/).includes("next")) {
      return match[1];
    }
  }

  return undefined;
}

async function fetchMergeEvidence({
  clearTimeoutImplementation,
  endpoint,
  fetchImplementation,
  headers,
  match,
  requestTimeoutMs,
  setTimeoutImplementation,
}) {
  const firstPage = new URL(endpoint);
  let pageUrl = firstPage.href;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const controller = new AbortController();
    const timeoutError = new GitHubRequestTimeoutError(requestTimeoutMs);
    let timeout;
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeoutImplementation(() => {
        controller.abort();
        reject(timeoutError);
      }, requestTimeoutMs);
    });
    let response;
    try {
      response = await Promise.race([
        fetchImplementation(pageUrl, {
          headers,
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
    } catch (error) {
      if (error === timeoutError || controller.signal.aborted) {
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeoutImplementation(timeout);
    }
    if (!response.ok) {
      throw new Error(
        `Direct Push Guard could not verify associated pull requests (GitHub API ${response.status}).`,
      );
    }

    const pullRequests = await response.json();
    const evidence = findMergeEvidence(pullRequests, match);
    if (evidence) {
      return evidence;
    }

    const nextPage = findNextPage(response.headers?.get?.("link"));
    if (!nextPage) {
      return undefined;
    }

    const parsedNextPage = new URL(nextPage);
    if (
      parsedNextPage.origin !== firstPage.origin ||
      parsedNextPage.pathname !== firstPage.pathname
    ) {
      throw new Error("GitHub returned an invalid associated-pull-request pagination link.");
    }
    pageUrl = parsedNextPage.href;
  }

  throw new Error(
    `Direct Push Guard exceeded its ${MAX_PAGES}-page associated-pull-request limit.`,
  );
}

export async function verifyMainPush({
  environment = process.env,
  fetchImplementation = globalThis.fetch,
  delayImplementation = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  output = console,
  requestTimeoutMs = GITHUB_REQUEST_TIMEOUT_MS,
  setTimeoutImplementation = setTimeout,
  clearTimeoutImplementation = clearTimeout,
} = {}) {
  const eventName = requireValue(environment, "GITHUB_EVENT_NAME");
  if (eventName !== "push") {
    throw new Error(`Direct Push Guard expected a push event, received ${eventName}.`);
  }

  if (environment.PUSH_FORCED === "true") {
    throw new Error("Direct Push Guard rejected a forced update to main.");
  }

  const repository = requireValue(environment, "GITHUB_REPOSITORY");
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error("Direct Push Guard received an invalid repository identifier.");
  }

  const targetBranch = requireValue(environment, "TARGET_BRANCH");
  const pushedBranch = requireValue(environment, "GITHUB_REF_NAME");
  if (pushedBranch !== targetBranch) {
    throw new Error(
      `Direct Push Guard expected branch ${targetBranch}, received ${pushedBranch}.`,
    );
  }

  const pushedSha = requireValue(environment, "GITHUB_SHA");
  if (!SHA_PATTERN.test(pushedSha)) {
    throw new Error("Direct Push Guard received an invalid commit SHA.");
  }

  const token = requireValue(environment, "GITHUB_TOKEN");
  const apiRoot = (environment.GITHUB_API_URL || "https://api.github.com").replace(
    /\/+$/,
    "",
  );
  const [owner, repo] = repository.split("/");
  const endpoint =
    `${apiRoot}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/commits/${encodeURIComponent(pushedSha)}/pulls?per_page=100`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const match = {
    repository,
    targetBranch,
    pushedSha,
  };

  for (let attempt = 1; attempt <= MAX_EVIDENCE_ATTEMPTS; attempt += 1) {
    let evidence;
    let timeoutError;
    try {
      evidence = await fetchMergeEvidence({
        clearTimeoutImplementation,
        endpoint,
        fetchImplementation,
        headers,
        match,
        requestTimeoutMs,
        setTimeoutImplementation,
      });
    } catch (error) {
      if (!(error instanceof GitHubRequestTimeoutError)) {
        throw error;
      }
      timeoutError = error;
    }

    if (evidence) {
      output.log(
        `Verified ${pushedSha} as the merge result of pull request #${evidence.number}: ${evidence.html_url}`,
      );
      return evidence;
    }

    if (attempt < MAX_EVIDENCE_ATTEMPTS) {
      output.log(
        `${timeoutError ? timeoutError.message : "Merge evidence is not indexed yet;"} ` +
          `retrying in ${EVIDENCE_RETRY_DELAY_MS / 1_000} seconds ` +
          `(attempt ${attempt + 1}/${MAX_EVIDENCE_ATTEMPTS}).`,
      );
      await delayImplementation(EVIDENCE_RETRY_DELAY_MS);
    } else if (timeoutError) {
      throw new Error(
        `Direct Push Guard could not retrieve merge evidence because GitHub requests timed out ` +
          `after ${MAX_EVIDENCE_ATTEMPTS} attempts.`,
      );
    }
  }

  throw new Error(
    `Direct Push Guard found no merged pull request whose ${targetBranch} merge result is ${pushedSha} ` +
      `after ${MAX_EVIDENCE_ATTEMPTS} attempts.`,
  );
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  verifyMainPush().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
