import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateAutomergeCandidate,
  readDeliveryRiskContract,
  requiredAutomergeContexts,
} from "./dev-automerge-policy.mjs";

const contract = readDeliveryRiskContract();
const sha = "a".repeat(40);
const base = "b".repeat(40);

function candidate(overrides = {}) {
  return {
    contract,
    repository: "theonlygeranium/vinifera",
    currentBaseSha: base,
    pullRequest: {
      state: "open",
      draft: false,
      baseRef: "dev",
      baseSha: base,
      headSha: sha,
      baseRepository: "theonlygeranium/vinifera",
      headRepository: "theonlygeranium/vinifera",
      labels: ["codex-auto-merge"],
    },
    classification: {
      classificationSucceeded: true,
      risk: "medium",
      previewRequired: false,
    },
    contexts: [{ name: "Dev fast checks", state: "success" }],
    activeChangesRequested: 0,
    ...overrides,
  };
}

test("machine-readable contract retains all fail-closed boundaries", () => {
  assert.equal(contract.targetBranch, "dev");
  assert.deepEqual(contract.allowedRisks, ["low", "medium"]);
  assert.deepEqual(contract.blockedRisks, ["high"]);
  assert.equal(contract.authorityLabel, "codex-auto-merge");
  assert.deepEqual(contract.emergencyLabels, [
    "human-review-required",
    "do-not-merge",
  ]);
  assert.equal(contract.sameRepositoryOnly, true);
  assert.equal(contract.requireCurrentBase, true);
  assert.equal(contract.requireNoActiveChangesRequested, true);
});

test("eligible exact candidate may merge", () => {
  assert.deepEqual(evaluateAutomergeCandidate(candidate()), {
    eligible: true,
    reason: "eligible_exact_candidate",
  });
});

test("low risk is eligible and high or failed classification is blocked", () => {
  assert.equal(
    evaluateAutomergeCandidate(
      candidate({
        classification: {
          classificationSucceeded: true,
          risk: "low",
        },
      }),
    ).eligible,
    true,
  );
  for (const classification of [
    { classificationSucceeded: true, risk: "high" },
    { classificationSucceeded: false, risk: "low" },
    { classificationSucceeded: true, risk: "unknown" },
  ]) {
    assert.equal(
      evaluateAutomergeCandidate(candidate({ classification })).reason,
      "risk_not_eligible",
    );
  }
});

test("authority, emergency labels, target, repository, and exact base fail closed", () => {
  const mutations = [
    {
      expected: "standing_authority_missing",
      pullRequest: { labels: [] },
    },
    {
      expected: "emergency_label_present",
      pullRequest: {
        labels: ["codex-auto-merge", "human-review-required"],
      },
    },
    {
      expected: "emergency_label_present",
      pullRequest: { labels: ["codex-auto-merge", "do-not-merge"] },
    },
    {
      expected: "base_not_current_target",
      pullRequest: { baseRef: "main" },
    },
    {
      expected: "base_not_current_target",
      currentBaseSha: "c".repeat(40),
      pullRequest: {},
    },
    {
      expected: "cross_repository_candidate",
      pullRequest: { headRepository: "fork/vinifera" },
    },
    {
      expected: "non_exact_revision",
      pullRequest: { headSha: "main" },
    },
  ];
  for (const mutation of mutations) {
    const state = candidate();
    if (mutation.currentBaseSha) state.currentBaseSha = mutation.currentBaseSha;
    Object.assign(state.pullRequest, mutation.pullRequest);
    assert.equal(
      evaluateAutomergeCandidate(state).reason,
      mutation.expected,
    );
  }
});

test("drafts, closed PRs, active requested changes, pending, skipped, and failed checks block", () => {
  for (const [expected, overrides] of [
    ["draft_pull_request", { pullRequest: { draft: true } }],
    ["pull_request_not_open", { pullRequest: { state: "closed" } }],
    [
      "blocking_changes_requested_review",
      { activeChangesRequested: 1 },
    ],
    [
      "required_context_pending",
      { contexts: [{ name: "Dev fast checks", state: "pending" }] },
    ],
    [
      "required_context_failed",
      { contexts: [{ name: "Dev fast checks", state: "failure" }] },
    ],
    [
      "required_context_failed",
      { contexts: [{ name: "Dev fast checks", state: "skipped" }] },
    ],
  ]) {
    const state = candidate();
    if (overrides.pullRequest) Object.assign(state.pullRequest, overrides.pullRequest);
    else Object.assign(state, overrides);
    assert.equal(evaluateAutomergeCandidate(state).reason, expected);
  }
});

test("required contexts union protection and frontend preview evidence", () => {
  assert.deepEqual(
    requiredAutomergeContexts({
      contract,
      protectedContexts: ["Security", "Dev fast checks"],
      previewRequired: true,
    }),
    ["Dev fast checks", "Frontend preview evidence", "Security"],
  );
  assert.deepEqual(
    requiredAutomergeContexts({ contract, previewRequired: false }),
    ["Dev fast checks"],
  );
});

test("trusted workflow uses no PR-head checkout and revalidates before merge", () => {
  const workflow = readFileSync(
    new URL("../workflows/dev-automerge.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /repository_dispatch:/);
  assert.match(workflow, /frontend_preview_evidence/);
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.doesNotMatch(workflow, /ref: \$\{\{[^}]*head/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /readDeliveryRiskContract/);
  assert.match(workflow, /active_changes_requested/);
  assert.match(workflow, /Evaluate exact candidate again immediately before merge/);
  assert.match(workflow, /pulls\/\$PR_NUMBER\/merge/);
  assert.match(workflow, /Could not read dev branch-protection contexts/);
  assert.match(workflow, /protected_contexts="\[\]"/);
  assert.match(
    workflow,
    /Preview dispatch no longer matches an open dev PR at this head\.[\s\S]*eligible=false[\s\S]*exit 0/,
  );
  assert.match(workflow, /state: \(\s*if \$name == "Dev fast checks"/s);
  assert.match(workflow, /def dev_fast_component_pending:/);
  assert.match(workflow, /\$name == "Dev fast checks" and dev_fast_component_pending/);
  assert.match(workflow, /for attempt in \{1\.\.12\}/);
  assert.match(workflow, /INELIGIBLE:required_context_pending/);
  assert.match(workflow, /sleep 10/);
  assert.match(workflow, /\]'\) \|\| return 1/);
  assert.match(workflow, /active_changes_requested=.*\|\| return 1/s);
  assert.match(workflow, /decision=.*\|\| return 1/s);
  const publisher = readFileSync(
    new URL("../workflows/frontend-preview-publish.yml", import.meta.url),
    "utf8",
  );
  assert.match(publisher, /repos\/\$REPOSITORY\/dispatches/);
  assert.match(publisher, /event_type: \$event_type/);
});

test("trusted workflow binds required check-runs to the live PR base and head", () => {
  const workflow = readFileSync(
    new URL("../workflows/dev-automerge.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /--argjson pr_number "\$PR_NUMBER"/);
  assert.match(workflow, /--arg base_sha "\$base_sha"/);
  assert.match(workflow, /--arg head_sha "\$head_sha"/);
  assert.match(workflow, /\.number == \$pr_number/);
  assert.match(workflow, /\.base\.sha == \$base_sha/);
  assert.match(workflow, /\.head\.sha == \$head_sha/);
});
