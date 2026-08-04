import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyDeliveryChange,
  evaluateCandidateEvent,
  evaluateFastAggregate,
  evaluateFullAggregate,
  isAuthorityHighRiskPath,
  isBrowserRelevantPath,
  isHighRiskPath,
  isPromotionSmokePath,
  isStaticRoutingPath,
  isPreviewRelevantPath,
  parseNameStatusZ,
  selectFocusedTests,
} from "./delivery-policy.mjs";

const record = (status, ...paths) => ({ status, paths });

test("routine frontend changes select the fast routine lane", () => {
  const result = classifyDeliveryChange([
    record("M", "src/client/App.tsx"),
    record("M", "tests/client/loading-screen.test.tsx"),
  ]);
  assert.equal(result.classificationSucceeded, true);
  assert.equal(result.lane, "routine");
  assert.equal(result.mobileRequired, false);
  assert.equal(result.browserRequired, true);
  assert.equal(result.previewRequired, true);
  assert.equal(result.surface, "frontend");
  assert.equal(result.risk, "medium");
});

test("documentation-only changes select the documentation lane", () => {
  const result = classifyDeliveryChange([
    record("M", "README.md"),
    record("A", "docs/runbooks/fast-ci.md"),
  ]);
  assert.equal(result.lane, "docs");
  assert.equal(result.risk, "low");
  assert.equal(result.surface, "docs");
  assert.equal(result.browserRequired, false);
  assert.equal(result.previewRequired, false);
});

test("hidden promotion smoke artifacts select the smoke fast path", () => {
  const result = classifyDeliveryChange([
    record("A", "public/vinifera-promotion-smoke-2026-08-02.html"),
  ]);
  assert.equal(result.classificationSucceeded, true);
  assert.equal(result.lane, "promotion-smoke");
  assert.equal(result.reason, "hidden_promotion_smoke_allowlist_match");
  assert.equal(result.risk, "low");
  assert.equal(result.surface, "frontend");
  assert.equal(result.browserRequired, false);
  assert.equal(result.previewRequired, true);
  assert.equal(
    isPromotionSmokePath("public/vinifera-promotion-smoke-2026-08-02-extra.html"),
    true,
  );
  assert.equal(isPromotionSmokePath("public/smoke.html"), false);
});

test("retired smoke redirects select the static routing fast path", () => {
  const result = classifyDeliveryChange([
    record("M", "CHANGELOG.md"),
    record("M", "public/_redirects"),
  ]);
  assert.equal(result.classificationSucceeded, true);
  assert.equal(result.lane, "static-routing");
  assert.equal(result.reason, "static_routing_allowlist_match");
  assert.equal(result.risk, "medium");
  assert.equal(result.surface, "frontend");
  assert.equal(result.browserRequired, false);
  assert.equal(result.previewRequired, false);
  assert.equal(isStaticRoutingPath("public/_redirects"), true);
  assert.equal(isStaticRoutingPath("public/marketing.js"), false);
  assert.deepEqual(selectFocusedTests(result.paths, result.lane), [
    ".github/scripts/delivery-policy.policy.mjs",
    "tests/scripts/landing-static.test.mjs",
  ]);
});

test("hidden promotion smoke cleanup selects a bounded fast path", () => {
  const result = classifyDeliveryChange([
    record("D", "public/vinifera-promotion-smoke-2026-08-02-speed.html"),
    record("M", "public/_redirects"),
  ]);
  assert.equal(result.classificationSucceeded, true);
  assert.equal(result.lane, "promotion-smoke-cleanup");
  assert.equal(
    result.reason,
    "hidden_promotion_smoke_cleanup_allowlist_match",
  );
  assert.equal(result.risk, "low");
  assert.equal(result.surface, "frontend");
  assert.equal(result.browserRequired, false);
  assert.equal(result.previewRequired, false);
  assert.deepEqual(selectFocusedTests(result.paths, result.lane), [
    ".github/scripts/delivery-policy.policy.mjs",
    "tests/scripts/landing-static.test.mjs",
  ]);
});

