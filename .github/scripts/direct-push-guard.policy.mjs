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

test("follows bounded pagination to find merge evidence on a later page", async () => {
  const requestedUrls = [];
  const responses = [
    {
      ok: true,
      status: 200,
      headers: {
        get: () =>
          `<https://api.github.test/repos/theonlygeranium/vinifera/commits/${PUSHED_SHA}/pulls?per_page=100&page=2>; rel="next"`,
      },
      json: async () => [pullRequest({ merge_commit_sha: "b".repeat(40) })],
    },
    {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => [pullRequest()],
    },
  ];

  const evidence = await verifyMainPush({
    environment: pushEnvironment(),
    fetchImplementation: async (url, options) => {
      requestedUrls.push(url);
      assert.equal(options.headers.Authorization, "Bearer test-token");
      return responses.shift();
    },
    delayImplementation: async () => {},
    output: { log() {} },
  });

  assert.equal(evidence.number, 42);
  assert.equal(requestedUrls.length, 2);
  assert.match(requestedUrls[1], /[?&]page=2(?:&|$)/);
});

test("rejects an untrusted pagination URL before forwarding authorization", async () => {
  let requests = 0;

  await assert.rejects(
    verifyMainPush({
      environment: pushEnvironment(),
      fetchImplementation: async () => {
        requests += 1;
        return {
          ok: true,
          status: 200,
          headers: {
            get: () =>
              `<https://attacker.example/steal?sha=${PUSHED_SHA}>; rel="next"`,
          },
          json: async () => [],
        };
      },
      delayImplementation: async () => {},
      output: { log() {} },
    }),
    /invalid associated-pull-request pagination link/,
  );

  assert.equal(requests, 1);
});

test("retries missing merge evidence with an injected zero-delay wait", async () => {
  let requests = 0;
  const delays = [];

  const evidence = await verifyMainPush({
    environment: pushEnvironment(),
    fetchImplementation: async () => {
      requests += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => (requests === 3 ? [pullRequest()] : []),
      };
    },
    delayImplementation: async (milliseconds) => {
      delays.push(milliseconds);
    },
    output: { log() {} },
  });

  assert.equal(evidence.number, 42);
  assert.equal(requests, 3);
  assert.deepEqual(delays, [10_000, 10_000]);
});

test("retries a bounded GitHub request timeout and then accepts exact evidence", async () => {
  let requests = 0;
  let timers = 0;
  const delays = [];
  const signals = [];

  const evidence = await verifyMainPush({
    clearTimeoutImplementation() {},
    delayImplementation: async (milliseconds) => {
      delays.push(milliseconds);
    },
    environment: pushEnvironment(),
    fetchImplementation: async (_url, options) => {
      requests += 1;
      signals.push(options.signal);
      if (requests === 1) {
        assert.equal(options.signal.aborted, true);
        throw new Error("aborted by deterministic test timeout");
      }
      assert.equal(options.signal.aborted, false);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [pullRequest()],
      };
    },
    output: { log() {} },
    requestTimeoutMs: 25,
    setTimeoutImplementation: (callback) => {
      timers += 1;
      if (timers === 1) callback();
      return timers;
    },
  });

  assert.equal(evidence.number, 42);
  assert.equal(requests, 2);
  assert.equal(signals.length, 2);
  assert.deepEqual(delays, [10_000]);
});

test("keeps GitHub response parsing inside the bounded request timeout", async () => {
  let requests = 0;
  let timeoutCallback;
  const delays = [];

  const evidencePromise = verifyMainPush({
    clearTimeoutImplementation() {},
    delayImplementation: async (milliseconds) => {
      delays.push(milliseconds);
    },
    environment: pushEnvironment(),
    fetchImplementation: async () => {
      requests += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json:
          requests === 1
            ? async () => {
                timeoutCallback();
                return new Promise(() => {});
              }
            : async () => [pullRequest()],
      };
    },
    output: { log() {} },
    requestTimeoutMs: 25,
    setTimeoutImplementation: (callback) => {
      timeoutCallback = callback;
      return requests + 1;
    },
  });

  const evidence = await evidencePromise;
  assert.equal(evidence.number, 42);
  assert.equal(requests, 2);
  assert.deepEqual(delays, [10_000]);
});

test("fails closed after three deterministic GitHub request timeouts", async () => {
  let requests = 0;
  const delays = [];

  await assert.rejects(
    verifyMainPush({
      clearTimeoutImplementation() {},
      delayImplementation: async (milliseconds) => {
        delays.push(milliseconds);
      },
      environment: pushEnvironment(),
      fetchImplementation: async (_url, options) => {
        requests += 1;
        assert.equal(options.signal.aborted, true);
        throw new Error("aborted by deterministic test timeout");
      },
      output: { log() {} },
      requestTimeoutMs: 25,
      setTimeoutImplementation: (callback) => {
        callback();
        return requests;
      },
    }),
    /requests timed out after 3 attempts/,
  );

  assert.equal(requests, 3);
  assert.deepEqual(delays, [10_000, 10_000]);
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
      delayImplementation: async () => {},
      output: { log() {} },
    }),
    /no merged pull request.*after 3 attempts/,
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
