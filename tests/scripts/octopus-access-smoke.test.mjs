import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/octopus-access-smoke.yml", import.meta.url),
  "utf8",
);
const script = readFileSync(
  new URL("../../.github/scripts/octopus-access-smoke.mjs", import.meta.url),
  "utf8",
);

describe("Octopus access smoke workflow", () => {
  it("runs manually and on a lightweight schedule", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain('cron: "17 */6 * * *"');
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("requires the existing Octopus and Cloudflare machine credentials in CI", () => {
    expect(workflow).toContain("secrets.OCTOPUS_URL");
    expect(workflow).toContain("secrets.OCTOPUS_CF_ACCESS_CLIENT_ID");
    expect(workflow).toContain("secrets.OCTOPUS_CF_ACCESS_CLIENT_SECRET");
    expect(workflow).toContain("secrets.OCTOPUS_API_KEY");
    expect(workflow).toContain("octopus-access-smoke.mjs --require-machine");
  });

  it("fails on Cloudflare Access redirects and verifies Octopus-native auth", () => {
    expect(script).toContain("cloudflareaccess\\.com");
    expect(script).toContain("Expected root redirect to /app");
    expect(script).toContain("Expected Octopus API metadata");
    expect(script).toContain("Expected Octopus-native 401 auth boundary");
    expect(script).toContain("Expected authenticated Octopus user metadata");
  });
});