test("promotion smoke cleanup accepts deletion when tombstone already exists", () => {
  const result = classifyDeliveryChange([
    record("D", "public/vinifera-promotion-smoke-2026-08-02-stale.html"),
  ]);
  assert.equal(result.classificationSucceeded, true);
  assert.equal(result.lane, "promotion-smoke-cleanup");
  assert.equal(
    result.reason,
    "hidden_promotion_smoke_cleanup_allowlist_match",
  );
  assert.equal(result.browserRequired, false);
  assert.equal(result.previewRequired, false);
});

test("protected branch reconciles stay on a fast non-mutating lane", () => {
  const result = classifyDeliveryChange(
    [
      record("M", ".github/workflows/frontend-preview-publish.yml"),
      record("M", "src/client/App.tsx"),
    ],
    { baseRef: "dev", headRef: "main" },
  );
  assert.equal(result.classificationSucceeded, true);
  assert.equal(result.lane, "protected-reconcile");
  assert.equal(result.reason, "protected_branch_reconcile");
  assert.equal(result.risk, "low");
  assert.equal(result.browserRequired, false);
  assert.equal(result.previewRequired, false);
  assert.deepEqual(selectFocusedTests(result.paths, result.lane), [
    ".github/scripts/delivery-policy.policy.mjs",
  ]);
});

test("narrow CI script and script-test patches select focused CI coverage", () => {
  const result = classifyDeliveryChange([
    record("M", ".github/scripts/delivery-policy.mjs"),
    record("M", "tests/scripts/two-speed-review-policy.test.mjs"),
  ]);
  assert.equal(result.classificationSucceeded, true);
  assert.equal(result.lane, "ci-script-tested");
  assert.equal(result.reason, "ci_script_test_allowlist_match");
  assert.equal(result.risk, "medium");
  assert.equal(result.browserRequired, false);
  assert.equal(result.previewRequired, false);
  assert.deepEqual(selectFocusedTests(result.paths, result.lane), [
    ".github/scripts/delivery-policy.policy.mjs",
    "tests/scripts",
  ]);
});

test("release-control workflow patches require changelog and select focused coverage", () => {
  const missingChangelog = classifyDeliveryChange([
    record("M", ".github/workflows/ci.yml"),
    record("M", ".github/scripts/delivery-policy.mjs"),
    record("M", "tests/scripts/workflow-promotion-smoke.test.mjs"),
  ]);
  assert.equal(missingChangelog.classificationSucceeded, false);
  assert.equal(missingChangelog.lane, "invalid");
  assert.equal(
    missingChangelog.reason,
    "release_control_fastlane_missing_changelog",
  );

  const result = classifyDeliveryChange([
    record("M", ".github/workflows/ci.yml"),
    record("M", ".github/scripts/delivery-policy.mjs"),
    record("M", "tests/scripts/workflow-promotion-smoke.test.mjs"),
    record("M", "AGENTS.md"),
    record("M", "docs/decisions/2026-07-28-automated-dev-staging-promotion.md"),
    record("M", "CHANGELOG.md"),
  ]);
  assert.equal(result.classificationSucceeded, true);
  assert.equal(result.lane, "release-control-tested");
  assert.equal(result.reason, "release_control_fastlane_allowlist_match");
  assert.equal(result.risk, "medium");
  assert.equal(result.browserRequired, false);
  assert.equal(result.previewRequired, false);
  assert.deepEqual(selectFocusedTests(result.paths, result.lane), [
    ".github/scripts/delivery-policy.policy.mjs",
    ".github/scripts/operator-tooling-policy.policy.mjs",
    "tests/scripts",
  ]);
});

