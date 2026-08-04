import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateOperatorPackageJson } from "./operator-tooling-policy.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writePackage(cwd, packageJson) {
  writeFileSync(join(cwd, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vinifera-operator-tooling-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "codex@example.test");
  git(root, "config", "user.name", "Codex");
  writePackage(root, {
    name: "vinifera-fixture",
    private: true,
    scripts: {
      build: "vite build",
      "ops:promotion-smoke:status": "node scripts/actions-promotion-status.mjs",
    },
    dependencies: {
      react: "19.2.8",
    },
    devDependencies: {
      vitest: "4.1.10",
    },
  });
  git(root, "add", "package.json");
  git(root, "commit", "-q", "-m", "base package");
  return root;
}

test("operator package policy accepts ops, qa, and test script-only changes", () => {
  const root = fixture();
  const baseSha = git(root, "rev-parse", "HEAD");
  writePackage(root, {
    name: "vinifera-fixture",
    private: true,
    scripts: {
      build: "vite build",
      "ops:promotion-smoke:status": "node scripts/actions-promotion-status.mjs",
      "ops:promotion-smoke:quick": "node scripts/promotion-smoke.mjs drill",
      "qa:operator-tooling": "npx vitest run tests/scripts",
    },
    dependencies: {
      react: "19.2.8",
    },
    devDependencies: {
      vitest: "4.1.10",
    },
  });
  git(root, "add", "package.json");
  git(root, "commit", "-q", "-m", "operator scripts");
  const headSha = git(root, "rev-parse", "HEAD");

  assert.deepEqual(validateOperatorPackageJson({ baseSha, headSha, cwd: root }), {
    changedScripts: ["ops:promotion-smoke:quick", "qa:operator-tooling"],
  });
});

test("operator package policy rejects dependency and build script changes", () => {
  const root = fixture();
  const baseSha = git(root, "rev-parse", "HEAD");
  writePackage(root, {
    name: "vinifera-fixture",
    private: true,
    scripts: {
      build: "vite build --mode staging",
      "ops:promotion-smoke:status": "node scripts/actions-promotion-status.mjs",
    },
    dependencies: {
      react: "19.3.0",
    },
    devDependencies: {
      vitest: "4.1.10",
    },
  });
  git(root, "add", "package.json");
  git(root, "commit", "-q", "-m", "unsafe package");
  const unsafeMetaSha = git(root, "rev-parse", "HEAD");
  assert.throws(
    () => validateOperatorPackageJson({ baseSha, headSha: unsafeMetaSha, cwd: root }),
    /dependencies and package metadata require full validation/,
  );

  git(root, "reset", "--hard", baseSha);
  writePackage(root, {
    name: "vinifera-fixture",
    private: true,
    scripts: {
      build: "vite build --mode staging",
      "ops:promotion-smoke:status": "node scripts/actions-promotion-status.mjs",
    },
    dependencies: {
      react: "19.2.8",
    },
    devDependencies: {
      vitest: "4.1.10",
    },
  });
  git(root, "add", "package.json");
  git(root, "commit", "-q", "-m", "unsafe script");
  const unsafeScriptSha = git(root, "rev-parse", "HEAD");
  assert.throws(
    () => validateOperatorPackageJson({ baseSha, headSha: unsafeScriptSha, cwd: root }),
    /cannot change npm script "build"/,
  );
});
