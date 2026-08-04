import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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

const FRONTEND_RUNTIME_PREFIXES = Object.freeze([
  "src/client/",
  "public/",
  "web/",
]);

const FRONTEND_RUNTIME_FILES = new Set([
  "app",
  "guide",
  "index.html",
  "vite.config.ts",
]);

const PROMOTION_SMOKE_PATTERN =
  /^public\/vinifera-promotion-smoke-[0-9]{4}-[0-9]{2}-[0-9]{2}(?:-[a-z0-9-]+)?\.html$/;

const STATIC_ROUTING_FILES = new Set([
  "CHANGELOG.md",
  "public/_redirects",
]);

const BACKEND_PREFIXES = Object.freeze([
  "server/",
  "supabase/",
]);

const WORKFLOW_PREFIXES = Object.freeze([
  ".github/",
  ".octopus/",
]);

const PROTECTED_ENVIRONMENT_BRANCHES = new Set(["dev", "staging", "main"]);

const CI_SCRIPT_TEST_PREFIXES = Object.freeze([
  ".github/scripts/",
  "tests/scripts/",
]);

const RELEASE_CONTROL_FASTLANE_FILES = new Set([
  ".github/pull_request_template.md",
  "CHANGELOG.md",
]);

const RELEASE_CONTROL_FASTLANE_PREFIXES = Object.freeze([
  ".github/scripts/",
  ".github/workflows/",
  "tests/scripts/",
]);

const OPERATOR_TOOLING_FILES = new Set([
  ".github/pull_request_template.md",
  "CHANGELOG.md",
  "package.json",
  "scripts/actions-promotion-status.mjs",
  "scripts/hosted-marker-probe.mjs",
  "scripts/promotion-smoke.mjs",
]);

const OPERATOR_TOOLING_PREFIXES = Object.freeze([
  ".github/scripts/",
  ".github/workflows/",
  "tests/scripts/",
]);