test("operator tooling patches require changelog and select focused coverage", () => {
  const missingChangelog = classifyDeliveryChange([
    record("M", "package.json"),
    record("M", "scripts/promotion-smoke.mjs"),
    record("M", "tests/scripts/promotion-smoke.test.mjs"),
  ]);
  assert.equal(missingChangelog.classificationSucceeded, false);
  assert.equal(missingChangelog.lane, "invalid");
  assert.equal(
    missingChangelog.reason,
    "operator_tooling_fastlane_missing_changelog",
  );

  const result = classifyDeliveryChange([
    record("M", ".github/workflows/ci.yml"),
    record("M", "package.json"),
    record("M", "scripts/promotion-smoke.mjs"),
    record("M", "tests/scripts/promotion-smoke.test.mjs"),
    record("M", "CHANGELOG.md"),
  ]);
  assert.equal(result.classificationSucceeded, true);
  assert.equal(result.lane, "operator-tooling-tested");
  assert.equal(result.reason, "operator_tooling_fastlane_allowlist_match");
  assert.equal(result.risk, "medium");
  assert.equal(result.mobileRequired, false);
  assert.equal(result.browserRequired, false);
  assert.equal(result.previewRequired, false);
  assert.deepEqual(selectFocusedTests(result.paths, result.lane), [
    ".github/scripts/delivery-policy.policy.mjs",
    ".github/scripts/operator-tooling-policy.policy.mjs",
    "tests/scripts",
  ]);

  assert.equal(
    classifyDeliveryChange([
      record("M", "package.json"),
      record("M", "scripts/production-release.mjs"),
      record("M", "CHANGELOG.md"),
    ]).lane,
    "high-risk",
  );
});

test("candidate events distinguish draft WIP from coherent review heads", () => {
  assert.deepEqual(
    evaluateCandidateEvent({
      eventName: "pull_request",
      action: "opened",
      draft: true,
    }),
    { eligible: false, reason: "draft_not_candidate" },
  );
  for (const action of [
    "opened",
    "synchronize",
    "reopened",
    "ready_for_review",
  ]) {
    assert.equal(
      evaluateCandidateEvent({
        eventName: "pull_request",
        action,
        draft: false,
      }).eligible,
      true,
      action,
    );
  }
  assert.equal(
    evaluateCandidateEvent({
      eventName: "pull_request",
      action: "converted_to_draft",
      draft: true,
    }).eligible,
    false,
  );
  assert.deepEqual(
    evaluateCandidateEvent({ eventName: "workflow_dispatch" }),
    { eligible: true, reason: "manual_exact_candidate" },
  );
  assert.equal(
    evaluateCandidateEvent({ eventName: "push" }).eligible,
    false,
  );
});

test("browser and preview selection are path-aware", () => {
  for (const path of [
    "src/client/App.tsx",
    "public/marketing.js",
    "web/staff.html",
    "index.html",
  ]) {
    assert.equal(isBrowserRelevantPath(path), true, path);
    assert.equal(isPreviewRelevantPath(path), true, path);
  }
  for (const path of [
    "server/routes/members.ts",
    ".github/workflows/ci.yml",
    "tests/server/app.test.ts",
    "README.md",
  ]) {
    assert.equal(isBrowserRelevantPath(path), false, path);
    assert.equal(isPreviewRelevantPath(path), false, path);
  }
  assert.equal(isBrowserRelevantPath("tests/e2e/smoke.spec.ts"), true);
  assert.equal(isPreviewRelevantPath("tests/e2e/smoke.spec.ts"), false);
  assert.equal(isBrowserRelevantPath("playwright.config.ts"), true);
  assert.equal(isPreviewRelevantPath("playwright.config.ts"), false);
});

