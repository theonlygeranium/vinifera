import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const agentsGuide = readFileSync(
  new URL("../../AGENTS.md", import.meta.url),
  "utf8",
);
const workflowGuide = readFileSync(
  new URL("../../docs/agent-workflow.md", import.meta.url),
  "utf8",
);
const promotionWorkflow = readFileSync(
  new URL("../../.github/workflows/promote-dev-to-staging.yml", import.meta.url),
  "utf8",
);
const octopusPromotionWorkflow = readFileSync(
  new URL(
    "../../.github/workflows/octopus-pr-quality-gates.yml",
    import.meta.url,
  ),
  "utf8",
);
const mainDeployWorkflow = readFileSync(
  new URL("../../.github/workflows/octopus-main-deploy.yml", import.meta.url),
  "utf8",
);
const productionWorkflow = readFileSync(
  new URL("../../.github/workflows/production-worker-release.yml", import.meta.url),
  "utf8",
);

describe("promotion workflow smoke contract", () => {
  it("keeps routine agent work entering through dev before promotion", () => {
    expect(agentsGuide).toContain("All agent feature PRs target `dev` only");
    expect(workflowGuide).toContain("Feature branch or PR to `dev`");
    expect(promotionWorkflow).toContain("--head dev");
    expect(promotionWorkflow).toContain("--base staging");
    expect(promotionWorkflow).toContain("Review attempt: ${REVIEW_ATTEMPT}");
  });

  it("requires the canonical promotion gate and Octopus on promotion comparisons", () => {
    expect(promotionWorkflow).toContain('"Vinifera Promotion Gate"');
    expect(promotionWorkflow).toContain("active_changes_requested");
    expect(promotionWorkflow).toContain('"Octopus PR Quality Gates"');
    expect(octopusPromotionWorkflow).toContain(
      "github.event.pull_request.base.ref == 'staging'",
    );
    expect(octopusPromotionWorkflow).toContain(
      "github.event.pull_request.head.ref == 'dev'",
    );
    expect(octopusPromotionWorkflow).toContain(
      "github.event.pull_request.base.ref == 'main'",
    );
    expect(octopusPromotionWorkflow).toContain(
      "github.event.pull_request.head.ref == 'staging'",
    );
    expect(octopusPromotionWorkflow).toContain(
      "Review attempt: ([0-9]+\\.[0-9]+|[0-9]{4}-[0-9]{2}-[0-9]{2}T",
    );
    expect(octopusPromotionWorkflow).toContain(
      'body_review_attempt=$(sed -nE',
    );
    expect(octopusPromotionWorkflow).toContain(
      'if [[ -n "$body_review_attempt" ]]; then',
    );
    expect(octopusPromotionWorkflow).toContain(
      'attempt_marker_required="true"',
    );
  });

  it("leaves production Worker mutation manual while allowing safe main release audit", () => {
    expect(mainDeployWorkflow).toContain("workflow_dispatch:");
    // The main deploy workflow now creates a release audit record only;
    // it no longer deploys to Development. Worker deployment is owned by
    // GitHub Actions via Wrangler.
    expect(mainDeployWorkflow).toContain("Create Octopus Release");
    expect(mainDeployWorkflow).toContain("tests/**");
    expect(mainDeployWorkflow).toContain("public/vinifera-promotion-smoke-*.html");
    expect(mainDeployWorkflow).toContain("public/_redirects");
    expect(productionWorkflow).toContain("workflow_dispatch:");
    expect(productionWorkflow).toContain("name: production");
    expect(productionWorkflow).not.toMatch(/\n\s+push:/);
  });
});