const TEST_PREFIXES = Object.freeze([
  "tests/",
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

export function isAuthorityHighRiskPath(path) {
  if (
    path.startsWith(".github/") ||
    path.startsWith(".octopus/") ||
    path.startsWith("supabase/migrations/") ||
    [".env.example", "package-lock.json", "wrangler.jsonc"].includes(path)
  ) {
    return true;
  }
  return /(^|[-_/])(auth|authorization|rls|billing|compliance|credential|deploy|dns|migration|production|secret|stripe)([-_/.]|$)/i.test(
    path,
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

function isCiScriptTestPath(path) {
  return CI_SCRIPT_TEST_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isReleaseControlFastlanePath(path) {
  return (
    RELEASE_CONTROL_FASTLANE_FILES.has(path) ||
    isDocumentationPath(path) ||
    RELEASE_CONTROL_FASTLANE_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

function isOperatorToolingPath(path) {
  return (
    OPERATOR_TOOLING_FILES.has(path) ||
    OPERATOR_TOOLING_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

function hasChangelogUpdate(records) {
  return records.some(
    ({ status, paths }) =>
      !status.startsWith("D") &&
      paths.length === 1 &&
      paths[0] === "CHANGELOG.md",
  );
}

function isProtectedReconcileContext({ baseRef = "", headRef = "" } = {}) {
  return (
    baseRef === "dev" &&
    headRef !== baseRef &&
    PROTECTED_ENVIRONMENT_BRANCHES.has(baseRef) &&
    PROTECTED_ENVIRONMENT_BRANCHES.has(headRef)
  );
}

export function isPreviewRelevantPath(path) {
  return (
    FRONTEND_RUNTIME_FILES.has(path) ||
    FRONTEND_RUNTIME_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

export function isPromotionSmokePath(path) {
  return PROMOTION_SMOKE_PATTERN.test(path);
}

function isPromotionSmokeCleanupPath(path) {
  return isPromotionSmokePath(path) || path === "public/_redirects";
}

function isPromotionSmokeCleanupRecord({ status, paths }) {
  if (status === "D") return paths.every(isPromotionSmokePath);
  if (status === "M" || status === "A") {
    return paths.every((path) => path === "public/_redirects");
  }
  return false;
}

export function isStaticRoutingPath(path) {
  return STATIC_ROUTING_FILES.has(path);
}

export function isBrowserRelevantPath(path) {
  return (
    isPreviewRelevantPath(path) ||
    path === "tests/e2e/smoke.spec.ts" ||
    path === "playwright.config.ts" ||
    /(^|[-_/])(a11y|accessibility|wcag)([-_/.]|$)/i.test(path)
  );
}

function deliverySurface(paths) {
  if (paths.every(isDocumentationPath)) return "docs";
  const surfaces = new Set();
  for (const path of paths) {
    if (isPreviewRelevantPath(path)) surfaces.add("frontend");
    else if (BACKEND_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      surfaces.add("backend");
    } else if (WORKFLOW_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      surfaces.add("workflow");
    } else if (TEST_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      surfaces.add("test");
    } else {
      surfaces.add("other");
    }
  }
  if (
    surfaces.has("frontend") &&
    [...surfaces].every((surface) => surface === "frontend" || surface === "test")
  ) {
    return "frontend";
  }
  if (
    surfaces.has("backend") &&
    [...surfaces].every((surface) => surface === "backend" || surface === "test")
  ) {
    return "backend";
  }
  if (
    surfaces.has("workflow") &&
    [...surfaces].every((surface) => surface === "workflow" || surface === "test")
  ) {
    return "workflow";
  }
  if (surfaces.size === 1 && surfaces.has("other")) return "unknown";
  return surfaces.size === 1 ? [...surfaces][0] : "mixed";
}

export function evaluateCandidateEvent({
  eventName,
  action = "",
  draft = false,
}) {
  if (eventName === "workflow_dispatch") {
    return { eligible: true, reason: "manual_exact_candidate" };
  }
  if (eventName !== "pull_request") {
    return { eligible: false, reason: "unsupported_event" };
  }
  if (action === "converted_to_draft" || draft === true) {
    return { eligible: false, reason: "draft_not_candidate" };
  }
  if (
    ["opened", "synchronize", "reopened", "ready_for_review"].includes(action)
  ) {
    return { eligible: true, reason: `ready_candidate_${action}` };
  }
  return { eligible: false, reason: "unsupported_pull_request_action" };
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

function readChangedRecordsFromRefs(baseRef, headRef, cwd = process.cwd()) {
  const baseSha = execFileSync("git", ["rev-parse", "--verify", `${baseRef}^{commit}`], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const headSha = execFileSync("git", ["rev-parse", "--verify", `${headRef}^{commit}`], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return {
    baseSha,
    headSha,
    records: readChangedRecords(baseSha, headSha, cwd),
  };
}

function readIndexRecords(cwd = process.cwd()) {
  return parseNameStatusZ(
    execFileSync("git", ["diff", "--cached", "--name-status", "-z", "-M", "-C"], {
      cwd,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

function readWorkingTreeRecords(cwd = process.cwd()) {
  return parseNameStatusZ(
    execFileSync("git", ["diff", "--name-status", "-z", "-M", "-C"], {
      cwd,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

function readUntrackedPaths(cwd = process.cwd()) {
  return execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).split("\n").filter(Boolean);
}

export function classifyDeliveryChange(records, context = {}) {
  if (!Array.isArray(records)) {
    return {
      classificationSucceeded: false,
      lane: "invalid",
      reason: "malformed_diff_record",
      mobileRequired: false,
      browserRequired: false,
      previewRequired: false,
      risk: "high",
      surface: "unknown",
      paths: [],
    };
  }
  if (records.length === 0) {
    return {
      classificationSucceeded: true,
      lane: "noop",
      reason: "empty_diff_noop",
      mobileRequired: false,
      browserRequired: false,
      previewRequired: false,
      risk: "low",
      surface: "none",
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
        browserRequired: false,
        previewRequired: false,
        risk: "high",
        surface: "unknown",
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
        browserRequired: false,
        previewRequired: false,
        risk: "high",
        surface: "unknown",
        paths: [],
      };
    }
    paths.push(...record.paths);
  }

  const uniquePaths = [...new Set(paths)];
  const mobileRequired = uniquePaths.some(isMobilePath);
  const browserRequired = uniquePaths.some(isBrowserRelevantPath);
  const previewRequired = uniquePaths.some(isPreviewRelevantPath);
  const surface = deliverySurface(uniquePaths);

  if (isProtectedReconcileContext(context)) {
    return {
      classificationSucceeded: true,
      lane: "protected-reconcile",
      reason: "protected_branch_reconcile",
      mobileRequired: false,
      browserRequired: false,
      previewRequired: false,
      risk: "low",
      surface,
      paths: uniquePaths,
    };
  }

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
      browserRequired: false,
      previewRequired: false,
      risk: "low",
      surface,
      paths: uniquePaths,
    };
  }

  if (
    records.every(
      ({ status, paths: recordPaths }) =>
        !status.startsWith("D") && recordPaths.every(isPromotionSmokePath),
    )
  ) {
    return {
      classificationSucceeded: true,
      lane: "promotion-smoke",
      reason: "hidden_promotion_smoke_allowlist_match",
      mobileRequired,
      browserRequired: false,
      previewRequired: true,
      risk: "low",
      surface: "frontend",
      paths: uniquePaths,
    };
  }

  if (
    uniquePaths.includes("public/_redirects") &&
    records.every(
      ({ status, paths: recordPaths }) =>
        !status.startsWith("D") && recordPaths.every(isStaticRoutingPath),
    )
  ) {
    return {
      classificationSucceeded: true,
      lane: "static-routing",
      reason: "static_routing_allowlist_match",
      mobileRequired: false,
      browserRequired: false,
      previewRequired: false,
      risk: "medium",
      surface: "frontend",
      paths: uniquePaths,
    };
  }

  const hasPromotionSmokeDeletion = records.some(({ status, paths: recordPaths }) =>
    status === "D" && recordPaths.every(isPromotionSmokePath),
  );
  if (
    uniquePaths.some(isPromotionSmokePath) &&
    uniquePaths.every(isPromotionSmokeCleanupPath) &&
    hasPromotionSmokeDeletion &&
    records.every(isPromotionSmokeCleanupRecord)
  ) {
    return {
      classificationSucceeded: true,
      lane: "promotion-smoke-cleanup",
      reason: "hidden_promotion_smoke_cleanup_allowlist_match",
      mobileRequired: false,
      browserRequired: false,
      previewRequired: false,
      risk: "low",
      surface: "frontend",
      paths: uniquePaths,
    };
  }

  if (
    records.every(
      ({ status, paths: recordPaths }) =>
        !status.startsWith("D") && recordPaths.every(isCiScriptTestPath),
    )
  ) {
    return {
      classificationSucceeded: true,
      lane: "ci-script-tested",
      reason: "ci_script_test_allowlist_match",
      mobileRequired: false,
      browserRequired: false,
      previewRequired: false,
      risk: "medium",
      surface: "workflow",
      paths: uniquePaths,
    };
  }

  if (
    (uniquePaths.includes("package.json") ||
      uniquePaths.some((path) => path.startsWith("scripts/"))) &&
    records.every(
      ({ status, paths: recordPaths }) =>
        !status.startsWith("D") &&
        recordPaths.every(isOperatorToolingPath),
    )
  ) {
    if (!hasChangelogUpdate(records)) {
      return {
        classificationSucceeded: false,
        lane: "invalid",
        reason: "operator_tooling_fastlane_missing_changelog",
        mobileRequired: false,
        browserRequired: false,
        previewRequired: false,
        risk: "high",
        surface: "workflow",
        paths: uniquePaths,
      };
    }
    return {
      classificationSucceeded: true,
      lane: "operator-tooling-tested",
      reason: "operator_tooling_fastlane_allowlist_match",
      mobileRequired: false,
      browserRequired: false,
      previewRequired: false,
      risk: "medium",
      surface: "workflow",
      paths: uniquePaths,
    };
  }

  if (
    (hasChangelogUpdate(records) ||
      uniquePaths.some((path) => path.startsWith(".github/workflows/"))) &&
    records.every(
      ({ status, paths: recordPaths }) =>
        !status.startsWith("D") &&
        recordPaths.every(isReleaseControlFastlanePath),
    )
  ) {
    if (!hasChangelogUpdate(records)) {
      return {
        classificationSucceeded: false,
        lane: "invalid",
        reason: "release_control_fastlane_missing_changelog",
        mobileRequired: false,
        browserRequired: false,
        previewRequired: false,
        risk: "high",
        surface: "workflow",
        paths: uniquePaths,
      };
    }
    return {
      classificationSucceeded: true,
      lane: "release-control-tested",
      reason: "release_control_fastlane_allowlist_match",
      mobileRequired: false,
      browserRequired: false,
      previewRequired: false,
      risk: "medium",
      surface: "workflow",
      paths: uniquePaths,
    };
  }

  const unknown = uniquePaths.filter(
    (path) =>
      !isDocumentationPath(path) &&
      !isRoutinePath(path) &&
      !isHighRiskPath(path),
  );
  if (unknown.length > 0) {
    return {
      classificationSucceeded: false,
      lane: "invalid",
      reason: "unknown_path_fail_closed",
      mobileRequired,
      browserRequired,
      previewRequired,
      risk: "high",
      surface,
      paths: uniquePaths,
    };
  }
  const highRisk =
    records.some(({ status }) => status === "D") ||
    uniquePaths.some(isHighRiskPath);
  const authorityHighRisk =
    highRisk &&
    (records.some(({ status }) => status === "D") ||
      uniquePaths.some(isAuthorityHighRiskPath));
  return {
    classificationSucceeded: true,
    lane: highRisk ? "high-risk" : "routine",
    reason: highRisk
      ? "high_risk_path"
      : "routine_allowlist_match",
    mobileRequired,
    browserRequired,
    previewRequired,
    risk: authorityHighRisk ? "high" : "medium",
    surface,
    paths: uniquePaths,
  };
}

export function selectFocusedTests(paths, lane) {
  if (lane === "noop") return [".github/scripts/delivery-policy.policy.mjs"];
  if (lane === "docs") return [".github/scripts/delivery-policy.policy.mjs"];
  if (lane === "protected-reconcile") {
    return [".github/scripts/delivery-policy.policy.mjs"];
  }
  if (lane === "ci-script-tested") {
    return [
      ".github/scripts/delivery-policy.policy.mjs",
      "tests/scripts",
    ];
  }
  if (lane === "release-control-tested") {
    return [
      ".github/scripts/delivery-policy.policy.mjs",
      ".github/scripts/operator-tooling-policy.policy.mjs",
      "tests/scripts",
    ];
  }
  if (lane === "operator-tooling-tested") {
    return [
      ".github/scripts/delivery-policy.policy.mjs",
      ".github/scripts/operator-tooling-policy.policy.mjs",
      "tests/scripts",
    ];
  }
  if (lane === "promotion-smoke") {
    return [
      ".github/scripts/delivery-policy.policy.mjs",
      "tests/scripts/landing-static.test.mjs",
    ];
  }
  if (lane === "static-routing" || lane === "promotion-smoke-cleanup") {
    return [
      ".github/scripts/delivery-policy.policy.mjs",
      "tests/scripts/landing-static.test.mjs",
    ];
  }
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
  candidateEligible = true,
  candidateResult = "success",
  classificationSucceeded,
  lane,
  classifyResult,
  docsResult,
  checksResult,
  smokeResult,
  previewDecisionResult = "success",
  browserRequired = true,
  octopusRequired = false,
  octopusBoundarySatisfied = false,
}) {
  if (candidateResult !== "success") {
    return { passed: false, reason: "candidate_policy_failed" };
  }
  if (candidateEligible !== true) {
    const terminal =
      classifyResult === "skipped" &&
      docsResult === "skipped" &&
      checksResult === "skipped" &&
      smokeResult === "skipped" &&
      previewDecisionResult === "success";
    return {
      passed: false,
      reason: terminal ? "draft_not_candidate" : "draft_result_mismatch",
    };
  }
  if (classifyResult !== "success" || classificationSucceeded !== true) {
    return { passed: false, reason: "classification_failed" };
  }
  if (previewDecisionResult !== "success") {
    return { passed: false, reason: "preview_decision_failed" };
  }
  if (octopusRequired && !octopusBoundarySatisfied) {
    return { passed: false, reason: "octopus_boundary_missing" };
  }
  if (lane === "docs") {
    const passed =
      docsResult === "success" &&
      checksResult === "skipped" &&
      smokeResult === "skipped";
    return { passed, reason: passed ? "docs_passed" : "docs_result_mismatch" };
  }
  if (lane === "noop") {
    const passed =
      docsResult === "skipped" &&
      checksResult === "skipped" &&
      smokeResult === "skipped";
    return { passed, reason: passed ? "noop_passed" : "noop_result_mismatch" };
  }
  if (lane === "promotion-smoke") {
    const passed =
      docsResult === "skipped" &&
      checksResult === "success" &&
      smokeResult === "skipped";
    return {
      passed,
      reason: passed
        ? "promotion_smoke_passed"
        : "promotion_smoke_result_mismatch",
    };
  }
  if (
    lane === "protected-reconcile" ||
    lane === "ci-script-tested" ||
    lane === "release-control-tested" ||
    lane === "operator-tooling-tested" ||
    lane === "static-routing" ||
    lane === "promotion-smoke-cleanup"
  ) {
    const passed =
      docsResult === "skipped" &&
      checksResult === "success" &&
      smokeResult === "skipped";
    return {
      passed,
      reason: passed ? `${lane}_passed` : `${lane}_result_mismatch`,
    };
  }
  if (lane === "routine" || lane === "high-risk") {
    const expectedSmokeResult = browserRequired ? "success" : "skipped";
    const passed =
      docsResult === "skipped" &&
      checksResult === "success" &&
      smokeResult === expectedSmokeResult;
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
  lane = "full",
  releaseControlResult = "skipped",
  fullResult,
  mobileRequired,
  mobileWebResult,
  androidResult,
}) {
  if (classifyResult !== "success" || classificationSucceeded !== true) {
    return { passed: false, reason: "classification_failed" };
  }
  if (lane === "noop") {
    const passed =
      fullResult === "skipped" &&
      releaseControlResult === "skipped" &&
      mobileWebResult === "skipped" &&
      androidResult === "skipped";
    return { passed, reason: passed ? "noop_passed" : "noop_result_mismatch" };
  }
  if (lane === "ci-script-tested" || lane === "release-control-tested") {
    const passed =
      releaseControlResult === "success" &&
      fullResult === "skipped" &&
      mobileWebResult === "skipped" &&
      androidResult === "skipped";
    return {
      passed,
      reason: passed
        ? `${lane.replaceAll("-", "_")}_passed`
        : `${lane.replaceAll("-", "_")}_result_mismatch`,
    };
  }
  if (lane === "operator-tooling-tested") {
    const passed =
      releaseControlResult === "success" &&
      fullResult === "skipped" &&
      mobileWebResult === "skipped" &&
      androidResult === "skipped";
    return {
      passed,
      reason: passed
        ? "operator_tooling_tested_passed"
        : "operator_tooling_tested_result_mismatch",
    };
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

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2).replaceAll("-", "_");
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function cliUsage() {
  return [
    "Usage:",
    "  delivery-policy.mjs --base <ref> --head <ref> [--base-ref <name>] [--head-ref <name>] [--format json]",
    "  delivery-policy.mjs --staged [--format json]",
    "  delivery-policy.mjs --working-tree [--format json]",
    "",
    "Notes:",
    "  Untracked files are invisible to --base/--head and --working-tree until staged.",
  ].join("\n");
}

function printClassification(result, format) {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write([
    `Lane: ${result.classification.lane}`,
    `Reason: ${result.classification.reason}`,
    `Risk: ${result.classification.risk}`,
    `Surface: ${result.classification.surface}`,
    `Paths: ${result.classification.paths.join(", ") || "(none)"}`,
    result.warnings.length > 0 ? `Warnings: ${result.warnings.join("; ")}` : "",
  ].filter(Boolean).join("\n") + "\n");
}

async function main(argv) {
  const options = parseCliArgs(argv);
  if (options.help) {
    process.stdout.write(`${cliUsage()}\n`);
    return;
  }

  const modeCount = Number(Boolean(options.staged)) +
    Number(Boolean(options.working_tree)) +
    Number(Boolean(options.base || options.head));
  if (modeCount !== 1) {
    throw new Error(`${cliUsage()}\n\nSelect exactly one diff mode.`);
  }

  let records;
  const warnings = [];
  const untrackedPaths = readUntrackedPaths();
  let baseSha = null;
  let headSha = null;
  let mode = "refs";

  if (options.staged) {
    mode = "staged";
    records = readIndexRecords();
    if (untrackedPaths.length > 0) {
      warnings.push(`untracked_files_not_in_staged_diff:${untrackedPaths.join(",")}`);
    }
  } else if (options.working_tree) {
    mode = "working-tree";
    records = readWorkingTreeRecords();
    if (untrackedPaths.length > 0) {
      warnings.push(`untracked_files_not_in_working_tree_diff:${untrackedPaths.join(",")}`);
    }
  } else {
    if (!options.base || !options.head) {
      throw new Error(`${cliUsage()}\n\n--base and --head are required together.`);
    }
    const resolved = readChangedRecordsFromRefs(options.base, options.head);
    ({ records, baseSha, headSha } = resolved);
    if (untrackedPaths.length > 0) {
      warnings.push(`untracked_files_not_in_ref_diff:${untrackedPaths.join(",")}`);
    }
  }

  if (records.length === 0 && untrackedPaths.length > 0) {
    warnings.push("empty_tracked_diff_with_untracked_files");
  }

  const classification = classifyDeliveryChange(records, {
    baseRef: options.base_ref,
    headRef: options.head_ref,
  });
  const result = {
    mode,
    base: options.base || null,
    head: options.head || null,
    baseSha,
    headSha,
    records,
    classification,
    warnings,
  };
  printClassification(result, options.format);
  if (!classification.classificationSucceeded) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
