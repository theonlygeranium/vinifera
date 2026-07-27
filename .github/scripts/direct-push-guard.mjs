import { pathToFileURL } from "node:url";

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

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

export async function verifyMainPush({
  environment = process.env,
  fetchImplementation = globalThis.fetch,
  output = console,
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

  const response = await fetchImplementation(endpoint, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Direct Push Guard could not verify associated pull requests (GitHub API ${response.status}).`,
    );
  }

  const pullRequests = await response.json();
  const evidence = findMergeEvidence(pullRequests, {
    repository,
    targetBranch,
    pushedSha,
  });

  if (!evidence) {
    throw new Error(
      `Direct Push Guard found no merged pull request whose ${targetBranch} merge result is ${pushedSha}.`,
    );
  }

  output.log(
    `Verified ${pushedSha} as the merge result of pull request #${evidence.number}: ${evidence.html_url}`,
  );
  return evidence;
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  verifyMainPush().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
