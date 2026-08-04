import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/octopus-main-deploy.yml", import.meta.url),
  "utf8",
);

describe("main to development Octopus deployment contract", () => {
  it("can be manually smoke-tested and runs only for meaningful main pushes", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toMatch(/push:\n\s+branches:\n\s+- main/);
    expect(workflow).toContain('"**.md"');
    expect(workflow).toContain('".github/**"');
  });

  it("routes Octopus traffic through the Cloudflare Access proxy", () => {
    expect(workflow).toContain("node .github/scripts/cloudflare-access-proxy.mjs");
    expect(workflow).toContain("OCTOPUS_TARGET_URL: ${{ secrets.OCTOPUS_URL }}");
    expect(workflow).toContain("OCTOPUS_URL: ${{ env.OCTOPUS_PROXY_URL }}");
    expect(workflow).toContain("OctopusDeploy/login@v2");
    expect(workflow).toContain(
      "api_key: ${{ secrets.OCTOPUS_API_KEY }}",
    );
    expect(workflow).toContain(
      "OCTOPUS_API_KEY: ${{ steps.octopus_login.outputs.api_key }}",
    );
    expect(workflow).not.toContain("steps.octopus_login.outputs.access_token");
    expect(workflow).not.toContain("id-token: write");
    expect(workflow).toContain("Stop Cloudflare Access proxy");
  });

  it("rejects manual dispatches from non-main refs before Octopus secrets are used", () => {
    expect(workflow).toContain("Require main ref for Octopus deployment");
    expect(workflow).toContain('[[ "${GITHUB_REF}" != "refs/heads/main" ]]');
    expect(workflow).toMatch(
      /Require main ref for Octopus deployment[\s\S]*?Checkout repository[\s\S]*?Start Cloudflare Access proxy/,
    );
    expect(workflow).toMatch(
      /Start Cloudflare Access proxy[\s\S]*?CF_ACCESS_CLIENT_ID: \$\{\{ secrets\.OCTOPUS_CF_ACCESS_CLIENT_ID \}\}/,
    );
    expect(workflow).not.toMatch(
      /jobs:[\s\S]*?env:[\s\S]*?CF_ACCESS_CLIENT_ID: \$\{\{ secrets\.OCTOPUS_CF_ACCESS_CLIENT_ID \}\}[\s\S]*?steps:/,
    );
  });

  it("uses current Octopus actions instead of the Node 20 v3 actions", () => {
    expect(workflow).toContain("OctopusDeploy/push-build-information-action@v4");
    expect(workflow).toContain("OctopusDeploy/create-release-action@v4");
    expect(workflow).toContain("OctopusDeploy/deploy-release-action@v4");
    expect(workflow).not.toContain("@v3");
  });

  it("keeps deploys idempotent and tied to the exact main commit", () => {
    expect(workflow).toContain(
      "version: 0.0.${{ github.run_number }}-${{ github.run_attempt }}",
    );
    expect(workflow).toContain(
      'release_number: "0.0.${{ github.run_number }}-${{ github.run_attempt }}"',
    );
    expect(workflow).toContain("overwrite_mode: OverwriteExisting");
    expect(workflow).toContain("git_ref: ${{ github.ref }}");
    expect(workflow).toContain("git_commit: ${{ github.sha }}");
    expect(workflow).toContain("environments: |\n            Development");
    expect(workflow).toContain("GitHubPAT:${{ secrets.GH_PAT_FOR_OCTOPUS }}");
    expect(workflow).toContain("PRBranch:${{ github.ref_name }}");
    expect(workflow).toContain("PRNumber:${{ github.run_number }}");
    expect(workflow).toContain("ExpectedBaseSHA:${{ github.sha }}");
    expect(workflow).toContain("ExpectedHeadSHA:${{ github.sha }}");
  });
});
