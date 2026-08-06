import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL(
    "../../.github/workflows/octopus-pr-quality-gates.yml",
    import.meta.url,
  ),
  "utf8",
);
const bridge = readFileSync(
  new URL("../../.github/scripts/octopus-runbook.mjs", import.meta.url),
  "utf8",
);
const productionWorkflow = readFileSync(
  new URL(
    "../../.github/workflows/production-worker-release.yml",
    import.meta.url,
  ),
  "utf8",
);
const previewWorkflow = readFileSync(
  new URL(
    "../../.github/workflows/frontend-preview-publish.yml",
    import.meta.url,
  ),
  "utf8",
);
const packageWorkflow = readFileSync(
  new URL(
    "../../.github/workflows/release-candidate-package.yml",
    import.meta.url,
  ),
  "utf8",
);

describe("two-speed Octopus review policy", () => {
  it("automatically reviews only consolidated promotions", () => {
    expect(workflow).toContain(
      "github.event.pull_request.base.ref == 'staging'",
    );
    expect(workflow).toContain("github.event.pull_request.head.ref == 'dev'");
    expect(workflow).toContain("github.event.pull_request.base.ref == 'main'");
    expect(workflow).toContain(
      "github.event.pull_request.head.ref == 'staging'",
    );
  });

  it("offers an explicit persistent label request for high-risk dev PRs", () => {
    const triggerTypes = workflow.slice(
      workflow.indexOf("    types:"),
      workflow.indexOf("concurrency:"),
    );
    expect(triggerTypes).toMatch(/\blabeled,?/);
    expect(triggerTypes).not.toMatch(/\bunlabeled,?/);
    expect(triggerTypes).not.toMatch(/\bclosed,?/);
    expect(workflow).toContain(
      "contains(github.event.pull_request.labels.*.name, 'octopus-review-required')",
    );
    expect(workflow).toContain("github.event.pull_request.base.ref == 'dev'");
    expect(workflow).toContain("needs.validate-source.result != 'skipped'");
  });

  it("publishes a success status instead of running Octopus for protected branch reconciles", () => {
    expect(workflow).toContain("protected-reconcile-status:");
    expect(workflow).toContain(
      "Publish protected reconcile non-applicability",
    );
    expect(workflow).toContain(
      "github.event.pull_request.base.ref == 'dev'",
    );
    expect(workflow).toContain(
      "github.event.pull_request.head.ref == 'main'",
    );
    expect(workflow).toContain(
      "github.event.pull_request.head.ref == 'staging'",
    );
    expect(workflow).toContain(
      'description="Not applicable protected reconcile PR #$PR_NUMBER $PR_HEAD_REF -> dev@${PR_BASE_SHA:0:12}"',
    );
    expect(workflow).toContain(
      "github.event.pull_request.head.ref != 'main'",
    );
    expect(workflow).toContain(
      "github.event.pull_request.head.ref != 'staging'",
    );
    expect(workflow).toContain(
      "github.event.pull_request.head.ref != 'dev'",
    );
  });

  it("runs secret-bearing review from trusted default-branch code only", () => {
    expect(workflow).toContain(
      "ref: ${{ github.event.repository.default_branch }}",
    );
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).not.toMatch(
      /uses: actions\/checkout[\s\S]{0,250}ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/,
    );
    expect(workflow).toContain(
      'run: node .github/scripts/octopus-runbook.mjs "PR Quality Gates"',
    );
    expect(workflow).toContain("OctopusDeploy/login@v2");
    expect(workflow).toContain(
      "api_key: ${{ secrets.OCTOPUS_API_KEY }}",
    );
    expect(workflow).toContain(
      "OCTOPUS_API_KEY: ${{ steps.octopus_login.outputs.api_key }}",
    );
    expect(workflow).not.toContain("steps.octopus_login.outputs.access_token");
    expect(workflow).not.toContain("id-token: write");
    expect(workflow).not.toMatch(/\bnpm (ci|install|run)\b/);
  });

  it("rejects untrusted source before the Octopus secrets are used", () => {
    expect(workflow).toContain(
      "Privileged Octopus reviews accept same-repository pull requests only.",
    );
    expect(workflow).toMatch(
      /quality-gates:[\s\S]*?needs: validate-source[\s\S]*?Enforce trusted source validation[\s\S]*?Run PR Quality Gates Runbook/,
    );
    expect(workflow).toContain("if: always()");
  });

  it("binds publication to the exact PR, head, base, and attempt without suppressing evidence", () => {
    expect(workflow).toContain(
      "PR_SHA: ${{ github.event.pull_request.head.sha }}",
    );
    expect(workflow).toContain(
      "PR_BASE_REF: ${{ github.event.pull_request.base.ref }}",
    );
    expect(workflow).toContain(
      "PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}",
    );
    expect(workflow).toContain(
      "REVIEW_ATTEMPT: ${{ needs.validate-source.outputs.review_attempt }}",
    );
    expect(workflow).toContain(
      "PR closed or its head/base changed before Octopus publication.",
    );
    expect(workflow).toContain(
      "The explicit Octopus review label was removed before publication.",
    );
    expect(workflow).not.toContain("human-review-required");
    expect(workflow).not.toContain("do-not-merge");
    expect(workflow).toContain(
      "Promotion review attempt changed before Octopus publication.",
    );
    expect(workflow).toContain("Review attempt: $REVIEW_ATTEMPT");
    expect(workflow).toContain(
      'description="Runbook completed PR #$PR_NUMBER $PR_BASE_REF@$PR_BASE_SHA attempt $REVIEW_ATTEMPT"',
    );
    expect(workflow).toContain('"repos/$REPO/statuses/$PR_SHA"');
    expect(workflow).toContain('-f context="Octopus PR Quality Gates"');
    expect(bridge).toContain('"PR_EXPECTED_BASE_SHA"');
  });

  it("continues safe preview and artifact evidence while a merge decision is paused", () => {
    expect(previewWorkflow).not.toContain("human-review-required");
    expect(previewWorkflow).not.toContain("do-not-merge");
    expect(packageWorkflow).not.toContain("human-review-required");
    expect(packageWorkflow).not.toContain("do-not-merge");
  });
});