test("backend-only and workflow-only candidates avoid browser and preview work", () => {
  for (const [path, surface, risk] of [
    ["server/services/members.ts", "backend", "medium"],
    ["tests/server/app.test.ts", "test", "medium"],
  ]) {
    const result = classifyDeliveryChange([record("M", path)]);
    assert.equal(result.classificationSucceeded, true, path);
    assert.equal(result.lane, "high-risk", path);
    assert.equal(result.surface, surface, path);
    assert.equal(result.risk, risk, path);
    assert.equal(result.browserRequired, false, path);
    assert.equal(result.previewRequired, false, path);
  }
  const workflowOnly = classifyDeliveryChange([
    record("M", ".github/workflows/ci.yml"),
  ]);
  assert.equal(workflowOnly.classificationSucceeded, false);
  assert.equal(workflowOnly.lane, "invalid");
  assert.equal(
    workflowOnly.reason,
    "release_control_fastlane_missing_changelog",
  );
});

test("minimum mandated security and delivery paths are high-risk", () => {
  const paths = [
    "server/routes/auth.ts",
    "server/lib/authorization.ts",
    "server/services/stripe.ts",
    "server/services/members.ts",
    "supabase/migrations/999.sql",
    ".octopus/config.yml",
    "scripts/credential-envelope-rotation.mjs",
    "scripts/production-release.mjs",
    "wrangler.jsonc",
    "package-lock.json",
    ".nvmrc",
    "tests/e2e/smoke.spec.ts",
  ];
  for (const path of paths) {
    assert.equal(isHighRiskPath(path), true, path);
    assert.equal(classifyDeliveryChange([record("M", path)]).lane, "high-risk");
  }
  assert.equal(isHighRiskPath(".github/workflows/ci.yml"), true);
  assert.equal(
    classifyDeliveryChange([record("M", ".github/workflows/ci.yml")]).lane,
    "invalid",
  );
  for (const path of [
    "server/routes/auth.ts",
    "server/lib/authorization.ts",
    "server/services/stripe.ts",
    "supabase/migrations/999.sql",
    ".github/workflows/ci.yml",
    ".octopus/config.yml",
    "scripts/credential-envelope-rotation.mjs",
    "scripts/production-release.mjs",
    "wrangler.jsonc",
    "package-lock.json",
  ]) {
    assert.equal(isAuthorityHighRiskPath(path), true, path);
    assert.equal(classifyDeliveryChange([record("M", path)]).risk, "high");
  }
});

test("unknown paths are invalid and deletions fail closed to high-risk", () => {
  const unknown = classifyDeliveryChange([
    record("M", "unknown/new-format.bin"),
  ]);
  assert.equal(unknown.classificationSucceeded, false);
  assert.equal(unknown.lane, "invalid");
  assert.equal(unknown.risk, "high");
  assert.equal(unknown.surface, "unknown");
  assert.equal(
    classifyDeliveryChange([record("D", "src/client/Old.tsx")]).lane,
    "high-risk",
  );
});

test("fast aggregate requires the Octopus boundary for authority-high-risk work", () => {
  const state = {
    candidateEligible: true,
    candidateResult: "success",
    classificationSucceeded: true,
    lane: "high-risk",
    classifyResult: "success",
    docsResult: "skipped",
    checksResult: "success",
    smokeResult: "skipped",
    previewDecisionResult: "success",
    browserRequired: false,
    octopusRequired: true,
  };
  assert.deepEqual(evaluateFastAggregate(state), {
    passed: false,
    reason: "octopus_boundary_missing",
  });
  assert.equal(
    evaluateFastAggregate({ ...state, octopusBoundarySatisfied: true }).passed,
    true,
  );
});

test("empty diffs are explicit no-op deliveries", () => {
  const result = classifyDeliveryChange([]);
  assert.equal(result.classificationSucceeded, true);
  assert.equal(result.lane, "noop");
  assert.equal(result.reason, "empty_diff_noop");
  assert.equal(result.risk, "low");
  assert.equal(result.surface, "none");
  assert.deepEqual(result.paths, []);
  assert.deepEqual(selectFocusedTests([], "noop"), [
    ".github/scripts/delivery-policy.policy.mjs",
  ]);
});

