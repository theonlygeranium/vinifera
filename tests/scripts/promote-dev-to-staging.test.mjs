import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL(
    "../../.github/workflows/promote-dev-to-staging.yml",
    import.meta.url,
  ),
  "utf8",
);

describe("dev to staging promotion contract", () => {
  it("starts only through an explicit owner-authorized dispatch", () => {
    expect(workflow).toMatch(/on:\n\s+workflow_dispatch:/);
    expect(workflow).not.toMatch(/\n\s+push:/);
    expect(workflow).toMatch(
      /authorization_reason:\n\s+description:[^\n]+\n\s+required: true/,
    );
    expect(workflow).toContain(
      "AUTHORIZATION_REASON: ${{ github.event.inputs.authorization_reason }}",
    );
    expect(workflow).toContain(
      "An owner-authorized promotion reason is required.",
    );
  });

  it("opens an event-producing PR before provider gates", () => {
    expect(
      workflow.match(/GH_TOKEN: \$\{\{ secrets\.GH_PAT_FOR_OCTOPUS \}\}/g),
    ).toHaveLength(1);
    expect(workflow).toMatch(
      /staging-rest-pre:[\s\S]*?needs: open-pr[\s\S]*?STAGING_SUPABASE_URL/,
    );
    expect(workflow).not.toContain('--label "automated-promotion"');
  });

  it("requires fresh exact-comparison promotion gate and Octopus evidence", () => {
    for (const job of ["wait-for-gates", "ready"]) {
      expect(workflow).toMatch(
        new RegExp(
          `${job}:[\\s\\S]*?permissions:\\n\\s+actions: read\\n\\s+checks: read\\n\\s+pull-requests: read\\n\\s+statuses: read`,
        ),
      );
    }
    expect(workflow).toContain('"Vinifera Promotion Gate"');
    expect(workflow).toContain('.context == "Octopus PR Quality Gates"');
    expect(workflow).toContain(
      'expected_octopus_description="Runbook completed PR #$PR_NUMBER staging@$PR_BASE_SHA attempt $REVIEW_ATTEMPT"',
    );
    expect(workflow).toContain(
      "REVIEW_ATTEMPT: ${{ needs.open-pr.outputs.review_attempt }}",
    );
    expect(workflow).toContain("Readiness attempt started:");
    expect(workflow).toContain("select(.started_at >= $gate_requested_at)");
    expect(workflow).toContain(".base.sha == $pr_base_sha");
    expect(workflow).toContain(".head.sha == $pr_sha");
    expect(workflow).toContain("group_by(.name)");
    expect(workflow).toContain("group_by(.context)");
    expect(workflow).toContain('.conclusion == "success"');
    expect(workflow).toContain("required_failed");
    expect(workflow).toContain(
      '$(jq -r \'.path\' <<<"$ci_run")" == ".github/workflows/ci.yml"',
    );
    expect(workflow).toContain(
      '$(jq -r \'.event\' <<<"$octopus_run")" == "pull_request_target"',
    );
    expect(workflow).toContain('[[ "$ci_source_valid" == "true" ]]');
    expect(workflow).toContain('[[ "$octopus_source_valid" == "true" ]]');
    expect(workflow).toContain('[[ "$current_sha" != "$PR_SHA" ]]');
    expect(workflow).toContain(
      '[[ "$current_base_name" != "staging" || "$current_base_sha" != "$PR_BASE_SHA" ]]',
    );
  });

  it("fails closed on active requested-changes reviews and treats CodeRabbit as optional", () => {
    expect(workflow).toContain("active_changes_requested");
    expect(workflow).toContain('select(.state == "CHANGES_REQUESTED")');
    expect(workflow).not.toContain("reviewThreads(first:100)");
    expect(workflow).not.toContain("unresolved == 0");
    expect(workflow).not.toContain('test("coderabbit"; "i") | not');
    expect(workflow).toContain("(CodeRabbit optional)");
    expect(workflow).toContain("human-review-required");
    expect(workflow).toContain("do-not-merge");
    expect(workflow).toContain("environment: promotion-control");
    expect(workflow).toContain(
      "Promotion control must be dispatched from refs/heads/main.",
    );
    expect(workflow).not.toContain("@coderabbitai review");
    expect(workflow).not.toContain("coderabbit_success");
    expect(workflow).not.toContain("coderabbit_reviews");
  });

  it("revalidates evidence and never merges", () => {
    expect(workflow).toContain("name: Report promotion readiness");
    expect(workflow).toContain("name: Revalidate complete promotion readiness");
    expect(workflow).toContain(
      "Promotion gates changed after polling; readiness is no longer valid.",
    );
    expect(workflow).toContain(
      "PR closed, paused, or changed while readiness evidence was refreshed.",
    );
    expect(workflow).toContain("final_metadata");
    expect(workflow).toContain('[[ "$final_sha" != "$PR_SHA"');
    expect(workflow).not.toContain("gh pr merge");
    expect(workflow).not.toContain("--match-head-commit");
  });
});
