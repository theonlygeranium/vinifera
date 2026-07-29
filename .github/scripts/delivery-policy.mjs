import { execFileSync } from "node:child_process";

const ROOT_DOCUMENTATION = new Set([
  "AGENTS.md",
  "CHANGELOG.md",
  "CONTINUITY_BRIEF.md",
  "README.md",
  "REVERT.md",
]);

const ROUTINE_PREFIXES = Object.freeze([
  "src/client/",
  "tests/client/",
  "tests/e2e/",
  "tests/unit/",
  "public/",
  "web/",
]);

const ROUTINE_FILES = new Set([
  "app",
  "guide",
  "index.html",
  "playwright.config.ts",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
]);

const HIGH_RISK_PREFIXES = Object.freeze([
  ".github/",
  ".octopus/",
  "android/",
  "ios/",
  "mobile/",
  "server/",
  "supabase/",
  "scripts/",
  "tests/scripts/",
  "tests/server/",
]);

const HIGH_RISK_FILES = new Set([
  ".env.example",
  ".nvmrc",
  "capacitor.config.json",
  "package-lock.json",
  "package.json",
  "tests/e2e/smoke.spec.ts",
  "wrangler.jsonc",
]);

const MOBILE_PREFIXES = Object.freeze([
  "android/",
  "ios/",
  "mobile/",
  "src/client/mobile/",
  "tests/client/phase5-mobile",
  "tests/client/phase5-native",
  "tests/client/phase5-offline",
]);

const MOBILE_FILES = new Set([
  "capacitor.config.json",
  "package-lock.json",
  "package.json",
  "scripts/prepare-capacitor.mjs",
]);

function safePath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.includes("\0") &&
    !path.includes("\\") &&
    !path.split("/").includes("..") &&
    !path.startsWith("/")
  );
}

export function isDocumentationPath(path) {
  return (
    ROOT_DOCUMENTATION.has(path) ||
    (path.startsWith("docs/") && path.endsWith(".md") && safePath(path))
  );
}