test("malformed, unsupported, and unsafe diffs are invalid", () => {
  for (const records of [
    null,
    [{}],
    [record("U", "README.md")],
    [record("M", "../README.md")],
    [record("C100", "docs/a.md", "docs/b.md")],
  ]) {
    const result = classifyDeliveryChange(records);
    assert.equal(result.classificationSucceeded, false);
    assert.equal(result.lane, "invalid");
  }
});

test("NUL parser preserves rename paths and rejects truncation", () => {
  assert.deepEqual(
    parseNameStatusZ(Buffer.from("M\0README.md\0R100\0docs/a.md\0docs/b.md\0")),
    [record("M", "README.md"), record("R100", "docs/a.md", "docs/b.md")],
  );
  assert.throws(() => parseNameStatusZ(Buffer.from("R100\0docs/a.md\0")));
});

test("mobile selection covers native, Capacitor, shared mobile web, and dependencies", () => {
  for (const path of [
    "android/app/build.gradle",
    "ios/App/Info.plist",
    "mobile/app-identity.json",
    "src/client/mobile/session.ts",
    "capacitor.config.json",
    "package-lock.json",
  ]) {
    assert.equal(
      classifyDeliveryChange([record("M", path)]).mobileRequired,
      true,
      path,
    );
  }
});

test("focused tests reflect the changed domain", () => {
  const tests = selectFocusedTests(
    ["src/client/App.tsx", "server/routes/auth.ts", "scripts/build.mjs"],
    "high-risk",
  );
  assert.ok(tests.includes("tests/client"));
  assert.ok(tests.includes("tests/server"));
  assert.ok(tests.includes("tests/scripts"));
});

test("fast aggregate accepts only the selected successful lane", () => {
  assert.deepEqual(
    evaluateFastAggregate({
      classificationSucceeded: true,
      lane: "noop",
      classifyResult: "success",
      docsResult: "skipped",
      checksResult: "skipped",
      smokeResult: "skipped",
      previewDecisionResult: "success",
      browserRequired: false,
    }),
    { passed: true, reason: "noop_passed" },
  );
  assert.deepEqual(
    evaluateFastAggregate({
      classificationSucceeded: true,
      lane: "promotion-smoke",
      classifyResult: "success",
      docsResult: "skipped",
      checksResult: "success",
      smokeResult: "skipped",
      previewDecisionResult: "success",
      browserRequired: false,
    }),
    { passed: true, reason: "promotion_smoke_passed" },
  );
  assert.equal(
    evaluateFastAggregate({
      classificationSucceeded: true,
      lane: "routine",
      classifyResult: "success",
      docsResult: "skipped",
      checksResult: "success",
      smokeResult: "success",
      previewDecisionResult: "success",
      browserRequired: true,
    }).passed,
    true,
  );
  for (const lane of [
    "protected-reconcile",
    "ci-script-tested",
    "release-control-tested",
    "operator-tooling-tested",
    "static-routing",
    "promotion-smoke-cleanup",
  ]) {
    assert.equal(
      evaluateFastAggregate({
        candidateEligible: true,
        candidateResult: "success",
        classificationSucceeded: true,
        lane,
        classifyResult: "success",
        docsResult: "skipped",
        checksResult: "success",
        smokeResult: "skipped",
        previewDecisionResult: "success",
        browserRequired: false,
      }).passed,
      true,
      lane,
    );
  }
  assert.equal(
    evaluateFastAggregate({
      classificationSucceeded: true,
      lane: "docs",
      classifyResult: "success",
      docsResult: "skipped",
      checksResult: "skipped",
      smokeResult: "skipped",
      previewDecisionResult: "success",
    }).passed,
    false,
  );
  assert.equal(
    evaluateFastAggregate({
      classificationSucceeded: false,
      lane: "invalid",
      classifyResult: "success",
      docsResult: "skipped",
      checksResult: "skipped",
      smokeResult: "skipped",
      previewDecisionResult: "success",
    }).passed,
    false,
  );
  assert.equal(
    evaluateFastAggregate({
      candidateEligible: true,
      candidateResult: "success",
      classificationSucceeded: true,
      lane: "high-risk",
      classifyResult: "success",
      docsResult: "skipped",
      checksResult: "success",
      smokeResult: "skipped",
      previewDecisionResult: "success",
      browserRequired: false,
    }).passed,
    true,
  );
  assert.equal(
    evaluateFastAggregate({
      candidateEligible: false,
      candidateResult: "success",
      classificationSucceeded: false,
      lane: "",
      classifyResult: "skipped",
      docsResult: "skipped",
      checksResult: "skipped",
      smokeResult: "skipped",
      previewDecisionResult: "success",
      browserRequired: false,
    }).passed,
    false,
  );
  for (const result of ["cancelled", "failure", "timed_out"]) {
    assert.equal(
      evaluateFastAggregate({
        candidateEligible: true,
        candidateResult: "success",
        classificationSucceeded: true,
        lane: "routine",
        classifyResult: "success",
        docsResult: "skipped",
        checksResult: result,
        smokeResult: "success",
        previewDecisionResult: "success",
        browserRequired: true,
      }).passed,
      false,
      result,
    );
  }
  assert.equal(
    evaluateFastAggregate({
      candidateEligible: true,
      candidateResult: "success",
      classificationSucceeded: true,
      lane: "routine",
      classifyResult: "success",
      docsResult: "skipped",
      checksResult: "success",
      smokeResult: "success",
      previewDecisionResult: "cancelled",
      browserRequired: true,
    }).passed,
    false,
  );
});

