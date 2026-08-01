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
    expect(workflow).toContain("X-Octopus-ApiKey: ${OCTOPUS_API_KEY}");
    expect(workflow).toContain("Stop Cloudflare Access proxy");
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
  });
});
