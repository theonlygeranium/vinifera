import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  classifyDeliveryChange,
  isPromotionSmokePath,
  parseNameStatusZ,
} from "../.github/scripts/delivery-policy.mjs";

const DEFAULT_MARKER_PREFIX = "VINIFERA_PROMOTION_SMOKE";
const DEFAULT_PROBE_URLS = Object.freeze([
  "https://vinifera-staging.pages.dev",
  "https://vinifera-staging.edstratumlabs.ai",
  "https://vinifera.pages.dev",
  "https://vinifera.edstratumlabs.ai",
  "https://vinifera-live.edstratumlabs.ai",
]);

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd,
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
}

function normalizeBranch(value, label) {
  if (!/^[A-Za-z0-9._/-]+$/.test(value || "") || value.includes("..")) {
    throw new Error(`${label} branch name is unsafe or missing.`);
  }
  return value;
}

function normalizeSuffix(value) {
  if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(value || "")) {
    throw new Error("Smoke suffix must be lowercase alphanumeric/kebab-case.");
  }
  return value;
}

function normalizeDate(value) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value || "")) {
    throw new Error("Smoke date must be YYYY-MM-DD.");
  }
  return value;
}

export function markerFor({ date, suffix }) {
  return `${DEFAULT_MARKER_PREFIX}_${normalizeDate(date).replaceAll("-", "_")}_${normalizeSuffix(suffix).replaceAll("-", "_").toUpperCase()}_MARKER`;
}

export function artifactPathFor({ date, suffix }) {
  const path = `public/vinifera-promotion-smoke-${normalizeDate(date)}-${normalizeSuffix(suffix)}.html`;
  if (!isPromotionSmokePath(path)) {
    throw new Error(`Generated smoke artifact path is not allowlisted: ${path}`);
  }
  return path;
}