test("full aggregate rejects skipped required work and permits one mobile lane", () => {
  assert.deepEqual(
    evaluateFullAggregate({
      classificationSucceeded: true,
      classifyResult: "success",
      lane: "noop",
      fullResult: "skipped",
      mobileRequired: false,
      mobileWebResult: "skipped",
      androidResult: "skipped",
    }),
    { passed: true, reason: "noop_passed" },
  );
  assert.deepEqual(
    evaluateFullAggregate({
      classificationSucceeded: true,
      classifyResult: "success",
      lane: "release-control-tested",
      releaseControlResult: "success",
      fullResult: "skipped",
      mobileRequired: false,
      mobileWebResult: "skipped",
      androidResult: "skipped",
    }),
    {
      passed: true,
      reason: "release_control_tested_passed",
    },
  );
  assert.deepEqual(
    evaluateFullAggregate({
      classificationSucceeded: true,
      classifyResult: "success",
      lane: "operator-tooling-tested",
      releaseControlResult: "success",
      fullResult: "skipped",
      mobileRequired: false,
      mobileWebResult: "skipped",
      androidResult: "skipped",
    }),
    {
      passed: true,
      reason: "operator_tooling_tested_passed",
    },
  );
  assert.equal(
    evaluateFullAggregate({
      classificationSucceeded: true,
      classifyResult: "success",
      lane: "release-control-tested",
      releaseControlResult: "skipped",
      fullResult: "success",
      mobileRequired: false,
      mobileWebResult: "success",
      androidResult: "skipped",
    }).passed,
    false,
  );
  assert.equal(
    evaluateFullAggregate({
      classificationSucceeded: true,
      classifyResult: "success",
      lane: "static-routing",
      fullResult: "skipped",
      mobileRequired: false,
      mobileWebResult: "skipped",
      androidResult: "skipped",
    }).passed,
    false,
  );
  assert.equal(
    evaluateFullAggregate({
      classificationSucceeded: true,
      classifyResult: "success",
      lane: "promotion-smoke-cleanup",
      fullResult: "skipped",
      mobileRequired: false,
      mobileWebResult: "skipped",
      androidResult: "skipped",
    }).passed,
    false,
  );
  assert.equal(
    evaluateFullAggregate({
      classificationSucceeded: true,
      classifyResult: "success",
      fullResult: "success",
      mobileRequired: false,
      mobileWebResult: "success",
      androidResult: "skipped",
    }).passed,
    true,
  );
  assert.equal(
    evaluateFullAggregate({
      classificationSucceeded: true,
      classifyResult: "success",
      fullResult: "skipped",
      mobileRequired: true,
      mobileWebResult: "skipped",
      androidResult: "success",
    }).passed,
    false,
  );
  assert.equal(
    evaluateFullAggregate({
      classificationSucceeded: true,
      classifyResult: "success",
      fullResult: "success",
      mobileRequired: true,
      mobileWebResult: "success",
      androidResult: "skipped",
    }).passed,
    false,
  );
});