export function isHighRiskPath(path) {
  if (HIGH_RISK_FILES.has(path)) return true;
  if (HIGH_RISK_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return (
    /(^|[-_/])(auth|authorization|billing|credential|deploy|production|stripe|tenant)([-_/.]|$)/i.test(
      path,
    ) || /(^|\/)brand([-_/.]|$)/i.test(path)
  );
}

export function isMobilePath(path) {
  return (
    MOBILE_FILES.has(path) ||
    MOBILE_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

function isRoutinePath(path) {
  return (
    ROUTINE_FILES.has(path) ||
    ROUTINE_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

export function parseNameStatusZ(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("The name-status diff must be a Buffer.");
  }
  const fields = buffer.toString("utf8").split("\0");
  if (fields.at(-1) === "") fields.pop();
  const records = [];

  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status) throw new Error("Diff contains an empty status.");
    const pathCount = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    if (index + pathCount > fields.length) {
      throw new Error(`Diff record ${status} is missing a path.`);
    }
    records.push({ status, paths: fields.slice(index, index + pathCount) });
    index += pathCount;
  }
  return records;
}

export function readChangedRecords(baseSha, headSha, cwd = process.cwd()) {
  for (const [label, sha] of [
    ["base", baseSha],
    ["head", headSha],
  ]) {
    if (!/^[0-9a-f]{40}$/i.test(sha || "")) {
      throw new Error(`${label} must be an exact 40-character commit SHA.`);
    }
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
      cwd,
      stdio: "ignore",
    });
  }
  return parseNameStatusZ(
    execFileSync(
      "git",
      ["diff", "--name-status", "-z", "-M", "-C", baseSha, headSha],
      { cwd, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
}

export function classifyDeliveryChange(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return {
      classificationSucceeded: false,
      lane: "invalid",
      reason: "empty_or_missing_diff",
      mobileRequired: false,
      paths: [],
    };
  }

  const paths = [];
  for (const record of records) {
    if (
      !record ||
      typeof record.status !== "string" ||
      !Array.isArray(record.paths)
    ) {
      return {
        classificationSucceeded: false,
        lane: "invalid",
        reason: "malformed_diff_record",
        mobileRequired: false,
        paths: [],
      };
    }
    const supported =
      ((record.status === "A" ||
        record.status === "M" ||
        record.status === "D") &&
        record.paths.length === 1) ||
      (/^R\d{1,3}$/.test(record.status) && record.paths.length === 2);
    if (!supported || record.paths.some((path) => !safePath(path))) {
      return {
        classificationSucceeded: false,
        lane: "invalid",
        reason: `unsupported_or_unsafe_diff_${record.status || "missing"}`,
        mobileRequired: false,
        paths: [],
      };
    }
    paths.push(...record.paths);
  }

  const uniquePaths = [...new Set(paths)];
  const mobileRequired = uniquePaths.some(isMobilePath);
  if (
    records.every(
      ({ status, paths: recordPaths }) =>
        !status.startsWith("D") && recordPaths.every(isDocumentationPath),
    )
  ) {
    return {
      classificationSucceeded: true,
      lane: "docs",
      reason: "documentation_allowlist_match",
      mobileRequired,
      paths: uniquePaths,
    };
  }

  const unknown = uniquePaths.filter(
    (path) =>
      !isDocumentationPath(path) &&
      !isRoutinePath(path) &&
      !isHighRiskPath(path),
  );
  const highRisk =
    records.some(({ status }) => status === "D") ||
    uniquePaths.some(isHighRiskPath) ||
    unknown.length > 0;
  return {
    classificationSucceeded: true,
    lane: highRisk ? "high-risk" : "routine",
    reason: highRisk
      ? unknown.length > 0
        ? "unknown_path_fail_closed"
        : "high_risk_path"
      : "routine_allowlist_match",
    mobileRequired,
    paths: uniquePaths,
  };
}

export function selectFocusedTests(paths, lane) {
  if (lane === "docs") return [".github/scripts/delivery-policy.policy.mjs"];
  const selected = new Set([".github/scripts/delivery-policy.policy.mjs"]);
  for (const path of paths || []) {
    if (path.startsWith("src/client/") || path.startsWith("tests/client/")) {
      selected.add("tests/client");
    }
    if (path.startsWith("server/") || path.startsWith("tests/server/")) {
      selected.add("tests/server");
      selected.add("tests/unit");
    }
    if (path.startsWith("scripts/") || path.startsWith("tests/scripts/")) {
      selected.add("tests/scripts");
    }
    if (isMobilePath(path)) {
      selected.add("tests/client/phase5-mobile-policy.test.ts");
      selected.add("tests/client/phase5-native-session.test.ts");
    }
    if (
      path === "index.html" ||
      path === "app" ||
      path === "guide" ||
      path.startsWith("public/")
    ) {
      selected.add("tests/scripts/landing-static.test.mjs");
    }
  }
  if (lane === "high-risk" && selected.size === 1) {
    selected.add("tests/server");
    selected.add("tests/scripts");
  }
  return [...selected];
}

export function evaluateFastAggregate({
  classificationSucceeded,
  lane,
  classifyResult,
  docsResult,
  checksResult,
  smokeResult,
}) {
  if (classifyResult !== "success" || classificationSucceeded !== true) {
    return { passed: false, reason: "classification_failed" };
  }
  if (lane === "docs") {
    const passed =
      docsResult === "success" &&
      checksResult === "skipped" &&
      smokeResult === "skipped";
    return { passed, reason: passed ? "docs_passed" : "docs_result_mismatch" };
  }
  if (lane === "routine" || lane === "high-risk") {
    const passed =
      docsResult === "skipped" &&
      checksResult === "success" &&
      smokeResult === "success";
    return {
      passed,
      reason: passed ? `${lane}_passed` : `${lane}_result_mismatch`,
    };
  }
  return { passed: false, reason: "unknown_lane" };
}

export function evaluateFullAggregate({
  classificationSucceeded,
  classifyResult,
  fullResult,
  mobileRequired,
  mobileWebResult,
  androidResult,
}) {
  if (classifyResult !== "success" || classificationSucceeded !== true) {
    return { passed: false, reason: "classification_failed" };
  }
  if (fullResult !== "success") {
    return { passed: false, reason: "full_validation_not_successful" };
  }
  const passed = mobileRequired
    ? androidResult === "success" && mobileWebResult === "skipped"
    : androidResult === "skipped" && mobileWebResult === "success";
  return {
    passed,
    reason: passed ? "full_lane_passed" : "mobile_lane_result_mismatch",
  };
}
