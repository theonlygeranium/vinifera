import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildReleaseManifest,
  verifyReleaseManifest,
} from "../../scripts/release-artifact.mjs";

const sourceSha = "a".repeat(40);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vinifera-release-"));
  const assets = join(root, "dist");
  const bundle = join(root, "worker.js");
  mkdirSync(join(assets, "assets"), { recursive: true });
  writeFileSync(bundle, "export default { fetch() {} };\n");
  writeFileSync(join(assets, "index.html"), "<main>Vinifera</main>\n");
  writeFileSync(join(assets, "assets", "app.js"), "console.log('ok');\n");
  return { assets, bundle, root };
}

describe("immutable release artifact", () => {
  it("is deterministic and verifies the same prebuilt Worker and assets", () => {
    const files = fixture();
    const first = buildReleaseManifest({
      assetsDirectory: files.assets,
      bundlePath: files.bundle,
      sourceSha,
    });
    const second = buildReleaseManifest({
      assetsDirectory: files.assets,
      bundlePath: files.bundle,
      sourceSha,
    });
    expect(first).toEqual(second);
    expect(first.artifactSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      verifyReleaseManifest({
        assetsDirectory: files.assets,
        bundlePath: files.bundle,
        manifest: first,
        sourceSha,
      }),
    ).toEqual(first);
  });

  it("rejects source, bundle, and asset drift", () => {
    const files = fixture();
    const manifest = buildReleaseManifest({
      assetsDirectory: files.assets,
      bundlePath: files.bundle,
      sourceSha,
    });
    expect(() =>
      verifyReleaseManifest({
        assetsDirectory: files.assets,
        bundlePath: files.bundle,
        manifest,
        sourceSha: "b".repeat(40),
      }),
    ).toThrow(/does not match/);
    writeFileSync(files.bundle, "changed\n");
    expect(() =>
      verifyReleaseManifest({
        assetsDirectory: files.assets,
        bundlePath: files.bundle,
        manifest,
        sourceSha,
      }),
    ).toThrow(/does not match/);
  });

  it("rejects symlinks and malformed revisions", () => {
    const files = fixture();
    symlinkSync(files.bundle, join(files.assets, "worker-link.js"));
    expect(() =>
      buildReleaseManifest({
        assetsDirectory: files.assets,
        bundlePath: files.bundle,
        sourceSha,
      }),
    ).toThrow(/symbolic links/);
    expect(() =>
      buildReleaseManifest({
        assetsDirectory: files.assets,
        bundlePath: files.bundle,
        sourceSha: "dev",
      }),
    ).toThrow(/exact lowercase commit/);

    const bundleLink = fixture();
    const bundleTarget = join(bundleLink.root, "bundle-target.js");
    writeFileSync(bundleTarget, "export default {};\n");
    unlinkSync(bundleLink.bundle);
    symlinkSync(bundleTarget, bundleLink.bundle);
    expect(() =>
      buildReleaseManifest({
        assetsDirectory: bundleLink.assets,
        bundlePath: bundleLink.bundle,
        sourceSha,
      }),
    ).toThrow(/regular file/);
  });

  it("keeps development mutation disabled and trusted until explicit activation", () => {
    const workflow = readFileSync(
      ".github/workflows/dev-worker-release.yml",
      "utf8",
    );
    expect(workflow).toContain('workflows: ["Development deployment candidate"]');
    expect(workflow).toContain("DEV_WORKER_DEPLOY_ENABLED");
    expect(workflow).toContain("prepared_disabled");
    expect(workflow).toContain(
      "ref: ${{ github.event.repository.default_branch }}",
    );
    expect(workflow).toContain("release/worker/worker.js");
    expect(workflow).toContain("--no-bundle");
    expect(workflow).toContain("PRIOR_VERSION_ID");
    expect(workflow).toContain("development-runtime.spec.ts");
    expect(workflow).not.toContain("--env production");
    expect(workflow).not.toContain("PRODUCTION_");
  });

  it("packages one certified candidate and maintains one digest surface", () => {
    const packager = readFileSync(
      ".github/workflows/release-candidate-package.yml",
      "utf8",
    );
    expect(packager).toContain("Type, test, build, and package");
    expect(packager).toContain("Octopus PR Quality Gates");
    expect(packager).toContain("release-candidate-${{ needs.authorize.outputs.candidate_sha }}");
    expect(packager).toContain("release-artifact.mjs create");
    expect(packager).toContain("npm run build");
    expect(packager).not.toContain("npm run build:pages");

    const fullPromotion = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(fullPromotion).toContain(
      "release-candidate-${{ steps.release-package.outputs.candidate_sha }}",
    );
    expect(fullPromotion).toContain("release-artifact.mjs verify");
    expect(fullPromotion).toContain(
      "wrangler versions upload release/worker/worker.js",
    );
    expect(fullPromotion).toContain(
      "--no-bundle --assets release/dist --env staging",
    );
    expect(fullPromotion).toContain(
      '--var "DEPLOY_GIT_SHA:${{ steps.release-package.outputs.candidate_sha }}"',
    );
    expect(fullPromotion).toContain("vinifera-staging-release.json");
    expect(fullPromotion).toContain(
      'select(.merge_commit_sha == $staging_sha)',
    );

    const digest = readFileSync(
      ".github/workflows/delivery-control-center.yml",
      "utf8",
    );
    expect(digest).toContain("Delivery Control Center");
    expect(digest).toContain("Implemented");
    expect(digest).toContain("CI-verified");
    expect(digest).toContain("Live-verified");
    expect(digest).not.toMatch(/\b(slack|email|smtp)\b/i);
  });

  it("keeps one protected production summary and approval entry", () => {
    const production = readFileSync(
      ".github/workflows/production-worker-release.yml",
      "utf8",
    );
    expect(production).toContain("artifact_sha256:");
    expect(production).toContain("artifact_source_sha:");
    expect(production).toContain("release_artifact_run_id:");
    expect(production).toContain("risk_classification:");
    expect(production).toContain("release_summary:");
    expect(production).toContain("rollback_artifact:");
    expect(production).toContain("outstanding_caveats:");
    expect(production).toContain("name: production");
    expect(production).toContain("Protected production decision");
    expect(production).toContain("release-artifact.mjs verify");
    expect(production).toContain("--no-bundle --assets release/dist");
    expect(production).toContain("Bind staging evidence to the approved package");
    expect(production).toContain("vinifera-staging-release.json");
    expect(production).toContain(
      '--var "DEPLOY_GIT_SHA:$PRODUCTION_GIT_SHA"',
    );
  });
});