test("development workflow has candidate-only triggers and cancellable PR concurrency", () => {
  const workflow = readFileSync(".github/workflows/dev-fast.yml", "utf8");
  assert.match(workflow, /pull_request:\n\s+branches: \[dev\]/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.match(workflow, /workflow_dispatch:\n\s+inputs:/);
  assert.match(
    workflow,
    /group: vinifera-dev-fast-\$\{\{ github\.event\.pull_request\.number \|\| inputs\.head_sha \|\| github\.ref \}\}/,
  );
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(
    workflow,
    /aggregate:\n\s+name: \$\{\{ github\.event_name == 'workflow_dispatch' && 'Manual exact candidate checks' \|\| 'Dev fast checks' \}\}\n\s+if: \$\{\{ always\(\) && !cancelled\(\) \}\}/,
  );
  assert.match(
    workflow,
    /ready_for_review,[\s\S]*converted_to_draft,[\s\S]*labeled,[\s\S]*unlabeled,/,
  );
  assert.match(workflow, /draft_not_candidate/);
  assert.match(workflow, /octopus_boundary_\$EVENT_ACTION/);
  assert.match(workflow, /metadata_label_\$EVENT_ACTION/);
  assert.match(workflow, /EVENT_LABEL.*github\.event\.label\.name/);
  assert.match(workflow, /current_dev.*base_sha/);
  assert.match(workflow, /if \[\[ "\$GITHUB_SHA" != "\$head_sha" \]\]; then/);
  assert.match(workflow, /Manual exact candidate checks/);
  assert.match(workflow, /octopus-review-required/);
  assert.match(workflow, /commits\/\$HEAD_SHA\/pulls/);
  assert.match(workflow, /octopus_boundary_satisfied=\$\(gh api/);
  assert.match(workflow, /PR_BASE_REF: \$\{\{ github\.event\.pull_request\.base\.ref \}\}/);
  assert.match(workflow, /PR_HEAD_REF: \$\{\{ github\.event\.pull_request\.head\.ref \}\}/);
  assert.match(workflow, /protected-reconcile/);
  assert.match(workflow, /ci-script-tested/);
  assert.match(workflow, /release-control-tested/);
  assert.match(workflow, /operator-tooling-tested/);
  assert.match(workflow, /static-routing/);
  assert.match(workflow, /promotion-smoke-cleanup/);
});

test("development workflow makes browser and preview work path-aware", () => {
  const workflow = readFileSync(".github/workflows/dev-fast.yml", "utf8");
  const smoke = workflow.slice(
    workflow.indexOf("  smoke:"),
    workflow.indexOf("  preview_decision:"),
  );
  const preview = workflow.slice(
    workflow.indexOf("  preview_decision:"),
    workflow.indexOf("  aggregate:"),
  );
  assert.doesNotMatch(workflow, /\bsecrets\./);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(smoke, /browser_required == 'true'/);
  assert.match(workflow, /preview_required == 'true'/);
  assert.match(preview, /policy_approved_non_applicability/);
  assert.match(preview, /frontend-preview-candidate/);
  assert.match(preview, /Feature preview decision/);
  assert.match(preview, /candidate_eligible="\$\{CANDIDATE_ELIGIBLE:-false\}"/);
  assert.match(preview, /--argjson candidate_eligible "\$candidate_eligible"/);
});

test("trusted preview publisher never executes PR-head code beside credentials", () => {
  const workflow = readFileSync(
    ".github/workflows/frontend-preview-publish.yml",
    "utf8",
  );
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \["Development fast validation"\]/);
  assert.match(
    workflow,
    /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/,
  );
  assert.doesNotMatch(
    workflow,
    /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/,
  );
  assert.match(workflow, /head\.repo\.full_name/);
  assert.match(workflow, /human-review-required/);
  assert.match(workflow, /do-not-merge/);
  assert.match(workflow, /Frontend preview evidence/);
  assert.match(workflow, /--commit-hash "\$HEAD_SHA"/);
  assert.match(workflow, /classifyDeliveryChange/);
  assert.match(workflow, /readChangedRecords/);
  assert.match(workflow, /applicable" != "\$trusted_applicable/);
  assert.match(
    workflow,
    /Protected environment branches do not receive frontend preview deployments/,
  );
  assert.match(
    workflow,
    /preview publication is not applicable/,
  );
  assert.match(
    workflow,
    /Pull request closed before preview publication/,
  );
  assert.match(workflow, /publish_status=false/);
  assert.match(
    workflow,
    /publish_status=true\\napplicable=false\\nbase_sha=%s\\nhead_ref=%s\\nhead_sha=%s\\npr_number=%s/,
  );
  assert.match(workflow, /--project-name vinifera-dev/);
  assert.doesNotMatch(workflow, /--project-name vinifera(?:\s|\\)/);
  assert.match(workflow, /\.vinifera-dev\.pages\.dev/);
  assert.match(workflow, /npm ci/);
  const install = workflow.slice(
    workflow.indexOf("Install trusted Wrangler toolchain"),
    workflow.indexOf("Publish exact frontend assets"),
  );
  assert.doesNotMatch(install, /\bsecrets\./);
});

test("full workflow excludes dev pushes and retains promotion-grade coverage", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /push:\n\s+branches: \[staging, main\]/);
  assert.doesNotMatch(workflow, /branches: \[dev(?:,|\])/);
  assert.match(workflow, /schedule:\n\s+- cron:/);
  assert.match(workflow, /name: Vinifera Promotion Gate/);
  assert.match(workflow, /promotion-smoke/);
  assert.match(workflow, /Hidden promotion smoke validation/);
  assert.match(workflow, /static-routing/);
  assert.match(workflow, /Static routing validation/);
  assert.match(workflow, /promotion-smoke-cleanup/);
  assert.match(workflow, /Promotion smoke cleanup validation/);
  assert.match(workflow, /release-control-tested/);
  assert.match(workflow, /operator-tooling-tested/);
  assert.match(workflow, /operator-tooling-policy\.policy\.mjs/);
  assert.match(workflow, /validateOperatorPackageJson/);
  assert.match(workflow, /Release-control focused validation/);
  assert.match(workflow, /RELEASE_CONTROL_RESULT.*needs\.release_control_validation\.result/);
  assert.match(workflow, /Focused release-control fast lane did not run exclusively and pass/);
  for (const command of [
    "npm run qa:db:phase1",
    "npm run qa:db:phase2",
    "npm run qa:db:phase3",
    "npm run qa:db:phase4",
    "npm run qa:db:phase5",
    "npm run qa:e2e",
    "npm run build:pages",
    "npm run build:worker",
  ]) {
    assert.ok(workflow.includes(command), command);
  }
});

test("full workflow selects exactly one mobile validation path", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /mobile_required == 'true'/);
  assert.match(workflow, /mobile_required != 'true'/);
  assert.match(workflow, /MOBILE_WEB_RESULT.*needs\.mobile_web\.result/);
  assert.match(workflow, /MOBILE_RESULT.*needs\.mobile_android\.result/);
  assert.match(workflow, /"\$MOBILE_WEB_RESULT" != "skipped"/);
  assert.match(workflow, /"\$MOBILE_RESULT" != "success"/);
});
