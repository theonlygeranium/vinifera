import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  artifactHtml,
  artifactPathFor,
  createArtifact,
  evaluateProductionPreflight,
  evaluateStartPreflight,
  markerFor,
  probeHostedArtifact,
  runLocalDrill,
} from "../../scripts/promotion-smoke.mjs";
import { probeHostedMarker } from "../../scripts/hosted-marker-probe.mjs";

const sourceSha = "a".repeat(40);
const originalCwd = process.cwd();
const fixtureGitTimeoutMs = 30_000;

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "vinifera-promotion-smoke-"));
  git(root, ["init", "-q", "--initial-branch=fixture-root"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Promotion Smoke Test"]);
  execFileSync("mkdir", ["-p", "public"], { cwd: root });
  execFileSync("sh", ["-c", "printf 'base\\n' > README.md"], { cwd: root });
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "base"]);
  git(root, ["branch", "dev"]);
  git(root, ["branch", "staging"]);
  git(root, ["branch", "main"]);
  return root;
}

let servers = [];

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
        }),
    ),
  );
  servers = [];
});

function serve(bodyByPath) {
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    if (path.endsWith(".html")) {
      response.statusCode = 308;
      response.setHeader("location", path.replace(/\.html$/, ""));
      response.end();
      return;
    }
    const body = bodyByPath[path] || "<main>fallback</main>";
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      servers.push(server);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

describe("promotion smoke tooling", () => {
  it("creates allowlisted hidden noindex artifacts with a stable marker", () => {
    const root = mkdtempSync(join(tmpdir(), "vinifera-smoke-artifact-"));
    const created = createArtifact({
      date: "2026-08-02",
      suffix: "tooling-test",
      repositoryRoot: root,
    });
    expect(created.path).toBe(
      "public/vinifera-promotion-smoke-2026-08-02-tooling-test.html",
    );
    expect(created.marker).toBe(
      "VINIFERA_PROMOTION_SMOKE_2026_08_02_TOOLING_TEST_MARKER",
    );
    const html = readFileSync(join(root, created.path), "utf8");
    expect(html).toContain('name="robots" content="noindex, nofollow"');
    expect(html).toContain(created.marker);
    expect(artifactPathFor({ date: "2026-08-02", suffix: "again" })).toMatch(
      /^public\/vinifera-promotion-smoke-2026-08-02-again\.html$/,
    );
    expect(() => artifactPathFor({ date: "2026-08-02", suffix: "Bad" })).toThrow(
      /lowercase/,
    );
  });

  it("runs a local drill that stages and classifies the smoke artifact", () => {
    const root = fixtureRepo();
    process.chdir(root);
    const result = runLocalDrill({
      date: "2026-08-02",
      suffix: "local-drill",
      build: false,
      repositoryRoot: root,
    });
    expect(result.passed).toBe(true);
    expect(result.staged).toBe(true);
    expect(result.classification.lane).toBe("promotion-smoke");
    expect(result.records).toEqual([
      {
        status: "A",
        paths: ["public/vinifera-promotion-smoke-2026-08-02-local-drill.html"],
      },
    ]);
    expect(git(root, ["diff", "--cached", "--name-only"]).trim()).toBe(
      "public/vinifera-promotion-smoke-2026-08-02-local-drill.html",
    );
  }, fixtureGitTimeoutMs);

  it("prints staged classifier JSON instead of silently succeeding", () => {
    const root = fixtureRepo();
    process.chdir(root);
    createArtifact({
      date: "2026-08-02",
      suffix: "cli-json",
      repositoryRoot: root,
    });
    git(root, ["add", "."]);
    const output = execFileSync(
      "node",
      [
        join(originalCwd, ".github/scripts/delivery-policy.mjs"),
        "--staged",
        "--format",
        "json",
      ],
      { cwd: root, encoding: "utf8" },
    );
    const parsed = JSON.parse(output);
    expect(parsed.mode).toBe("staged");
    expect(parsed.records).toHaveLength(1);
    expect(parsed.classification.lane).toBe("promotion-smoke");
  }, fixtureGitTimeoutMs);

  it("fails start preflight when protected environment branch trees drift", () => {
    const root = fixtureRepo();
    process.chdir(root);
    expect(
      evaluateStartPreflight({
        devRef: "dev",
        stagingRef: "staging",
        mainRef: "main",
      }).passed,
    ).toBe(true);

    git(root, ["switch", "-q", "dev"]);
    execFileSync("sh", ["-c", "printf 'drift\\n' > dev-only.txt"], { cwd: root });
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "dev drift"]);

    const result = evaluateStartPreflight({
      devRef: "dev",
      stagingRef: "staging",
      mainRef: "main",
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("environment_branch_tree_or_mergeability_drift");
    expect(result.devToStaging[0].paths).toEqual(["dev-only.txt"]);
  }, fixtureGitTimeoutMs);

  it("fails start preflight when stale ancestry would make promotion conflict", () => {
    const root = fixtureRepo();
    process.chdir(root);
    git(root, ["switch", "-q", "staging"]);
    execFileSync("sh", ["-c", "printf 'staging\\n' > CHANGELOG.md"], {
      cwd: root,
    });
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "staging changelog"]);

    git(root, ["switch", "-q", "dev"]);
    execFileSync("sh", ["-c", "printf 'dev\\n' > CHANGELOG.md"], {
      cwd: root,
    });
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "dev changelog"]);

    const result = evaluateStartPreflight({
      devRef: "dev",
      stagingRef: "staging",
      mainRef: "main",
    });
    expect(result.passed).toBe(false);
    expect(result.devIntoStaging.reason).toBe("merge_tree_conflict");
  }, fixtureGitTimeoutMs);

  it("allows production preflight only for hidden smoke artifact diffs", () => {
    const root = fixtureRepo();
    process.chdir(root);
    git(root, ["switch", "-q", "staging"]);
    createArtifact({
      date: "2026-08-02",
      suffix: "prod-only",
      repositoryRoot: root,
    });
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "hidden smoke"]);
    const smoke = evaluateProductionPreflight({
      stagingRef: "staging",
      mainRef: "main",
    });
    expect(smoke.passed).toBe(true);
    expect(smoke.classification.lane).toBe("promotion-smoke");

    execFileSync("sh", ["-c", "printf 'oops\\n' > public/oops.html"], {
      cwd: root,
    });
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "unexpected"]);
    const drift = evaluateProductionPreflight({
      stagingRef: "staging",
      mainRef: "main",
    });
    expect(drift.passed).toBe(false);
  }, fixtureGitTimeoutMs);

  it("probes extension redirects, propagation retries, and robots metadata", async () => {
    const marker = markerFor({ date: "2026-08-02", suffix: "probe-test" });
    const path = artifactPathFor({ date: "2026-08-02", suffix: "probe-test" });
    const html = artifactHtml({ date: "2026-08-02", suffix: "probe-test" });
    const origin = await serve({
      "/vinifera-promotion-smoke-2026-08-02-probe-test": html,
    });
    const result = await probeHostedArtifact({
      artifactPath: path,
      marker,
      origins: [origin],
      deadlineMs: 1_000,
      intervalMs: 10,
    });
    expect(result.passed).toBe(true);
    expect(result.found[0].markerFound).toBe(true);
    expect(result.found[0].noindexFound).toBe(true);
    expect(result.found[0].nofollowFound).toBe(true);
  });

  it("repo hosted marker probe requires every origin for presence", async () => {
    const marker = markerFor({ date: "2026-08-02", suffix: "probe-all" });
    const html = artifactHtml({ date: "2026-08-02", suffix: "probe-all" });
    const withMarker = await serve({
      "/vinifera-promotion-smoke-2026-08-02-probe-all": html,
    });
    const withoutMarker = await serve({});
    const parsed = await probeHostedMarker({
      slug: "vinifera-promotion-smoke-2026-08-02-probe-all",
      marker,
      origins: [withMarker, withoutMarker],
      expect: "present",
      deadlineMs: 1,
      intervalMs: 1,
    });
    expect(parsed.passed).toBe(false);
    expect(parsed.missingOrigins).toContain(withoutMarker);

    const absent = await probeHostedMarker({
      slug: "vinifera-promotion-smoke-2026-08-02-missing",
      marker,
      origins: [withMarker, withoutMarker],
      expect: "absent",
      deadlineMs: 1,
      intervalMs: 1,
    });
    expect(absent.passed).toBe(true);
  });

  it("keeps dev automerge merges event-producing for downstream dev evidence", () => {
    const workflow = readFileSync(".github/workflows/dev-automerge.yml", "utf8");
    expect(workflow).toContain("secrets.GH_PAT_FOR_OCTOPUS");
    expect(workflow).toContain("GH_PAT_FOR_OCTOPUS is required");
    expect(workflow).toContain("pulls/$PR_NUMBER/merge");
    expect(workflow).toContain("Development deployment candidate");
    expect(sourceSha).toHaveLength(40);
  });
});
