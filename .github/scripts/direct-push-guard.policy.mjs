import assert from "node:assert/strict";
import test from "node:test";

import { findMergeEvidence, verifyMainPush } from "./direct-push-guard.mjs";

const PUSHED_SHA = "a".repeat(40);
const REPOSITORY = "theonlygeranium/vinifera";

function pullRequest(overrides = {}) {
  return {
    number: 42,
    state: "closed",
    merged_at: "2026-07-27T12:00:00Z",
    merge_commit_sha: PUSHED_SHA,
    html_url: "https://github.com/theonlygeranium/vinifera/pull/42",
    base: {
      ref: "main",
      repo: {
        full_name: REPOSITORY,
      },
    },
    ...overrides,
  };
}

function pushEnvironment(overrides = {}) {
  return {
    GITHUB_API_URL: "https://api.github.test",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF_NAME: "main",
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_SHA: PUSHED_SHA,
    GITHUB_TOKEN: "test-token",
    PUSH_FORCED: "false",
    TARGET_BRANCH: "main",
    ...overrides,
  };
}

test("accepts the exact recorded merge result for every GitHub merge strategy", () => {
  for (const strategy of ["merge commit", "squash", "rebase"]) {
    const evidence = findMergeEvidence([pullRequest({ title: strategy })], {
      repository: REPOSITORY,
      targetBranch: "main",
      pushedSha: PUSHED_SHA,
    });
    assert.equal(evidence?.number, 42);
  }
});

test("rejects open, unmerged, wrong-base, wrong-repository, and nonmatching records", () => {
  const candidates = [
    pullRequest({ state: "open" }),
    pullRequest({ merged_at: null }),
    pullRequest({ base: { ref: "develop", repo: { full_name: REPOSITORY } } }),
    pullRequest({
      base: { ref: "main", repo: { full_name: "another/repository" } },
    }),
    pullRequest({ merge_commit_sha: "b".repeat(40) }),
  ];

  assert.equal(
    findMergeEvidence(candidates, {
      repository: REPOSITORY,
      targetBranch: "main",
      pushedSha: PUSHED_SHA,
    }),
    undefined,
  );
});

test("accepts a push only when the associated-PR API returns exact merge evidence", async () => {
  let requestedUrl;
  const fetchImplementation = async (url, options) => {
    requestedUrl = url;
    assert.equal(options.headers.Authorization, "Bearer test-token");
    return {
      ok: true,
      status: 200,
      json: async () => [pullRequest()],
    };
  };

  const evidence = await verifyMainPush({
    environment: pushEnvironment(),
    fetchImplementation,
    output: { log() {} },
  });

  assert.equal(evidence.number, 42);
  assert.equal(
    requestedUrl,
    `https://api.github.test/repos/theonlygeranium/vinifera/commits/${PUSHED_SHA}/pulls?per_page=100`,
  );
});

test("rejects a direct push even when its commit message could be conventional", async () => {
  await assert.rejects(
    verifyMainPush({
      environment: pushEnvironment({ HEAD_COMMIT_MSG: "fix: bypass the old heuristic" }),
      fetchImplementation: async () => ({
        ok: true,
        status: 200,
        json: async () => [],
      }),
      output: { log() {} },
    }),
    /no merged pull request/,
  );
});

test("rejects forced updates before calling GitHub", async () => {
  let called = false;

  await assert.rejects(
    verifyMainPush({
      environment: pushEnvironment({ PUSH_FORCED: "true" }),
      fetchImplementation: async () => {
        called = true;
      },
      output: { log() {} },
    }),
    /forced update/,
  );

  assert.equal(called, false);
});

test("fails closed when associated-PR evidence cannot be retrieved", async () => {
  await assert.rejects(
    verifyMainPush({
      environment: pushEnvironment(),
      fetchImplementation: async () => ({
        ok: false,
        status: 503,
      }),
      output: { log() {} },
    }),
    /GitHub API 503/,
  );
});
