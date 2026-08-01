import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  configAsCodeRunbooksPath,
  credentialShapeSummary,
  normalizeApiBase,
  responseProvenance,
  resolveFormValues,
  runRunbook,
} from "../../.github/scripts/octopus-runbook.mjs";
import { runSecurityAudit } from "../../.github/scripts/octopus-security-audit.mjs";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function embeddedQualityChecker() {
  const qualityRunbook = readFileSync(
    new URL(
      "../../.octopus/runbooks/pr-quality-gates.ocl",
      import.meta.url,
    ),
    "utf8",
  );
  const embeddedChecker = qualityRunbook.match(
    /python3 - "\$WORK_DIR" "\$WORK_DIR\/pr\.diff" "\$WORK_DIR\/commit-diffs" "\$MERGE_BASE_SHA" <<'PY'\n([\s\S]*?)\n\s*PY/,
  )?.[1];
  expect(embeddedChecker).toBeTruthy();
  const indentation = embeddedChecker.match(/^(\s*)\S/m)?.[1].length ?? 0;
  return embeddedChecker
    .split("\n")
    .map((line) => line.slice(Math.min(indentation, line.length)))
    .join("\n");
}

function embeddedRunbookStep(stepId) {
  const qualityRunbook = readFileSync(
    new URL(
      "../../.octopus/runbooks/pr-quality-gates.ocl",
      import.meta.url,
    ),
    "utf8",
  );
  const escapedStepId = stepId.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = qualityRunbook.match(
    new RegExp(
      `step "${escapedStepId}"[\\s\\S]*?Octopus\\.Action\\.Script\\.ScriptBody = <<-EOT\\n([\\s\\S]*?)\\n\\s*EOT`,
    ),
  )?.[1];
  expect(body).toBeTruthy();
  const indentation = body.match(/^(\s*)\S/m)?.[1].length ?? 0;
  return body
    .split("\n")
    .map((line) =>
      line.startsWith(" ".repeat(indentation)) ? line.slice(indentation) : line,
    )
    .join("\n");
}

