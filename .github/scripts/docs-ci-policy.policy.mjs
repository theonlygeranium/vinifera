import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  classifyChangeSet,
  evaluateRequiredGate,
  parseNameStatusZ,
  scanDiffForSecrets,
  validateDocumentationChange,
} from "./docs-ci-policy.mjs";

const record = (status, ...paths) => ({ status, paths });
const classify = (records, eventName = "pull_request") =>
  classifyChangeSet({ eventName, records });

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createDocumentationRepository() {
  const root = mkdtempSync(join(tmpdir(), "vinifera-docs-ci-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, ".nvmrc"), "22.22.0\n");
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ engines: { node: ">=22.12.0" } }, null, 2)}\n`,
  );
  writeFileSync(join(root, "AGENTS.md"), "Use the Node version in `.nvmrc`.\n");
  writeFileSync(join(root, "README.md"), "# Example\n\nNode 22.22.0 is required.\n");
  writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\nInitial.\n");
  writeFileSync(join(root, "CONTINUITY_BRIEF.md"), "# Continuity\n");
  writeFileSync(join(root, "REVERT.md"), "# Revert\n");
  writeFileSync(join(root, "docs", "guide.md"), "# Guide\n");
  git(root, "init", "-q");
  git(root, "config", "user.name", "Vinifera CI Test");
  git(root, "config", "user.email", "ci-test@example.com");
  git(root, "add", ".");
  git(root, "commit", "-qm", "initial");
  return { root, baseSha: git(root, "rev-parse", "HEAD") };
}

function commitAll(root, message = "docs change") {
  git(root, "add", ".");
  git(root, "commit", "-qm", message);
  return git(root, "rev-parse", "HEAD");
}

function withDocumentationRepository(callback) {
  const fixture = createDocumentationRepository();
  try {
    callback(fixture);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

test("README and allowed docs Markdown select the docs lane", () => {
  assert.equal(classify([record("M", "README.md")]).lane, "docs");
  assert.equal(
    classify([
      record("A", "docs/runbooks/example.md"),
      record("M", "CHANGELOG.md"),
    ]).lane,
    "docs",
  );
});

test("root governance Markdown selects docs only when every path is allowed", () => {
  assert.equal(
    classify([
      record("M", "AGENTS.md"),
      record("M", "CHANGELOG.md"),
      record("M", "CONTINUITY_BRIEF.md"),
    ]).lane,
    "docs",
  );
});

test("a Markdown rename entirely beneath docs selects docs", () => {
  assert.equal(
    classify([record("R100", "docs/old.md", "docs/new.md")]).lane,
    "docs",
  );
});

test("rename from docs to source selects full", () => {
  assert.equal(
    classify([record("R100", "docs/example.md", "src/example.ts")]).lane,
    "full",
  );
});

test("deletions, copies, dependencies, workflows, tests, and migrations select full", () => {
  const cases = [
    [record("D", "src/deleted.ts")],
    [record("C100", "docs/a.md", "docs/b.md")],
    [record("M", "package-lock.json")],
    [record("M", ".github/workflows/ci.yml")],
    [record("M", "tests/server/example.test.ts")],
    [record("A", "supabase/migrations/999_example.sql")],
  ];
  for (const records of cases) assert.equal(classify(records).lane, "full");
});

test("Android, iOS, mobile, and unknown paths select full", () => {
  for (const path of [
    "android/app/build.gradle",
    "ios/App/Info.plist",
    "mobile/app-identity.json",
    "unexpected.asset",
  ]) {
    assert.equal(classify([record("M", path)]).lane, "full");
  }
});

test("empty, malformed, and unusual diffs fail closed", () => {
  for (const records of [[], null, [record("U", "README.md")], [{}]]) {
    const result = classify(records);
    assert.equal(result.lane, "full");
    if (!Array.isArray(records) || records.length === 0 || records[0]?.status === undefined) {
      assert.equal(result.classificationSucceeded, false);
    }
  }
});

test("pushes to main, schedules, and manual runs select full", () => {
  for (const eventName of ["push", "schedule", "workflow_dispatch"]) {
    assert.equal(classify([record("M", "README.md")], eventName).lane, "full");
  }
});

test("NUL name-status parser preserves both rename paths", () => {
  assert.deepEqual(
    parseNameStatusZ(Buffer.from("M\0README.md\0R100\0docs/a.md\0docs/b.md\0")),
    [
      record("M", "README.md"),
      record("R100", "docs/a.md", "docs/b.md"),
    ],
  );
  assert.throws(() => parseNameStatusZ(Buffer.from("R100\0docs/a.md\0")));
});

test("required gate accepts exactly one successful docs lane", () => {
  assert.deepEqual(
    evaluateRequiredGate({
      classificationSucceeded: true,
      lane: "docs",
      docsResult: "success",
      fullResult: "skipped",
      mobileResult: "skipped",
    }),
    { passed: true, reason: "docs_lane_passed" },
  );
});

test("required gate accepts the complete successful full lane", () => {
  assert.deepEqual(
    evaluateRequiredGate({
      classificationSucceeded: true,
      lane: "full",
      docsResult: "skipped",
      fullResult: "success",
      mobileResult: "success",
    }),
    { passed: true, reason: "full_lane_passed" },
  );
});

test("required gate rejects failures, cancellations, both lanes, neither lane, and unknown classification", () => {
  const invalid = [
    {
      classificationSucceeded: false,
      lane: "full",
      docsResult: "skipped",
      fullResult: "success",
      mobileResult: "success",
    },
    {
      classificationSucceeded: true,
      lane: "docs",
      docsResult: "failure",
      fullResult: "skipped",
      mobileResult: "skipped",
    },
    {
      classificationSucceeded: true,
      lane: "full",
      docsResult: "skipped",
      fullResult: "cancelled",
      mobileResult: "success",
    },
    {
      classificationSucceeded: true,
      lane: "docs",
      docsResult: "success",
      fullResult: "success",
      mobileResult: "success",
    },
    {
      classificationSucceeded: true,
      lane: "docs",
      docsResult: "skipped",
      fullResult: "skipped",
      mobileResult: "skipped",
    },
    {
      classificationSucceeded: true,
      lane: "unknown",
      docsResult: "skipped",
      fullResult: "skipped",
      mobileResult: "skipped",
    },
  ];
  for (const state of invalid) {
    assert.equal(evaluateRequiredGate(state).passed, false);
  }
});

test("documentation validator accepts a valid allowlisted change", () => {
  withDocumentationRepository(({ root, baseSha }) => {
    writeFileSync(join(root, "README.md"), "# Example\n\n[Guide](docs/guide.md)\n\nNode 22.22.0.\n");
    writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\nDocs updated.\n");
    const headSha = commitAll(root);
    const result = validateDocumentationChange({ baseSha, headSha, repoRoot: root });
    assert.equal(result.classification.lane, "docs");
    assert.deepEqual(result.markdownFiles.sort(), ["CHANGELOG.md", "README.md"]);
  });
});

test("documentation validator rejects a broken local link", () => {
  withDocumentationRepository(({ root, baseSha }) => {
    writeFileSync(join(root, "README.md"), "# Example\n\n[Missing](docs/missing.md)\n\nNode 22.22.0.\n");
    writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\nDocs updated.\n");
    const headSha = commitAll(root);
    assert.throws(
      () => validateDocumentationChange({ baseSha, headSha, repoRoot: root }),
      /missing local link target/,
    );
  });
});

test("documentation validator rejects a broken reference-style local link", () => {
  withDocumentationRepository(({ root, baseSha }) => {
    writeFileSync(
      join(root, "README.md"),
      "# Example\n\n[Missing][guide]\n\n[guide]: docs/missing.md\n\nNode 22.22.0.\n",
    );
    writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\nDocs updated.\n");
    const headSha = commitAll(root);
    assert.throws(
      () => validateDocumentationChange({ baseSha, headSha, repoRoot: root }),
      /missing local link target/,
    );
  });
});

test("documentation validator rejects a missing changelog update", () => {
  withDocumentationRepository(({ root, baseSha }) => {
    writeFileSync(join(root, "README.md"), "# Example\n\nNode 22.22.0 docs updated.\n");
    const headSha = commitAll(root);
    assert.throws(
      () => validateDocumentationChange({ baseSha, headSha, repoRoot: root }),
      /must update CHANGELOG\.md/,
    );
  });
});

test("renaming CHANGELOG away does not satisfy its mandatory update", () => {
  withDocumentationRepository(({ root, baseSha }) => {
    git(root, "mv", "CHANGELOG.md", "docs/changelog.md");
    const headSha = commitAll(root);
    assert.throws(
      () => validateDocumentationChange({ baseSha, headSha, repoRoot: root }),
      /must update CHANGELOG\.md/,
    );
  });
});

test("documentation validator rejects stale Node guidance", () => {
  withDocumentationRepository(({ root, baseSha }) => {
    writeFileSync(
      join(root, "AGENTS.md"),
      "Use `.nvmrc`, but the Node version is 20.\n",
    );
    writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\nNode docs updated.\n");
    const headSha = commitAll(root);
    assert.throws(
      () => validateDocumentationChange({ baseSha, headSha, repoRoot: root }),
      /must reference \.nvmrc and must not prescribe a conflicting Node major/,
    );
  });
});

test("documentation validator ties README runtime guidance to .nvmrc", () => {
  withDocumentationRepository(({ root, baseSha }) => {
    writeFileSync(join(root, "README.md"), "# Example\n\nNode 21 is required.\n");
    writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\nNode docs updated.\n");
    const headSha = commitAll(root);
    assert.throws(
      () => validateDocumentationChange({ baseSha, headSha, repoRoot: root }),
      /must resolve to the \.nvmrc Node 22\.22\.0 pin/,
    );
  });
});

test("current repository Node contract remains explicitly authorized", () => {
  assert.equal(readFileSync(".nvmrc", "utf8").trim(), "22.22.0");
  assert.equal(
    JSON.parse(readFileSync("package.json", "utf8")).engines.node,
    ">=22.12.0",
  );
});

test("credential-pattern scan rejects GitHub and Stripe key formats", () => {
  withDocumentationRepository(({ root, baseSha }) => {
    for (const [index, segments] of [
      ["ghp", "1234567890abcdefghijklmnop"],
      ["github", "pat", "1234567890abcdefghijklmnop"],
      ["rk", "live", "1234567890abcdefghijklmnop"],
    ].entries()) {
      const syntheticToken = segments.join("_");
      writeFileSync(
        join(root, "README.md"),
        `# Example\n\nNode 22.22.0.\n\n\`${syntheticToken}\`\n`,
      );
      writeFileSync(
        join(root, "CHANGELOG.md"),
        `# Changelog\n\nUnsafe example ${index} added.\n`,
      );
      const headSha = commitAll(root, `unsafe example ${index}`);
      assert.throws(
        () => scanDiffForSecrets({
          baseSha: index === 0 ? baseSha : git(root, "rev-parse", "HEAD^"),
          headSha,
          repoRoot: root,
        }),
        /Potential credential/,
      );
    }
  });
});