export function artifactHtml({ date, suffix }) {
  const marker = markerFor({ date, suffix });
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Vinifera Promotion Smoke ${date}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f7f3ee;
        color: #19231f;
      }
      main {
        width: min(720px, calc(100vw - 40px));
        border: 1px solid #d7c9b8;
        border-radius: 8px;
        padding: 32px;
        background: #fffaf4;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 24px;
        line-height: 1.2;
      }
      p {
        margin: 8px 0;
        line-height: 1.55;
      }
      .marker {
        overflow-wrap: anywhere;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Vinifera Promotion Smoke</h1>
      <p>This hidden page validates the dev, staging, and production promotion path.</p>
      <p>It is intentionally unlinked and marked noindex/nofollow.</p>
      <p class="marker">${marker}</p>
    </main>
  </body>
</html>
`;
}

export function createArtifact({ date, suffix, repositoryRoot = process.cwd() }) {
  const relativePath = artifactPathFor({ date, suffix });
  const absolutePath = resolve(repositoryRoot, relativePath);
  if (existsSync(absolutePath)) {
    throw new Error(`Smoke artifact already exists: ${relativePath}`);
  }
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, artifactHtml({ date, suffix }), { mode: 0o600 });
  return { path: relativePath, marker: markerFor({ date, suffix }) };
}

export function readDiffRecords(baseRef, headRef) {
  const output = git(["diff", "--name-status", "-z", baseRef, headRef], {
    encoding: "buffer",
  });
  return parseNameStatusZ(output);
}

function readStagedDiffRecords(repositoryRoot = process.cwd()) {
  const output = git(["diff", "--cached", "--name-status", "-z", "-M", "-C"], {
    cwd: repositoryRoot,
    encoding: "buffer",
  });
  return parseNameStatusZ(output);
}

function checkCleanWhitespace(repositoryRoot = process.cwd()) {
  git(["diff", "--check"], { cwd: repositoryRoot, stdio: "pipe" });
}

function mergeable(baseRef, headRef) {
  try {
    git(["merge-tree", "--write-tree", baseRef, headRef]);
    return { mergeable: true, reason: "merge_tree_clean" };
  } catch (error) {
    return {
      mergeable: false,
      reason: "merge_tree_conflict",
      details: error.stderr?.toString?.() || error.message,
    };
  }
}

function formatRecords(records) {
  return records
    .map(({ status, paths }) => `${status}\t${paths.join("\t")}`)
    .join("\n");
}

export function evaluateStartPreflight({
  devRef = "origin/dev",
  stagingRef = "origin/staging",
  mainRef = "origin/main",
} = {}) {
  const devToStaging = readDiffRecords(stagingRef, devRef);
  const stagingToMain = readDiffRecords(mainRef, stagingRef);
  const devIntoStaging = mergeable(stagingRef, devRef);
  const stagingIntoMain = mergeable(mainRef, stagingRef);
  const passed =
    devToStaging.length === 0 &&
    stagingToMain.length === 0 &&
    devIntoStaging.mergeable &&
    stagingIntoMain.mergeable;
  return {
    passed,
    devToStaging,
    devIntoStaging,
    stagingToMain,
    stagingIntoMain,
    reason: passed
      ? "branches_tree_and_merge_bases_aligned"
      : "environment_branch_tree_or_mergeability_drift",
  };
}

export function evaluateProductionPreflight({
  stagingRef = "origin/staging",
  mainRef = "origin/main",
} = {}) {
  const records = readDiffRecords(mainRef, stagingRef);
  const stagingIntoMain = mergeable(mainRef, stagingRef);
  const classification = classifyDeliveryChange(records);
  return {
    passed:
      stagingIntoMain.mergeable &&
      classification.classificationSucceeded &&
      classification.lane === "promotion-smoke",
    records,
    stagingIntoMain,
    classification,
    reason: stagingIntoMain.mergeable
      ? classification.reason
      : stagingIntoMain.reason,
  };
}

function fetchBranches({ remote = "origin" } = {}) {
  git(["fetch", remote, "dev", "staging", "main", "--prune"], {
    stdio: "inherit",
  });
}

function summarizePreflight(result, mode) {
  const lines = [`Promotion smoke ${mode} preflight: ${result.passed ? "pass" : "fail"}`];
  lines.push(`Reason: ${result.reason}`);
  if ("devToStaging" in result) {
    lines.push(`Dev into staging merge-tree: ${result.devIntoStaging.reason}`);
    lines.push(`Staging into main merge-tree: ${result.stagingIntoMain.reason}`);
    if (result.devToStaging.length > 0) {
      lines.push("\nDiff staging..dev:");
      lines.push(formatRecords(result.devToStaging));
    }
    if (result.stagingToMain.length > 0) {
      lines.push("\nDiff main..staging:");
      lines.push(formatRecords(result.stagingToMain));
    }
  } else {
    lines.push(`Staging into main merge-tree: ${result.stagingIntoMain.reason}`);
    lines.push(`Lane: ${result.classification.lane}`);
    lines.push(`Paths: ${result.classification.paths.join(", ") || "(none)"}`);
    if (result.records.length > 0) {
      lines.push("\nDiff main..staging:");
      lines.push(formatRecords(result.records));
    }
  }
  return `${lines.join("\n")}\n`;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function withCacheBuster(url, attempt) {
  const parsed = new URL(url);
  parsed.searchParams.set("promotion_smoke_probe", `${Date.now()}-${attempt}`);
  return parsed.href;
}

export async function probeUrl({ url, marker, timeoutMs = 20_000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(withCacheBuster(url, 0), {
      headers: { "cache-control": "no-cache" },
      redirect: "follow",
      signal: controller.signal,
    });
    const body = await response.text();
    return {
      ok: response.ok && body.includes(marker),
      status: response.status,
      finalUrl: response.url,
      markerFound: body.includes(marker),
      noindexFound: /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(body),
      nofollowFound: /<meta[^>]+name=["']robots["'][^>]+nofollow/i.test(body),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      markerFound: false,
      noindexFound: false,
      nofollowFound: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function candidateUrls({ artifactPath, origins }) {
  const withoutPublic = artifactPath.replace(/^public\//, "");
  const withoutHtml = withoutPublic.replace(/\.html$/, "");
  return origins.flatMap((origin) => [
    `${origin.replace(/\/$/, "")}/${withoutPublic}`,
    `${origin.replace(/\/$/, "")}/${withoutHtml}`,
  ]);
}

export async function probeHostedArtifact({
  artifactPath,
  marker,
  origins = DEFAULT_PROBE_URLS,
  deadlineMs = 180_000,
  intervalMs = 10_000,
} = {}) {
  const urls = candidateUrls({ artifactPath, origins });
  const found = new Map();
  const started = Date.now();
  let attempts = 0;
  let lastResults = [];
  while (Date.now() - started <= deadlineMs) {
    attempts += 1;
    lastResults = await Promise.all(
      urls.map(async (url) => ({ url, ...(await probeUrl({ url, marker })) })),
    );
    for (const result of lastResults) {
      const origin = new URL(result.url).origin;
      if (result.ok && result.noindexFound && result.nofollowFound) {
        found.set(origin, result);
      }
    }
    if (found.size === origins.length) break;
    await sleep(intervalMs);
  }
  return {
    passed: found.size === origins.length,
    attempts,
    found: [...found.values()],
    missingOrigins: origins.filter((origin) => !found.has(new URL(origin).origin)),
    lastResults,
  };
}

export function runLocalDrill({
  date,
  suffix,
  build = true,
  stage = true,
  repositoryRoot = process.cwd(),
} = {}) {
  const created = createArtifact({ date, suffix, repositoryRoot });
  const html = readFileSync(resolve(repositoryRoot, created.path), "utf8");
  const metadata = {
    markerFound: html.includes(created.marker),
    noindexFound: /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html),
    nofollowFound: /<meta[^>]+name=["']robots["'][^>]+nofollow/i.test(html),
  };
  checkCleanWhitespace(repositoryRoot);
  if (build) {
    execFileSync("npm", ["run", "build:pages"], {
      cwd: repositoryRoot,
      stdio: "inherit",
    });
  }
  if (stage) {
    git(["add", created.path], { cwd: repositoryRoot, stdio: "ignore" });
  }
  const records = stage ? readStagedDiffRecords(repositoryRoot) : [];
  const classification = stage
    ? classifyDeliveryChange(records)
    : {
        classificationSucceeded: false,
        lane: "unclassified",
        reason: "drill_not_staged",
        paths: [],
      };
  return {
    ...created,
    metadata,
    buildRan: build,
    staged: stage,
    records,
    classification,
    passed:
      metadata.markerFound &&
      metadata.noindexFound &&
      metadata.nofollowFound &&
      (!stage ||
        (classification.classificationSucceeded &&
          classification.lane === "promotion-smoke")),
    nextSteps: [
      `git commit -m "test(promotion): add ${normalizeSuffix(suffix)} smoke artifact"`,
      `git push -u origin smoke/${normalizeSuffix(suffix)}`,
      "open a PR to dev and expect the promotion-smoke fast lane",
    ],
  };
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2).replaceAll("-", "_");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = value;
      index += 1;
    }
  }
  return options;
}

async function main(argv) {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  if (options.fetch) fetchBranches();

  if (command === "create") {
    const created = createArtifact({
      date: normalizeDate(options.date),
      suffix: normalizeSuffix(options.suffix),
    });
    process.stdout.write(`${JSON.stringify(created, null, 2)}\n`);
    return;
  }

  if (command === "drill") {
    const result = runLocalDrill({
      date: normalizeDate(options.date),
      suffix: normalizeSuffix(options.suffix),
      build: options.build !== "false" && options.no_build !== true,
      stage: options.stage !== "false" && options.no_stage !== true,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) process.exitCode = 1;
    return;
  }

  if (command === "preflight-start") {
    const result = evaluateStartPreflight({
      devRef: normalizeBranch(options.dev_ref || "origin/dev", "dev"),
      stagingRef: normalizeBranch(options.staging_ref || "origin/staging", "staging"),
      mainRef: normalizeBranch(options.main_ref || "origin/main", "main"),
    });
    process.stdout.write(summarizePreflight(result, "start"));
    if (!result.passed) process.exitCode = 1;
    return;
  }

  if (command === "preflight-production") {
    const result = evaluateProductionPreflight({
      stagingRef: normalizeBranch(options.staging_ref || "origin/staging", "staging"),
      mainRef: normalizeBranch(options.main_ref || "origin/main", "main"),
    });
    process.stdout.write(summarizePreflight(result, "production"));
    if (!result.passed) process.exitCode = 1;
    return;
  }

  if (command === "probe") {
    const artifactPath = options.artifact || artifactPathFor({
      date: normalizeDate(options.date),
      suffix: normalizeSuffix(options.suffix),
    });
    const marker = options.marker || markerFor({
      date: normalizeDate(options.date),
      suffix: normalizeSuffix(options.suffix),
    });
    const origins = options.origins
      ? options.origins.split(",").map((origin) => origin.trim()).filter(Boolean)
      : DEFAULT_PROBE_URLS;
    const result = await probeHostedArtifact({
      artifactPath,
      marker,
      origins,
      deadlineMs: Number(options.deadline_ms || 180_000),
      intervalMs: Number(options.interval_ms || 10_000),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) process.exitCode = 1;
    return;
  }

  throw new Error(
    "Usage: promotion-smoke.mjs create|drill|preflight-start|preflight-production|probe [--fetch] ...",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
