import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/promote-dev-to-staging.yml", import.meta.url),
  "utf8",
);
const adr = readFileSync(
  new URL(
    "../../docs/decisions/2026-07-28-automated-dev-staging-promotion.md",
    import.meta.url,
  ),
  "utf8",
);
const codeRabbit = readFileSync(
  new URL("../../.coderabbit.yaml", import.meta.url),
  "utf8",
);
const octopusWorkflow = readFileSync(
  new URL(
    "../../.github/workflows/octopus-pr-quality-gates.yml",
    import.meta.url,
  ),
  "utf8",
);
const ciWorkflow = readFileSync(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

describe("dev to staging promotion contract", () => {
  it("opens an event-producing PR before any provider gate", () => {
    expect(
      workflow.match(
        /GH_TOKEN: \$\{\{ secrets\.GH_PAT_FOR_OCTOPUS \}\}/g,
      ),
    ).toHaveLength(1);
    expect(workflow).toMatch(
      /staging-rest-pre:[\s\S]*?needs: open-pr[\s\S]*?STAGING_SUPABASE_URL/,
    );
    expect(workflow).not.toContain('--label "automated-promotion"');
  });

  it("can read gates and excludes every promotion attempt on the same SHA", () => {
    expect(workflow).toContain("permissions: {}");
    expect(workflow).toMatch(
      /wait-for-gates:[\s\S]*?permissions:\n\s+checks: read\n\s+pull-requests: read\n\s+statuses: read/,
    );
    expect(workflow).toContain("statuses: read");
    expect(workflow).toContain('--body "@coderabbitai review"');
    expect(workflow).toContain("promotion_checks='[");
    expect(workflow).toContain('$promotion_checks | index($name) | not');
    expect(workflow).not.toContain("CURRENT_RUN_ID");
  });

  it("requires exact-head CI, automated review, and resolved threads", () => {
    expect(workflow).toContain('"Type, test, build, and package"');
    expect(workflow).toContain('.context == "Octopus PR Quality Gates"');
    expect(workflow).toContain(
      '"$octopus_description" == "$expected_octopus_description"',
    );
    expect(workflow).toContain('.context == "CodeRabbit"');
    expect(workflow).toContain(
      '"$coderabbit_description" == "Review completed"',
    );
    expect(workflow).toContain("reviewThreads(first:100)");
    expect(workflow).toContain("pageInfo{hasNextPage}");
    expect(workflow).toContain("group_by(.name)");
    expect(workflow).toContain("group_by(.context)");
    expect(workflow).toContain('.conclusion == "success"');
    expect(workflow).toContain("required_failed");
    expect(workflow).toContain("current_sha");
    expect(workflow).toContain('[[ "$current_sha" != "$PR_SHA" ]]');
    expect(workflow).toContain("current_base_sha");
    expect(workflow).toContain(
      '[[ "$current_base_name" != "staging" || "$current_base_sha" != "$PR_BASE_SHA" ]]',
    );
    expect(workflow).toContain(
      "PR_BASE_SHA: ${{ needs.open-pr.outputs.pr_base_sha }}",
    );
    expect(workflow).toContain(
      "GATE_REQUESTED_AT: ${{ needs.open-pr.outputs.gate_requested_at }}",
    );
    expect(workflow).toContain("Readiness attempt started:");
    expect(ciWorkflow).toMatch(
      /pull_request:\n\s+types: \[opened, synchronize, reopened, ready_for_review, edited\]/,
    );
    expect(workflow).toContain(
      "select(.started_at >= $gate_requested_at)",
    );
    expect(
      workflow.match(
        /select\(\(\$suite_map\[\(\.check_suite\.id \| tostring\)\] \/\/ ""\) >= \$gate_requested_at\) \|\n\s+select\(\.started_at >= \$gate_requested_at\)/g,
      ),
    ).toHaveLength(2);
    expect(workflow).toContain(".base.sha == $pr_base_sha");
    expect(workflow).toContain(".head.sha == $pr_sha");
    expect(workflow).toContain(
      '($suite_map[(.check_suite.id | tostring)] // "")',
    );
    expect(workflow).toContain(
      "select(.author.login == \"coderabbitai\")",
    );
    expect(workflow).toContain("select(.commit.oid == $pr_sha)");
    expect(workflow).toContain(
      "select(.submittedAt >= $gate_requested_at)",
    );
    expect(workflow).toContain("coderabbit_reviews > 0");
    expect(workflow.match(/gh api --paginate --slurp/g)).toHaveLength(4);
    expect(workflow).toContain(
      '"repos/$REPO/commits/$PR_SHA/statuses?per_page=100"',
    );
  });

  it("publishes the trusted Octopus result on the pull-request head SHA", () => {
    expect(octopusWorkflow).toMatch(
      /quality-gates:[\s\S]*?permissions:\n\s+contents: read\n\s+statuses: write/,
    );
    expect(octopusWorkflow).toContain(
      "PR_SHA: ${{ github.event.pull_request.head.sha }}",
    );
    expect(octopusWorkflow).toContain(
      "PR_EXPECTED_SHA: ${{ github.event.pull_request.head.sha }}",
    );
    expect(octopusWorkflow).toContain(
      "PR_EXPECTED_BASE_SHA: ${{ github.event.pull_request.base.sha }}",
    );
    expect(octopusWorkflow).toContain(
      '"repos/$REPO/statuses/$PR_SHA"',
    );
    expect(octopusWorkflow).toContain(
      '-f context="Octopus PR Quality Gates"',
    );
    expect(octopusWorkflow).toContain(
      'description="Runbook completed for PR #$PR_NUMBER base $PR_BASE_SHA"',
    );
    expect(octopusWorkflow).toContain('if: always()');
  });

  it("reports readiness without an unsafe automatic merge", () => {
    expect(workflow).toContain("name: Report promotion readiness");
    expect(workflow).toContain("name: Revalidate complete promotion readiness");
    expect(workflow).toContain(
      "Promotion gates changed after polling; readiness is no longer valid.",
    );
    expect(workflow).toContain(
      "PR comparison changed while readiness evidence was refreshed.",
    );
    expect(workflow).toContain("final_metadata");
    expect(workflow).toContain('[[ "$final_sha" != "$PR_SHA"');
    expect(workflow).toContain(
      "DRY_RUN: ${{ github.event.inputs.dry_run }}",
    );
    expect(workflow).not.toContain(
      "if: github.event.inputs.dry_run != 'true'",
    );
    expect(workflow).toContain(
      "GitHub exposes an atomic expected-head merge guard but no expected-base guard",
    );
    expect(workflow).toContain(
      '[[ "$current_base_name" != "staging" || "$current_base_sha" != "$PR_BASE_SHA" ]]',
    );
    expect(workflow).not.toContain("gh pr merge");
    expect(workflow).not.toContain("--match-head-commit");
  });

  it("documents the currently unconfigured staging probe credentials", () => {
    expect(adr).toContain("they are not configured");
    expect(adr).not.toContain("These are already present");
  });

  it("enables automatic CodeRabbit review on governed non-default bases", () => {
    expect(codeRabbit).toMatch(/base_branches:\n\s+- "dev"\n\s+- "staging"/);
    expect(codeRabbit).toContain("auto_incremental_review: true");
  });
});