describe("production authorization policy", () => {
  it("keeps production manual, protected, exact-main, and emergency-label gated", () => {
    expect(productionWorkflow).toContain("workflow_dispatch:");
    expect(productionWorkflow).toContain("name: production");
    expect(productionWorkflow).toContain(
      '[[ "$PRODUCTION_GIT_SHA" != "$(git rev-parse origin/main)" ]]',
    );
    expect(productionWorkflow).toContain('select(.head.ref == "staging")');
    expect(productionWorkflow).toContain(
      "select(.merge_commit_sha == $release_sha)",
    );
    expect(productionWorkflow).toContain(
      "name: Revalidate production authorization immediately before mutation",
    );
    expect(productionWorkflow).toContain(
      "PRODUCTION_MINIMUM_STAGING_SOAK_SECONDS",
    );
    expect(productionWorkflow).toContain(
      '$(git rev-parse "$staging_head_sha^{tree}")',
    );
    expect(productionWorkflow).toContain(
      '.name == "Deploy Worker when activated"',
    );
    expect(productionWorkflow).toContain(
      "The configured staging soak period has not completed.",
    );
    expect(productionWorkflow).toContain("human-review-required");
    expect(productionWorkflow).toContain("do-not-merge");
    expect(productionWorkflow).toMatch(
      /OPERATION" != "rollback-worker"[\s\S]*?human-review-required/,
    );
    expect(productionWorkflow).not.toMatch(/^\s+- cutover-domain$/m);
    expect(productionWorkflow).not.toMatch(/^\s+- restore-pages$/m);
    expect(productionWorkflow).not.toMatch(/^\s+cutover-domain\)$/m);
    expect(productionWorkflow).not.toMatch(/^\s+restore-pages\)$/m);
    expect(productionWorkflow).not.toMatch(/\n\s+push:/);
  });
});