function initializeGitFixture(fixture) {
  for (const args of [
    ["init", "--quiet"],
    ["config", "user.email", "fixture@example.test"],
    ["config", "user.name", "Fixture"],
    ["add", "."],
    ["commit", "--quiet", "-m", "fixture"],
  ]) {
    const result = spawnSync("git", args, { cwd: fixture, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  }
}

function runEmbeddedStep(stepId, fixture) {
  const taskId = `fixture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const stateFile = `/tmp/octopus_pr_workdir_${taskId}`;
  writeFileSync(stateFile, `WORK_DIR=${fixture}\n`);
  try {
    return spawnSync(
      "bash",
      [
        "-c",
        embeddedRunbookStep(stepId).replaceAll("#{Octopus.Task.Id}", taskId),
      ],
      { encoding: "utf8" },
    );
  } finally {
    rmSync(stateFile, { force: true });
  }
}

function runRule8BaseHeadFixture({ baseSource, headSource, diff }) {
  const checker = embeddedQualityChecker();
  const fixture = mkdtempSync(join(tmpdir(), "vinifera-octopus-rule8-base-"));
  const serviceDirectory = join(fixture, "server", "services");
  const serviceFile = join(serviceDirectory, "members.ts");
  const commitDiffDirectory = join(fixture, "commit-diffs");
  mkdirSync(serviceDirectory, { recursive: true });
  mkdirSync(commitDiffDirectory);
  writeFileSync(join(fixture, "CHANGELOG.md"), "# Fixture\n");
  if (baseSource !== null) {
    writeFileSync(serviceFile, baseSource);
  }
  for (const args of [
    ["init", "--quiet"],
    ["config", "user.email", "fixture@example.test"],
    ["config", "user.name", "Fixture"],
    ["add", "."],
    ["commit", "--quiet", "-m", "fixture base"],
  ]) {
    const result = spawnSync("git", args, { cwd: fixture, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  }
  const baseSha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: fixture,
    encoding: "utf8",
  }).stdout.trim();
  if (headSource === null) {
    rmSync(serviceFile, { force: true });
  } else {
    writeFileSync(serviceFile, headSource);
  }
  writeFileSync(join(fixture, "pr.diff"), diff);
  writeFileSync(
    join(commitDiffDirectory, "fixture.diff"),
    [
      "diff --git a/server/services/members.ts b/server/services/members.ts",
      "diff --git a/CHANGELOG.md b/CHANGELOG.md",
      "",
    ].join("\n"),
  );
  const result = spawnSync(
    "python3",
    ["-", fixture, join(fixture, "pr.diff"), commitDiffDirectory, baseSha],
    { input: checker, encoding: "utf8" },
  );
  rmSync(fixture, { recursive: true, force: true });
  return result;
}

describe("Octopus runbook bridge", () => {
  it("keeps PR code out of secret-bearing auto-fix paths", () => {
    const workflow = readFileSync(
      new URL(
        "../../.github/workflows/octopus-pr-quality-gates.yml",
        import.meta.url,
      ),
      "utf8",
    );
    const qualityRunbook = readFileSync(
      new URL(
        "../../.octopus/runbooks/pr-quality-gates.ocl",
        import.meta.url,
      ),
      "utf8",
    );

    expect(workflow).not.toContain("Auto-Fix Suggestions");
    expect(workflow).not.toContain("PR Comment Bot");
    expect(workflow).not.toContain("GH_PAT_FOR_OCTOPUS");
    expect(qualityRunbook).toContain("cancel_queued_tasks = false");
    expect(qualityRunbook).toContain("cancel_running_tasks = false");
    expect(qualityRunbook).not.toContain("#{GitHubPAT}");
    expect(qualityRunbook).not.toContain('-H "$AUTH_HEADER"');
    expect(qualityRunbook).not.toContain("git -c http.extraHeader");
    expect(qualityRunbook).not.toContain("GIT_CONFIG_KEY_0=http.extraHeader");
    expect(qualityRunbook).toContain(
      'git fetch --quiet --no-tags --depth=100 origin "$BASE_SHA" "$HEAD_SHA"',
    );
    expect(qualityRunbook).toContain("curl -fsS --config -");
    expect(qualityRunbook).toContain("git remote remove origin");
    expect(qualityRunbook).toContain(
      "/tmp/octopus_pr_workdir_#{Octopus.Task.Id}",
    );
    expect(qualityRunbook).toContain(
      "Rules 4-10: Change-Aware Security and Tenancy Guards",
    );
    expect(qualityRunbook).toContain(
      'failures.append(("Rule 8", f"{file_path}:{start_line}"',
    );
    expect(qualityRunbook).not.toContain("application/vnd.github.diff");
    expect(qualityRunbook).toContain(
      'file_path.startswith("server/services/")',
    );
    expect(qualityRunbook).toContain(
      're.search(r"\\bidempotency(?:Key)?\\b", masked_window',
    );
    expect(qualityRunbook).toContain("parts[3][2:] if len(parts) >= 4");
  });

  it("keeps every embedded Octopus Bash action syntactically valid", () => {
    const qualityRunbook = readFileSync(
      new URL(
        "../../.octopus/runbooks/pr-quality-gates.ocl",
        import.meta.url,
      ),
      "utf8",
    );
    const bodies = [
      ...qualityRunbook.matchAll(
        /Octopus\.Action\.Script\.ScriptBody = <<-EOT\n([\s\S]*?)\n\s*EOT/g,
      ),
    ].map((match) => match[1]);
    expect(bodies.length).toBeGreaterThan(0);

    for (const body of bodies) {
      const indentation = body.match(/^(\s*)\S/m)?.[1].length ?? 0;
      const prefix = " ".repeat(indentation);
      const script = body
        .split("\n")
        .map((line) =>
          line.startsWith(prefix) ? line.slice(indentation) : line,
        )
        .join("\n")
        .replaceAll(/#\{[^}]+\}/g, "fixture");
      const result = spawnSync("bash", ["-n"], {
        input: script,
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
    }
  });

  it("does not treat ordinary re_ substrings as provider credentials", () => {
    const fixture = mkdtempSync(join(tmpdir(), "vinifera-octopus-rule3-safe-"));
    try {
      mkdirSync(join(fixture, "server", "services"), { recursive: true });
      writeFileSync(
        join(fixture, "server", "services", "safe.ts"),
        [
          'export const event = "pre_shipment";',
          'export const operation = "store_meta_attribution_touchpoint";',
          "",
        ].join("\n"),
      );
      initializeGitFixture(fixture);
      const result = runEmbeddedStep(
        "rule-3-no-provider-secrets-in-source",
        fixture,
      );
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain("PASS: Rule 3");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("rejects a boundary-delimited provider credential", () => {
    const fixture = mkdtempSync(join(tmpdir(), "vinifera-octopus-rule3-leak-"));
    try {
      mkdirSync(join(fixture, "server", "services"), { recursive: true });
      writeFileSync(
        join(fixture, "server", "services", "unsafe.ts"),
        'export const credential = "re_1234567890abcdefghijkl";\n',
      );
      initializeGitFixture(fixture);
      const result = runEmbeddedStep(
        "rule-3-no-provider-secrets-in-source",
        fixture,
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("FAIL:");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("rejects an unscoped query added to a flat service file", () => {
    const qualityRunbook = readFileSync(
      new URL(
        "../../.octopus/runbooks/pr-quality-gates.ocl",
        import.meta.url,
      ),
      "utf8",
    );
    const embeddedChecker = qualityRunbook.match(
      /python3 - "\$WORK_DIR" "\$WORK_DIR\/pr\.diff" "\$WORK_DIR\/commit-diffs" "\$MERGE_BASE_SHA" <<'PY'\n([\s\S]*?)\n\s*PY/,
    )?.[1];
    expect(embeddedChecker).toBeTruthy();
    const indentation = embeddedChecker.match(/^(\s*)\S/m)?.[1].length ?? 0;
    const checker = embeddedChecker
      .split("\n")
      .map((line) => line.slice(Math.min(indentation, line.length)))
      .join("\n");

    const fixture = mkdtempSync(join(tmpdir(), "vinifera-octopus-rule8-"));
    try {
      const serviceDirectory = join(fixture, "server", "services");
      const commitDiffDirectory = join(fixture, "commit-diffs");
      mkdirSync(serviceDirectory, { recursive: true });
      mkdirSync(commitDiffDirectory);
      writeFileSync(
        join(serviceDirectory, "members.ts"),
        [
          "export async function unsafe(admin, brandId) {",
          '  return admin.from("members").select("*"); // .eq("brand_id", brandId)',
          "}",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(fixture, "pr.diff"),
        [
          "diff --git a/server/services/members.ts b/server/services/members.ts",
          "new file mode 100644",
          "--- /dev/null",
          "+++ b/server/services/members.ts",
          "@@ -0,0 +1,3 @@",
          "+export async function unsafe(admin, brandId) {",
          '+  return admin.from("members").select("*"); // .eq("brand_id", brandId)',
          "+}",
          "diff --git a/CHANGELOG.md b/CHANGELOG.md",
          "--- a/CHANGELOG.md",
          "+++ b/CHANGELOG.md",
          "@@ -1 +1,2 @@",
          "+security regression fixture",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(commitDiffDirectory, "fixture.diff"),
        [
          "diff --git a/server/services/members.ts b/server/services/members.ts",
          "diff --git a/CHANGELOG.md b/CHANGELOG.md",
          "",
        ].join("\n"),
      );

      const result = spawnSync(
        "python3",
        ["-", fixture, join(fixture, "pr.diff"), commitDiffDirectory],
        { input: checker, encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "FAIL Rule 8: server/services/members.ts:2",
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("rejects a query whose tenant predicate is deleted", () => {
    const qualityRunbook = readFileSync(
      new URL(
        "../../.octopus/runbooks/pr-quality-gates.ocl",
        import.meta.url,
      ),
      "utf8",
    );
    const embeddedChecker = qualityRunbook.match(
      /python3 - "\$WORK_DIR" "\$WORK_DIR\/pr\.diff" "\$WORK_DIR\/commit-diffs" "\$MERGE_BASE_SHA" <<'PY'\n([\s\S]*?)\n\s*PY/,
    )?.[1];
    expect(embeddedChecker).toBeTruthy();
    const indentation = embeddedChecker.match(/^(\s*)\S/m)?.[1].length ?? 0;
    const checker = embeddedChecker
      .split("\n")
      .map((line) => line.slice(Math.min(indentation, line.length)))
      .join("\n");

    const fixture = mkdtempSync(
      join(tmpdir(), "vinifera-octopus-rule8-delete-"),
    );
    try {
      const serviceDirectory = join(fixture, "server", "services");
      const commitDiffDirectory = join(fixture, "commit-diffs");
      mkdirSync(serviceDirectory, { recursive: true });
      mkdirSync(commitDiffDirectory);
      writeFileSync(
        join(serviceDirectory, "members.ts"),
        [
          "export async function unsafe(admin) {",
          '  return admin.from("members")',
          '    .select("*")',
          "}",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(fixture, "pr.diff"),
        [
          "diff --git a/server/services/members.ts b/server/services/members.ts",
          "--- a/server/services/members.ts",
          "+++ b/server/services/members.ts",
          "@@ -1,5 +1,4 @@",
          " export async function unsafe(admin) {",
          '   return admin.from("members")',
          '     .select("*")',
          '-    .eq("brand_id", brandId);',
          " }",
          "diff --git a/CHANGELOG.md b/CHANGELOG.md",
          "--- a/CHANGELOG.md",
          "+++ b/CHANGELOG.md",
          "@@ -1 +1,2 @@",
          "+security regression fixture",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(commitDiffDirectory, "fixture.diff"),
        [
          "diff --git a/server/services/members.ts b/server/services/members.ts",
          "diff --git a/CHANGELOG.md b/CHANGELOG.md",
          "",
        ].join("\n"),
      );

      const result = spawnSync(
        "python3",
        ["-", fixture, join(fixture, "pr.diff"), commitDiffDirectory],
        { input: checker, encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "FAIL Rule 8: server/services/members.ts:2",
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("binds tenant predicates to the individual changed query", () => {
    const qualityRunbook = readFileSync(
      new URL(
        "../../.octopus/runbooks/pr-quality-gates.ocl",
        import.meta.url,
      ),
      "utf8",
    );
    const embeddedChecker = qualityRunbook.match(
      /python3 - "\$WORK_DIR" "\$WORK_DIR\/pr\.diff" "\$WORK_DIR\/commit-diffs" "\$MERGE_BASE_SHA" <<'PY'\n([\s\S]*?)\n\s*PY/,
    )?.[1];
    expect(embeddedChecker).toBeTruthy();
    const indentation = embeddedChecker.match(/^(\s*)\S/m)?.[1].length ?? 0;
    const checker = embeddedChecker
      .split("\n")
      .map((line) => line.slice(Math.min(indentation, line.length)))
      .join("\n");

    const fixture = mkdtempSync(join(tmpdir(), "vinifera-octopus-rule8-bind-"));
    try {
      const serviceDirectory = join(fixture, "server", "services");
      const commitDiffDirectory = join(fixture, "commit-diffs");
      mkdirSync(serviceDirectory, { recursive: true });
      mkdirSync(commitDiffDirectory);
      writeFileSync(
        join(serviceDirectory, "members.ts"),
        [
          "export async function mixed(admin, brandId) {",
          '  const scoped = await admin.from("members").select("*").eq("brand_id", brandId);',
          '  const unsafe = await admin.from("shipments").select("*");',
          "  return { scoped, unsafe };",
          "}",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(fixture, "pr.diff"),
        [
          "diff --git a/server/services/members.ts b/server/services/members.ts",
          "--- a/server/services/members.ts",
          "+++ b/server/services/members.ts",
          "@@ -1,3 +1,5 @@",
          " export async function mixed(admin, brandId) {",
          '   const scoped = await admin.from("members").select("*").eq("brand_id", brandId);',
          '+  const unsafe = await admin.from("shipments").select("*");',
          "+  return { scoped, unsafe };",
          "+}",
          "diff --git a/CHANGELOG.md b/CHANGELOG.md",
          "--- a/CHANGELOG.md",
          "+++ b/CHANGELOG.md",
          "@@ -1 +1,2 @@",
          "+security regression fixture",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(commitDiffDirectory, "fixture.diff"),
        [
          "diff --git a/server/services/members.ts b/server/services/members.ts",
          "diff --git a/CHANGELOG.md b/CHANGELOG.md",
          "",
        ].join("\n"),
      );

      const result = spawnSync(
        "python3",
        ["-", fixture, join(fixture, "pr.diff"), commitDiffDirectory],
        { input: checker, encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "FAIL Rule 8: server/services/members.ts:3",
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("rejects a tenant predicate deleted from a later query assignment", () => {
    const qualityRunbook = readFileSync(
      new URL(
        "../../.octopus/runbooks/pr-quality-gates.ocl",
        import.meta.url,
      ),
      "utf8",
    );
    const embeddedChecker = qualityRunbook.match(
      /python3 - "\$WORK_DIR" "\$WORK_DIR\/pr\.diff" "\$WORK_DIR\/commit-diffs" "\$MERGE_BASE_SHA" <<'PY'\n([\s\S]*?)\n\s*PY/,
    )?.[1];
    expect(embeddedChecker).toBeTruthy();
    const indentation = embeddedChecker.match(/^(\s*)\S/m)?.[1].length ?? 0;
    const checker = embeddedChecker
      .split("\n")
      .map((line) => line.slice(Math.min(indentation, line.length)))
      .join("\n");

    const fixture = mkdtempSync(
      join(tmpdir(), "vinifera-octopus-rule8-builder-"),
    );
    try {
      const serviceDirectory = join(fixture, "server", "services");
      const commitDiffDirectory = join(fixture, "commit-diffs");
      mkdirSync(serviceDirectory, { recursive: true });
      mkdirSync(commitDiffDirectory);
      writeFileSync(
        join(serviceDirectory, "members.ts"),
        [
          "export async function unsafe(admin) {",
          '  let query = admin.from("members").select("*");',
          "  const one = 1;",
          "  const two = 2;",
          "  const three = 3;",
          "  const four = 4;",
          "  return { query, one, two, three, four };",
          "}",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(fixture, "pr.diff"),
        [
          "diff --git a/server/services/members.ts b/server/services/members.ts",
          "--- a/server/services/members.ts",
          "+++ b/server/services/members.ts",
          "@@ -1,9 +1,8 @@",
          " export async function unsafe(admin) {",
          '   let query = admin.from("members").select("*");',
          "   const one = 1;",
          "   const two = 2;",
          "   const three = 3;",
          "   const four = 4;",
          '-  query = query.eq("brand_id", brandId);',
          "   return { query, one, two, three, four };",
          " }",
          "diff --git a/CHANGELOG.md b/CHANGELOG.md",
          "--- a/CHANGELOG.md",
          "+++ b/CHANGELOG.md",
          "@@ -1 +1,2 @@",
          "+security regression fixture",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(commitDiffDirectory, "fixture.diff"),
        [
          "diff --git a/server/services/members.ts b/server/services/members.ts",
          "diff --git a/CHANGELOG.md b/CHANGELOG.md",
          "",
        ].join("\n"),
      );

      const result = spawnSync(
        "python3",
        ["-", fixture, join(fixture, "pr.diff"), commitDiffDirectory],
        { input: checker, encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "FAIL Rule 8: server/services/members.ts:2",
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("does not split a scoped query at a nested Array.from call", () => {
    const qualityRunbook = readFileSync(
      new URL(
        "../../.octopus/runbooks/pr-quality-gates.ocl",
        import.meta.url,
      ),
      "utf8",
    );
    const embeddedChecker = qualityRunbook.match(
      /python3 - "\$WORK_DIR" "\$WORK_DIR\/pr\.diff" "\$WORK_DIR\/commit-diffs" "\$MERGE_BASE_SHA" <<'PY'\n([\s\S]*?)\n\s*PY/,
    )?.[1];
    expect(embeddedChecker).toBeTruthy();
    const indentation = embeddedChecker.match(/^(\s*)\S/m)?.[1].length ?? 0;
    const checker = embeddedChecker
      .split("\n")
      .map((line) => line.slice(Math.min(indentation, line.length)))
      .join("\n");

    const fixture = mkdtempSync(
      join(tmpdir(), "vinifera-octopus-rule8-array-"),
    );
    try {
      const serviceDirectory = join(fixture, "server", "services");
      const commitDiffDirectory = join(fixture, "commit-diffs");
      mkdirSync(serviceDirectory, { recursive: true });
      mkdirSync(commitDiffDirectory);
      writeFileSync(
        join(serviceDirectory, "members.ts"),
        [
          "export async function safe(admin, brandId, ids) {",
          '  return admin.from("members").update({ ids: Array.from(ids) }).eq("brand_id", brandId);',
          "}",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(fixture, "pr.diff"),
        [
          "diff --git a/server/services/members.ts b/server/services/members.ts",
          "new file mode 100644",
          "--- /dev/null",
          "+++ b/server/services/members.ts",
          "@@ -0,0 +1,3 @@",
          "+export async function safe(admin, brandId, ids) {",
          '+  return admin.from("members").update({ ids: Array.from(ids) }).eq("brand_id", brandId);',
          "+}",
          "diff --git a/CHANGELOG.md b/CHANGELOG.md",
          "--- a/CHANGELOG.md",
          "+++ b/CHANGELOG.md",
          "@@ -1 +1,2 @@",
          "+security regression fixture",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(commitDiffDirectory, "fixture.diff"),
        [
          "diff --git a/server/services/members.ts b/server/services/members.ts",
          "diff --git a/CHANGELOG.md b/CHANGELOG.md",
          "",
        ].join("\n"),
      );

      const result = spawnSync(
        "python3",
        ["-", fixture, join(fixture, "pr.diff"), commitDiffDirectory],
        { input: checker, encoding: "utf8" },
      );
      expect(result.status, result.stdout + result.stderr).toBe(0);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("accepts a new query scoped through a later variable assignment", () => {
    const headSource = [
      "export async function safe(admin, brandId) {",
      '  let query = admin.from("members").select("*");',
      "  const audit = true;",
      '  query = query.eq("brand_id", brandId);',
      "  return { query, audit };",
      "}",
      "",
    ].join("\n");
    const result = runRule8BaseHeadFixture({
      baseSource: null,
      headSource,
      diff: [
        "diff --git a/server/services/members.ts b/server/services/members.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/server/services/members.ts",
        "@@ -0,0 +1,6 @@",
        ...headSource
          .trimEnd()
          .split("\n")
          .map((line) => `+${line}`),
        "diff --git a/CHANGELOG.md b/CHANGELOG.md",
        "--- a/CHANGELOG.md",
        "+++ b/CHANGELOG.md",
        "@@ -1 +1,2 @@",
        "+security regression fixture",
        "",
      ].join("\n"),
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("does not grandfather a duplicate of a legacy unscoped query", () => {
    const legacy = [
      "export async function legacy(admin) {",
      '  return admin.from("members").select("*");',
      "}",
      "",
    ].join("\n");
    const duplicate = [
      legacy.trimEnd(),
      "",
      "export async function newlyUnsafe(admin) {",
      '  return admin.from("members").select("*");',
      "}",
      "",
    ].join("\n");
    const result = runRule8BaseHeadFixture({
      baseSource: legacy,
      headSource: duplicate,
      diff: [
        "diff --git a/server/services/members.ts b/server/services/members.ts",
        "--- a/server/services/members.ts",
        "+++ b/server/services/members.ts",
        "@@ -1,3 +1,7 @@",
        " export async function legacy(admin) {",
        '   return admin.from("members").select("*");',
        " }",
        "+",
        "+export async function newlyUnsafe(admin) {",
        '+  return admin.from("members").select("*");',
        "+}",
        "diff --git a/CHANGELOG.md b/CHANGELOG.md",
        "--- a/CHANGELOG.md",
        "+++ b/CHANGELOG.md",
        "@@ -1 +1,2 @@",
        "+security regression fixture",
        "",
      ].join("\n"),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "FAIL Rule 8: server/services/members.ts:6",
    );
  });

  it("does not grandfather a change to a privileged database receiver", () => {
    const baseSource = [
      "export async function legacy(ctx) {",
      '  return ctx.tenantClient.from("members").select("*");',
      "}",
      "",
    ].join("\n");
    const headSource = [
      "export async function newlyPrivileged() {",
      '  return this.admin.from("members").select("*");',
      "}",
      "",
    ].join("\n");
    const result = runRule8BaseHeadFixture({
      baseSource,
      headSource,
      diff: [
        "diff --git a/server/services/members.ts b/server/services/members.ts",
        "--- a/server/services/members.ts",
        "+++ b/server/services/members.ts",
        "@@ -1,3 +1,3 @@",
        "-export async function legacy(ctx) {",
        '-  return ctx.tenantClient.from("members").select("*");',
        "+export async function newlyPrivileged() {",
        '+  return this.admin.from("members").select("*");',
        " }",
        "diff --git a/CHANGELOG.md b/CHANGELOG.md",
        "--- a/CHANGELOG.md",
        "+++ b/CHANGELOG.md",
        "@@ -1 +1,2 @@",
        "+security regression fixture",
        "",
      ].join("\n"),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "FAIL Rule 8: server/services/members.ts:2",
    );
  });

  it("refuses to grandfather an unscoped call-expression receiver", () => {
    const baseSource = [
      "export async function legacy() {",
      '  return getTenantClient().from("members").select("*");',
      "}",
      "",
    ].join("\n");
    const headSource = [
      "export async function newlyPrivileged() {",
      '  return getAdminClient().from("members").select("*");',
      "}",
      "",
    ].join("\n");
    const result = runRule8BaseHeadFixture({
      baseSource,
      headSource,
      diff: [
        "diff --git a/server/services/members.ts b/server/services/members.ts",
        "--- a/server/services/members.ts",
        "+++ b/server/services/members.ts",
        "@@ -1,3 +1,3 @@",
        "-export async function legacy() {",
        '-  return getTenantClient().from("members").select("*");',
        "+export async function newlyPrivileged() {",
        '+  return getAdminClient().from("members").select("*");',
        " }",
        "diff --git a/CHANGELOG.md b/CHANGELOG.md",
        "--- a/CHANGELOG.md",
        "+++ b/CHANGELOG.md",
        "@@ -1 +1,2 @@",
        "+security regression fixture",
        "",
      ].join("\n"),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "FAIL Rule 8: server/services/members.ts:2",
    );
  });

  it("follows a builder split before the database operation", () => {
    const headSource = [
      "export async function safe(admin, brandId) {",
      '  const table = admin.from("members");',
      '  let query = table.select("*");',
      '  query = query.eq("brand_id", brandId);',
      "  return query;",
      "}",
      "",
    ].join("\n");
    const result = runRule8BaseHeadFixture({
      baseSource: null,
      headSource,
      diff: [
        "diff --git a/server/services/members.ts b/server/services/members.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/server/services/members.ts",
        "@@ -0,0 +1,6 @@",
        ...headSource
          .trimEnd()
          .split("\n")
          .map((line) => `+${line}`),
        "diff --git a/CHANGELOG.md b/CHANGELOG.md",
        "--- a/CHANGELOG.md",
        "+++ b/CHANGELOG.md",
        "@@ -1 +1,2 @@",
        "+security regression fixture",
        "",
      ].join("\n"),
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("evaluates forked builder descendants as independent query chains", () => {
    const headSource = [
      "export async function mixed(admin, brandId) {",
      '  const table = admin.from("members");',
      '  const scoped = table.select("*").eq("brand_id", brandId);',
      "  const unsafe = table.delete();",
      "  return { scoped, unsafe };",
      "}",
      "",
    ].join("\n");
    const result = runRule8BaseHeadFixture({
      baseSource: null,
      headSource,
      diff: [
        "diff --git a/server/services/members.ts b/server/services/members.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/server/services/members.ts",
        "@@ -0,0 +1,6 @@",
        ...headSource
          .trimEnd()
          .split("\n")
          .map((line) => `+${line}`),
        "diff --git a/CHANGELOG.md b/CHANGELOG.md",
        "--- a/CHANGELOG.md",
        "+++ b/CHANGELOG.md",
        "@@ -1 +1,2 @@",
        "+security regression fixture",
        "",
      ].join("\n"),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "FAIL Rule 8: server/services/members.ts:2",
    );
    expect(result.stdout).toContain("table.delete()");
  });

  it("does not borrow a tenant predicate from an adjacent function", () => {
    const headSource = [
      "export async function unsafe(admin) {",
      '  const table = admin.from("members");',
      '  const query = table.select("*");',
      "  return query;",
      "}",
      "",
      "export async function safe(admin, brandId) {",
      '  const table = admin.from("members");',
      '  let query = table.select("*");',
      '  query = query.eq("brand_id", brandId);',
      "  return query;",
      "}",
      "",
    ].join("\n");
    const result = runRule8BaseHeadFixture({
      baseSource: null,
      headSource,
      diff: [
        "diff --git a/server/services/members.ts b/server/services/members.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/server/services/members.ts",
        "@@ -0,0 +1,12 @@",
        ...headSource
          .trimEnd()
          .split("\n")
          .map((line) => `+${line}`),
        "diff --git a/CHANGELOG.md b/CHANGELOG.md",
        "--- a/CHANGELOG.md",
        "+++ b/CHANGELOG.md",
        "@@ -1 +1,2 @@",
        "+security regression fixture",
        "",
      ].join("\n"),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "FAIL Rule 8: server/services/members.ts:2",
    );
  });

  it("rejects a conditionally applied tenant predicate", () => {
    const headSource = [
      "export async function unsafe(admin, brandId) {",
      '  let query = admin.from("members").select("*");',
      "  if (false) {",
      '    query = query.eq("brand_id", brandId);',
      "  }",
      "  return query;",
      "}",
      "",
    ].join("\n");
    const result = runRule8BaseHeadFixture({
      baseSource: null,
      headSource,
      diff: [
        "diff --git a/server/services/members.ts b/server/services/members.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/server/services/members.ts",
        "@@ -0,0 +1,7 @@",
        ...headSource
          .trimEnd()
          .split("\n")
          .map((line) => `+${line}`),
        "diff --git a/CHANGELOG.md b/CHANGELOG.md",
        "--- a/CHANGELOG.md",
        "+++ b/CHANGELOG.md",
        "@@ -1 +1,2 @@",
        "+security regression fixture",
        "",
      ].join("\n"),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "FAIL Rule 8: server/services/members.ts:2",
    );
  });

  it("rejects removal of a multiline later tenant predicate", () => {
    const baseSource = [
      "export async function unsafe(admin, brandId) {",
      '  let query = admin.from("members").select("*");',
      "  const one = 1;",
      "  const two = 2;",
      "  const three = 3;",
      "  query = query.eq(",
      '    "brand_id",',
      "    brandId,",
      "  );",
      "  return { query, one, two, three };",
      "}",
      "",
    ].join("\n");
    const headSource = [
      "export async function unsafe(admin) {",
      '  let query = admin.from("members").select("*");',
      "  const one = 1;",
      "  const two = 2;",
      "  const three = 3;",
      "  return { query, one, two, three };",
      "}",
      "",
    ].join("\n");
    const result = runRule8BaseHeadFixture({
      baseSource,
      headSource,
      diff: [
        "diff --git a/server/services/members.ts b/server/services/members.ts",
        "--- a/server/services/members.ts",
        "+++ b/server/services/members.ts",
        "@@ -1,11 +1,7 @@",
        "-export async function unsafe(admin, brandId) {",
        "+export async function unsafe(admin) {",
        '   let query = admin.from("members").select("*");',
        "   const one = 1;",
        "   const two = 2;",
        "   const three = 3;",
        "-  query = query.eq(",
        '-    "brand_id",',
        "-    brandId,",
        "-  );",
        "   return { query, one, two, three };",
        " }",
        "diff --git a/CHANGELOG.md b/CHANGELOG.md",
        "--- a/CHANGELOG.md",
        "+++ b/CHANGELOG.md",
        "@@ -1 +1,2 @@",
        "+security regression fixture",
        "",
      ].join("\n"),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "FAIL Rule 8: server/services/members.ts:2",
    );
  });

  it("accepts deletion of an entire scoped query", () => {
    const baseSource = [
      "export async function obsolete(admin, brandId) {",
      '  return admin.from("members").select("*").eq("brand_id", brandId);',
      "}",
      "",
    ].join("\n");
    const result = runRule8BaseHeadFixture({
      baseSource,
      headSource: null,
      diff: [
        "diff --git a/server/services/members.ts b/server/services/members.ts",
        "deleted file mode 100644",
        "--- a/server/services/members.ts",
        "+++ /dev/null",
        "@@ -1,3 +0,0 @@",
        "-export async function obsolete(admin, brandId) {",
        '-  return admin.from("members").select("*").eq("brand_id", brandId);',
        "-}",
        "diff --git a/CHANGELOG.md b/CHANGELOG.md",
        "--- a/CHANGELOG.md",
        "+++ b/CHANGELOG.md",
        "@@ -1 +1,2 @@",
        "+security regression fixture",
        "",
      ].join("\n"),
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("rejects an unscoped operation on a caller-supplied builder", () => {
    const result = runRule8BaseHeadFixture({
      baseSource: "",
      headSource: [
        "export async function list(table) {",
        '  return table.select("*");',
        "}",
        "",
      ].join("\n"),
      diff: [
        "diff --git a/server/services/members.ts b/server/services/members.ts",
        "--- a/server/services/members.ts",
        "+++ b/server/services/members.ts",
        "@@ -0,0 +1,3 @@",
        "+export async function list(table) {",
        '+  return table.select("*");',
        "+}",
        "diff --git a/CHANGELOG.md b/CHANGELOG.md",
        "",
      ].join("\n"),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL Rule 8");
  });

  it("requires a changelog update in the aggregate PR diff", () => {
    const qualityRunbook = readFileSync(
      new URL(
        "../../.octopus/runbooks/pr-quality-gates.ocl",
        import.meta.url,
      ),
      "utf8",
    );
    const embeddedChecker = qualityRunbook.match(
      /python3 - "\$WORK_DIR" "\$WORK_DIR\/pr\.diff" "\$WORK_DIR\/commit-diffs" "\$MERGE_BASE_SHA" <<'PY'\n([\s\S]*?)\n\s*PY/,
    )?.[1];
    expect(embeddedChecker).toBeTruthy();
    const indentation = embeddedChecker.match(/^(\s*)\S/m)?.[1].length ?? 0;
    const checker = embeddedChecker
      .split("\n")
      .map((line) => line.slice(Math.min(indentation, line.length)))
      .join("\n");

    const fixture = mkdtempSync(join(tmpdir(), "vinifera-octopus-rule9-"));
    try {
      const commitDiffDirectory = join(fixture, "commit-diffs");
      mkdirSync(commitDiffDirectory);
      writeFileSync(
        join(fixture, "pr.diff"),
        [
          "diff --git a/src/client/example.ts b/src/client/example.ts",
          "+++ b/src/client/example.ts",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(commitDiffDirectory, "missing-changelog.diff"),
        [
          "diff --git a/src/client/example.ts b/src/client/example.ts",
          "+++ b/src/client/example.ts",
          "",
        ].join("\n"),
      );

      const result = spawnSync(
        "python3",
        ["-", fixture, join(fixture, "pr.diff"), commitDiffDirectory],
        { input: checker, encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "FAIL Rule 9: PR diff: src/client/example.ts",
      );

      writeFileSync(
        join(fixture, "pr.diff"),
        [
          "diff --git a/src/client/example.ts b/src/client/example.ts",
          "+++ b/src/client/example.ts",
          "diff --git a/CHANGELOG.md b/CHANGELOG.md",
          "+++ b/CHANGELOG.md",
          "",
        ].join("\n"),
      );
      const aggregateResult = spawnSync(
        "python3",
        ["-", fixture, join(fixture, "pr.diff"), commitDiffDirectory],
        { input: checker, encoding: "utf8" },
      );
      expect(aggregateResult.status).toBe(0);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("normalizes an HTTPS server URL to the API root", () => {
    expect(normalizeApiBase("https://octopus.example.test/")).toBe(
      "https://octopus.example.test/api",
    );
    expect(normalizeApiBase("https://octopus.example.test/api/")).toBe(
      "https://octopus.example.test/api",
    );
  });

  it("rejects an insecure server URL", () => {
    expect(() => normalizeApiBase("http://octopus.example.test")).toThrow(
      "must use HTTPS",
    );
  });

  it("builds a bare-branch Config-as-Code runbook path", () => {
    expect(
      configAsCodeRunbooksPath("Projects-1", "refs/heads/main"),
    ).toBe("projects/Projects-1/main/runbooks");
    expect(() =>
      configAsCodeRunbooksPath("Projects-1", "main"),
    ).toThrow("refs/heads");
  });

  it("reports credential shape without exposing credential values", () => {
    const summary = credentialShapeSummary({
      CF_ACCESS_CLIENT_ID: "client-id.access",
      CF_ACCESS_CLIENT_SECRET: "sensitive-value",
      OCTOPUS_API_KEY: "API-EXAMPLE",
      OCTOPUS_URL: "https://octopus.example.test",
    });

    expect(summary).toBe(
      "Octopus credential shape accepted: cf-client-id-chars=16; " +
        "cf-client-secret-chars=15; octopus-api-key-chars=11; " +
        "octopus-host=octopus.example.test",
    );
    expect(summary).not.toContain("sensitive-value");
    expect(() =>
      credentialShapeSummary({
        CF_ACCESS_CLIENT_ID: "client-id.access",
        CF_ACCESS_CLIENT_SECRET: "curly\u201csecret",
        OCTOPUS_API_KEY: "API-EXAMPLE",
        OCTOPUS_URL: "https://octopus.example.test",
      }),
    ).toThrow("visible ASCII");
  });

  it("reports safe HTTP response provenance without response bodies", () => {
    const response = new Response("private response body", {
      status: 403,
      headers: {
        "CF-Ray": "fixture-ray",
        "Content-Type": "text/html; charset=UTF-8",
        Location:
          "https://little-brook.cloudflareaccess.com/cdn-cgi/access/login",
        Server: "cloudflare",
      },
    });

    const provenance = responseProvenance(response);
    expect(provenance).toBe(
      "server=cloudflare; cf-ray=present; content-type=text/html; " +
        "redirect-host=little-brook.cloudflareaccess.com",
    );
    expect(provenance).not.toContain("private response body");
  });

  it("localizes a nightly audit access failure without exposing credentials", async () => {
    const log = vi.fn();
    const fetchImpl = vi.fn(async () =>
      new Response("private Cloudflare response", {
        status: 403,
        headers: {
          "CF-Ray": "fixture-ray",
          "Content-Type": "text/html; charset=UTF-8",
          Server: "cloudflare",
        },
      }),
    );

    await expect(
      runSecurityAudit({
        environment: {
          CF_ACCESS_CLIENT_ID: "access-client-id",
          CF_ACCESS_CLIENT_SECRET: "access-client-secret",
          OCTOPUS_API_KEY: "secret-api-key",
          OCTOPUS_URL: "https://octopus.example.test",
        },
        fetchImpl,
        log,
      }),
    ).rejects.toThrow(
      "GET /api/spaces with HTTP 403 (server=cloudflare; cf-ray=present; " +
        "content-type=text/html; redirect-host=absent)",
    );
    expect(log).toHaveBeenCalledWith(
      "Octopus credential shape accepted: cf-client-id-chars=16; " +
        "cf-client-secret-chars=20; octopus-api-key-chars=14; " +
        "octopus-host=octopus.example.test",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("access-client-secret");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-api-key");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      "User-Agent": "Vinifera-GitHub-Actions/1.0",
    });
  });

  it("runs the nightly audit through the Config-as-Code main reference", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const path = new URL(url).pathname;
      if (path === "/api/spaces") {
        return jsonResponse({ Items: [{ Id: "Spaces-1", Name: "Default" }] });
      }
      if (path === "/api/Spaces-1/environments") {
        return jsonResponse({
          Items: [{ Id: "Environments-1", Name: "Development" }],
        });
      }
      if (path === "/api/Spaces-1/projects") {
        return jsonResponse({ Items: [{ Id: "Projects-1", Name: "Vinifera" }] });
      }
      if (path.endsWith("/main/runbooks")) {
        return jsonResponse({
          Items: [{ Name: "Security Audit", Slug: "security-audit" }],
        });
      }
      if (path.endsWith("/security-audit/runbookRuns/preview/Environments-1")) {
        return jsonResponse({
          Form: {
            Elements: [
              {
                Name: "form-github-pat",
                Control: { Name: "GitHubPAT", Sensitive: true, Required: true },
              },
            ],
          },
        });
      }
      if (path.endsWith("/security-audit/runbookSnapShotTemplate")) {
        return jsonResponse({ Packages: [], GitResources: [] });
      }
      if (path.endsWith("/security-audit/run/v1")) {
        return jsonResponse({
          Resources: [{ Id: "RunbookRuns-1", TaskId: "ServerTasks-1" }],
        });
      }
      if (path === "/api/tasks/ServerTasks-1") {
        return jsonResponse({ State: "Success" });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(
      runSecurityAudit({
        environment: {
          CF_ACCESS_CLIENT_ID: "access-client-id",
          CF_ACCESS_CLIENT_SECRET: "access-client-secret",
          GH_PAT_FOR_OCTOPUS: "github-token",
          OCTOPUS_API_KEY: "secret-api-key",
          OCTOPUS_URL: "https://octopus.example.test",
        },
        fetchImpl,
        pollIntervalMs: 0,
      }),
    ).resolves.toMatchObject({ state: "Success", taskId: "ServerTasks-1" });
    expect(
      calls.some(({ url }) =>
        url.includes("/projects/Projects-1/main/runbooks"),
      ),
    ).toBe(true);
    const runCall = calls.find(({ url }) =>
      url.endsWith("/security-audit/run/v1"),
    );
    expect(JSON.parse(runCall.options.body)).toMatchObject({
      SelectedGitResources: [],
      SelectedPackages: [],
      Runs: [{ FormValues: { "form-github-pat": "github-token" } }],
    });
  });

  it("packages every local module required by the nightly workflow", () => {
    const workflow = readFileSync(
      new URL(
        "../../.github/workflows/octopus-security-audit.yml",
        import.meta.url,
      ),
      "utf8",
    );
    expect(workflow).toContain(".github/scripts/octopus-security-audit.mjs");
    expect(workflow).toContain(".github/scripts/octopus-runbook.mjs");
  });

  it("maps prompted names to Octopus form element IDs and fails closed", () => {
    const preview = {
      Form: {
        Elements: [
          {
            Name: "Variables-1",
            Control: { Name: "PRBranch", Required: true },
          },
          {
            Name: "Variables-2",
            Control: { Name: "PRNumber", Required: true },
          },
        ],
      },
    };
    expect(
      resolveFormValues(preview, { PRBranch: "fix/example", PRNumber: "44" }),
    ).toEqual({
      "Variables-1": "fix/example",
      "Variables-2": "44",
    });
    expect(() =>
      resolveFormValues(preview, { PRBranch: "fix/example" }),
    ).toThrow("Missing required");
  });

  it("refuses to submit a PAT through a non-sensitive Octopus prompt", () => {
    const preview = {
      Form: {
        Elements: [
          {
            Name: "Variables-1",
            Control: { Name: "GitHubPAT", Required: true, Type: "Text" },
          },
        ],
      },
    };

    expect(() =>
      resolveFormValues(preview, { GitHubPAT: "secret-pat" }),
    ).toThrow("GitHubPAT prompted variable must be marked sensitive");
  });

  it("creates a run with prompted values and waits for task success", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("/spaces?")) {
        return jsonResponse({ Items: [{ Id: "Spaces-1", Name: "Default" }] });
      }
      if (String(url).includes("/environments?")) {
        return jsonResponse({
          Items: [{ Id: "Environments-1", Name: "Development" }],
        });
      }
      if (String(url).includes("/projects?")) {
        return jsonResponse({
          Items: [{ Id: "Projects-1", Name: "Vinifera" }],
        });
      }
      if (
        String(url).includes(
          "/projects/Projects-1/main/runbooks?",
        )
      ) {
        return jsonResponse({
          Items: [
            {
              Id: "Runbooks-1",
              Name: "PR Quality Gates",
              Slug: "pr-quality-gates",
            },
          ],
        });
      }
      if (String(url).includes("/preview/Environments-1")) {
        return jsonResponse({
          Form: {
            Elements: [
              { Name: "V-1", Control: { Name: "PRBranch", Required: true } },
              { Name: "V-2", Control: { Name: "PRNumber", Required: true } },
              {
                Name: "V-3",
                Control: { Name: "ExpectedHeadSHA", Required: true },
              },
              {
                Name: "V-4",
                Control: { Name: "ExpectedBaseRef", Required: true },
              },
              {
                Name: "V-5",
                Control: { Name: "ExpectedBaseSHA", Required: true },
              },
              {
                Name: "V-6",
                Control: { Name: "GitHubPAT", Sensitive: true, Required: true },
              },
            ],
          },
        });
      }
      if (String(url).endsWith("/runbookSnapShotTemplate")) {
        return jsonResponse({ Packages: [], GitResources: [] });
      }
      if (String(url).endsWith("/pr-quality-gates/run/v1")) {
        return jsonResponse({
          Resources: [{ Id: "RunbookRuns-1", TaskId: "ServerTasks-1" }],
        });
      }
      if (String(url).endsWith("/tasks/ServerTasks-1")) {
        return jsonResponse({ State: "Success" });
      }
      return jsonResponse({}, 404);
    });
    const log = vi.fn();

    await expect(
      runRunbook({
        runbookName: "PR Quality Gates",
        environment: {
          CF_ACCESS_CLIENT_ID: "access-client-id",
          CF_ACCESS_CLIENT_SECRET: "access-client-secret",
          OCTOPUS_API_KEY: "secret-api-key",
          OCTOPUS_URL: "https://octopus.example.test",
          PR_BRANCH: "fix/example",
          PR_EXPECTED_BASE_REF: "dev",
          PR_EXPECTED_BASE_SHA: "b".repeat(40),
          PR_EXPECTED_SHA: "a".repeat(40),
          PR_NUMBER: "44",
        },
        fetchImpl,
        sleep: vi.fn(),
        log,
      }),
    ).resolves.toEqual({
      runId: "RunbookRuns-1",
      taskId: "ServerTasks-1",
      state: "Success",
    });

    const post = calls.find(({ url }) =>
      url.endsWith("/pr-quality-gates/run/v1"),
    );
    const runRequest = JSON.parse(post.options.body);
    expect(runRequest.SelectedPackages).toEqual([]);
    expect(runRequest.SelectedGitResources).toEqual([]);
    expect(runRequest.Runs[0].FormValues).toEqual({
      "V-1": "fix/example",
      "V-2": "44",
      "V-3": "a".repeat(40),
      "V-4": "dev",
      "V-5": "b".repeat(40),
      "V-6": "unused-stale-octopus-prompt",
    });
    expect(
      calls.every(
        ({ options }) =>
          options.headers["CF-Access-Client-Id"] === "access-client-id" &&
          options.headers["CF-Access-Client-Secret"] ===
            "access-client-secret" &&
          options.headers["X-Octopus-ApiKey"] === "secret-api-key",
      ),
    ).toBe(true);
    expect(log).toHaveBeenCalledWith(
      "Octopus runbook passed: PR Quality Gates",
    );
  });

  it("preserves the timeout error when task cancellation fails", async () => {
    const fetchImpl = vi.fn(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/spaces?")) {
        return jsonResponse({ Items: [{ Id: "Spaces-1", Name: "Default" }] });
      }
      if (requestUrl.includes("/environments?")) {
        return jsonResponse({
          Items: [{ Id: "Environments-1", Name: "Development" }],
        });
      }
      if (requestUrl.includes("/projects?")) {
        return jsonResponse({
          Items: [{ Id: "Projects-1", Name: "Vinifera" }],
        });
      }
      if (
        requestUrl.includes(
          "/projects/Projects-1/main/runbooks?",
        )
      ) {
        return jsonResponse({
          Items: [
            {
              Id: "Runbooks-1",
              Name: "PR Quality Gates",
              Slug: "pr-quality-gates",
            },
          ],
        });
      }
      if (requestUrl.includes("/preview/Environments-1")) {
        return jsonResponse({
          Form: {
            Elements: [
              { Name: "V-1", Control: { Name: "PRBranch", Required: true } },
              { Name: "V-2", Control: { Name: "PRNumber", Required: true } },
              {
                Name: "V-3",
                Control: { Name: "ExpectedHeadSHA", Required: true },
              },
              {
                Name: "V-4",
                Control: { Name: "ExpectedBaseRef", Required: true },
              },
              {
                Name: "V-5",
                Control: { Name: "ExpectedBaseSHA", Required: true },
              },
            ],
          },
        });
      }
      if (requestUrl.endsWith("/runbookSnapShotTemplate")) {
        return jsonResponse({ Packages: [], GitResources: [] });
      }
      if (requestUrl.endsWith("/pr-quality-gates/run/v1")) {
        return jsonResponse({
          Resources: [{ Id: "RunbookRuns-1", TaskId: "ServerTasks-1" }],
        });
      }
      if (requestUrl.endsWith("/tasks/ServerTasks-1/cancel")) {
        return jsonResponse({}, 500);
      }
      return jsonResponse({}, 404);
    });
    const log = vi.fn();

    await expect(
      runRunbook({
        runbookName: "PR Quality Gates",
        environment: {
          CF_ACCESS_CLIENT_ID: "access-client-id",
          CF_ACCESS_CLIENT_SECRET: "access-client-secret",
          OCTOPUS_API_KEY: "secret-api-key",
          OCTOPUS_URL: "https://octopus.example.test",
          PR_BRANCH: "fix/example",
          PR_EXPECTED_BASE_REF: "dev",
          PR_EXPECTED_BASE_SHA: "b".repeat(40),
          PR_EXPECTED_SHA: "a".repeat(40),
          PR_NUMBER: "44",
        },
        fetchImpl,
        timeoutMs: -1,
        log,
      }),
    ).rejects.toThrow("Octopus runbook timed out after -1ms");
    expect(log).toHaveBeenCalledWith(
      "Failed to cancel Octopus task ServerTasks-1: Octopus API request failed " +
        "for POST /api/tasks/ServerTasks-1/cancel with HTTP 500 " +
        "(server=absent; cf-ray=absent; content-type=application/json; " +
        "redirect-host=absent)",
    );
  });
});

describe("Octopus workflow trust boundary", () => {
  it("fails closed when a tracked-source grep encounters an operational error", () => {
    const fixture = mkdtempSync(join(tmpdir(), "vinifera-octopus-grep-error-"));
    try {
      const routeDirectory = join(fixture, "server", "routes");
      mkdirSync(routeDirectory, { recursive: true });
      writeFileSync(
        join(routeDirectory, "health.ts"),
        "export const healthy = true;\n",
      );
      initializeGitFixture(fixture);
      writeFileSync(join(fixture, ".git", "index"), "corrupt-index");

      const result = runEmbeddedStep(
        "rule-1-no-direct-route-to-database-access",
        fixture,
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("tracked-source scan exited with status");
      expect(result.stdout).not.toContain("PASS: Rule 1");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("resolves relative imports before enforcing layer boundaries", () => {
    const fixture = mkdtempSync(join(tmpdir(), "vinifera-octopus-imports-"));
    try {
      const serviceDirectory = join(fixture, "server", "services", "nested");
      const routeDirectory = join(fixture, "server", "routes", "nested");
      mkdirSync(serviceDirectory, { recursive: true });
      mkdirSync(routeDirectory, { recursive: true });
      writeFileSync(
        join(serviceDirectory, "unsafe.ts"),
        'import { route } from "../../routes/admin";\n',
      );
      writeFileSync(
        join(routeDirectory, "unsafe.ts"),
        'export { provider } from "../../integrations/provider";\n',
      );
      initializeGitFixture(fixture);

      const result = runEmbeddedStep(
        "rule-2-no-circular-imports-between-layers",
        fixture,
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("FAIL: forbidden cross-layer imports");
      expect(result.stdout).toContain(
        "server/services/nested/unsafe.ts:1:../../routes/admin",
      );
      expect(result.stdout).toContain(
        "server/routes/nested/unsafe.ts:1:../../integrations/provider",
      );
      expect(result.stdout).not.toContain("PASS: Rule 2");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("executes only the trusted default-branch bridge with secrets", () => {
    const workflow = readFileSync(
      new URL(
        "../../.github/workflows/octopus-pr-quality-gates.yml",
        import.meta.url,
      ),
      "utf8",
    );
    const qualityRunbook = readFileSync(
      new URL(
        "../../.octopus/runbooks/pr-quality-gates.ocl",
        import.meta.url,
      ),
      "utf8",
    );

    expect(workflow).toContain("pull_request_target:");
    expect(workflow).toMatch(
      /quality-gates:[\s\S]*?permissions:\n\s+contents: read\n\s+pull-requests: read\n\s+statuses: write/,
    );
    for (const event of ["opened", "labeled", "unlabeled", "closed"]) {
      expect(workflow).toMatch(new RegExp(`\\b${event},?`));
    }
    expect(workflow).not.toContain("\n  pull_request:");
    expect(workflow).toContain(
      "ref: ${{ github.event.repository.default_branch }}",
    );
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(1);
    expect(
      workflow.match(/github\.event\.pull_request\.head\.sha/g),
    ).toHaveLength(2);
    expect(workflow).toContain(
      "PR_SHA: ${{ github.event.pull_request.head.sha }}",
    );
    expect(workflow).not.toContain(
      "ref: ${{ github.event.pull_request.head.sha }}",
    );
    expect(workflow).not.toContain("github.head_ref");
    expect(workflow).toContain(
      "HEAD_REPOSITORY: ${{ github.event.pull_request.head.repo.full_name }}",
    );
    expect(workflow).toContain(
      "PR_BRANCH: ${{ needs.validate-source.outputs.branch }}",
    );
    expect(workflow).toContain(
      "PR_EXPECTED_SHA: ${{ github.event.pull_request.head.sha }}",
    );
    expect(workflow).toContain(
      "PR_EXPECTED_BASE_REF: ${{ github.event.pull_request.base.ref }}",
    );
    expect(workflow).toContain(
      "PR_EXPECTED_BASE_SHA: ${{ github.event.pull_request.base.sha }}",
    );
    expect(qualityRunbook).toContain('EXPECTED_BASE_REF="#{ExpectedBaseRef}"');
    expect(qualityRunbook).toContain('EXPECTED_BASE_SHA="#{ExpectedBaseSHA}"');
    expect(qualityRunbook).toContain('EXPECTED_HEAD_SHA="#{ExpectedHeadSHA}"');
    expect(qualityRunbook).toContain('[ "$BASE_REF" = "$EXPECTED_BASE_REF" ]');
    expect(qualityRunbook).toContain('[ "$BASE_SHA" = "$EXPECTED_BASE_SHA" ]');
    expect(qualityRunbook).toContain('[ "$HEAD_SHA" = "$EXPECTED_HEAD_SHA" ]');
    expect(qualityRunbook).toContain(
      'git diff --no-ext-diff "$MERGE_BASE_SHA" "$HEAD_SHA"',
    );
    expect(qualityRunbook).toContain('echo "MERGE_BASE_SHA=$MERGE_BASE_SHA"');
    expect(qualityRunbook).toContain(
      'git rev-list --reverse "$MERGE_BASE_SHA..$HEAD_SHA"',
    );
    expect(qualityRunbook).toContain(
      'git show --format= --no-ext-diff --first-parent "$commit_sha"',
    );
    expect(qualityRunbook).not.toContain("application/vnd.github.diff");
    expect(qualityRunbook).not.toContain("/commits?per_page=");
    expect(qualityRunbook).not.toContain('WORK_DIR="/tmp/vinifera-pr"');
    expect(qualityRunbook).not.toContain("grep -rn");
    expect(qualityRunbook).not.toContain('git grep "$@" || true');
    expect(qualityRunbook.match(/set -euo pipefail/g)).toHaveLength(5);
    expect(qualityRunbook.match(/tracked_grep\(\)/g)).toHaveLength(2);
    expect(qualityRunbook.match(/git grep "\$@"/g)).toHaveLength(2);
    expect(qualityRunbook).toContain("if (( status > 1 )); then");
    expect(qualityRunbook).toContain('"git", "show", f"HEAD:{source_path}"');
    expect(qualityRunbook).toContain(
      "posixpath.join(posixpath.dirname(source_path), specifier)",
    );
    expect(
      qualityRunbook.match(
        /source "\/tmp\/octopus_pr_workdir_#\{Octopus\.Task\.Id\}"/g,
      ),
    ).toHaveLength(4);
    expect(workflow).toContain("git check-ref-format --branch");
    expect(workflow).toContain("^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$");
    expect(
      workflow.match(
        /PR_BRANCH: \$\{\{ github\.event\.pull_request\.head\.ref \}\}/g,
      ),
    ).toHaveLength(1);
    expect(workflow).toContain("needs: validate-source\n    if: always()");
    expect(workflow).toContain(
      "VALIDATION_RESULT: ${{ needs.validate-source.result }}",
    );
    expect(workflow).toContain(
      'if [[ "$VALIDATION_RESULT" != "success" ]]; then',
    );
    expect(workflow).not.toMatch(
      /uses:\s+actions\/checkout@(main|master|v[0-9]+)(\s|$)/,
    );
  });
});

describe("staging workflow branch boundary", () => {
  it("validates main after merge but mutates staging only from staging", () => {
    const workflow = readFileSync(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).toContain("branches: [staging, main]");
    expect(
      workflow.match(/github\.ref == 'refs\/heads\/staging'/g),
    ).toHaveLength(2);
  });
});
