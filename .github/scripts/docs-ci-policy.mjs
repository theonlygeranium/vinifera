import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

export const DOCS_ALLOWLIST = Object.freeze([
  "AGENTS.md",
  "CHANGELOG.md",
  "CONTINUITY_BRIEF.md",
  "README.md",
  "REVERT.md",
  "docs/**/*.md",
]);

const ROOT_MARKDOWN = new Set([
  "AGENTS.md",
  "CHANGELOG.md",
  "CONTINUITY_BRIEF.md",
  "README.md",
  "REVERT.md",
]);

function isAllowedDocumentationPath(path) {
  return ROOT_MARKDOWN.has(path) || (
    path.startsWith("docs/") &&
    path.endsWith(".md") &&
    !path.split("/").includes("..")
  );
}

export function classifyChangeSet({ eventName, records }) {
  if (eventName !== "pull_request") {
    return {
      classificationSucceeded: true,
      lane: "full",
      reason: `${eventName || "unknown"}_event`,
    };
  }

  if (!Array.isArray(records) || records.length === 0) {
    return {
      classificationSucceeded: false,
      lane: "full",
      reason: "empty_or_missing_diff",
    };
  }

  for (const record of records) {
    if (!record || typeof record.status !== "string" || !Array.isArray(record.paths)) {
      return {
        classificationSucceeded: false,
        lane: "full",
        reason: "malformed_diff_record",
      };
    }

    if (record.status.startsWith("C")) {
      return {
        classificationSucceeded: true,
        lane: "full",
        reason: "copy_detected",
      };
    }

    if (record.status === "D") {
      return {
        classificationSucceeded: true,
        lane: "full",
        reason: "deletion_detected",
      };
    }

    const supported =
      ((record.status === "A" || record.status === "M") && record.paths.length === 1) ||
      (/^R\d{1,3}$/.test(record.status) && record.paths.length === 2);
    if (!supported) {
      return {
        classificationSucceeded: true,
        lane: "full",
        reason: `unsupported_status_${record.status || "missing"}`,
      };
    }

    if (record.paths.some((path) => !isAllowedDocumentationPath(path))) {
      return {
        classificationSucceeded: true,
        lane: "full",
        reason: "non_documentation_path",
      };
    }
  }

  return {
    classificationSucceeded: true,
    lane: "docs",
    reason: "explicit_allowlist_match",
  };
}

export function parseNameStatusZ(buffer) {
  const fields = buffer.toString("utf8").split("\0");
  if (fields.at(-1) === "") fields.pop();
  const records = [];

  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status) throw new Error("Diff contains an empty status field.");
    const pathCount = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    if (index + pathCount > fields.length) {
      throw new Error(`Diff record ${status} is missing a path.`);
    }
    records.push({ status, paths: fields.slice(index, index + pathCount) });
    index += pathCount;
  }

  return records;
}

export function readGitDiff(baseSha, headSha, cwd = process.cwd()) {
  const output = execFileSync(
    "git",
    ["diff", "--name-status", "-z", "-M", "-C", baseSha, headSha],
    { cwd, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] },
  );
  return parseNameStatusZ(output);
}

export function evaluateRequiredGate({
  classificationSucceeded,
  lane,
  docsResult,
  fullResult,
  mobileResult,
}) {
  if (classificationSucceeded !== true) {
    return { passed: false, reason: "classification_failed" };
  }

  if (lane === "docs") {
    const passed =
      docsResult === "success" &&
      fullResult === "skipped" &&
      mobileResult === "skipped";
    return {
      passed,
      reason: passed ? "docs_lane_passed" : "docs_lane_result_mismatch",
    };
  }

  if (lane === "full") {
    const passed =
      docsResult === "skipped" &&
      fullResult === "success" &&
      mobileResult === "success";
    return {
      passed,
      reason: passed ? "full_lane_passed" : "full_lane_result_mismatch",
    };
  }

  return { passed: false, reason: "unknown_lane" };
}

function assertCommit(sha, label, cwd) {
  if (!/^[0-9a-f]{40}$/i.test(sha || "")) {
    throw new Error(`${label} must be an exact 40-character commit SHA.`);
  }
  execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
    cwd,
    stdio: "ignore",
  });
}

function changedMarkdownFiles(records) {
  return [...new Set(
    records.flatMap(({ status, paths }) => {
      const candidates = status.startsWith("R") ? [paths[1]] : paths;
      return candidates.filter((path) => isAllowedDocumentationPath(path));
    }),
  )];
}

function validateMarkdownLinks(repoRoot, markdownFiles) {
  const linkPattern = /!?\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  const definitionPattern = /^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm;
  const failures = [];

  for (const file of markdownFiles) {
    const absoluteFile = resolve(repoRoot, file);
    if (!existsSync(absoluteFile) || !statSync(absoluteFile).isFile()) {
      failures.push(`${file}: changed Markdown file is missing`);
      continue;
    }

    const source = readFileSync(absoluteFile, "utf8");
    const rawTargets = [
      ...[...source.matchAll(linkPattern)].map((match) => match[1]),
      ...[...source.matchAll(definitionPattern)]
        .filter((match) => !match[1].startsWith("^"))
        .map((match) => match[2] || match[3]),
    ];
    for (const target of rawTargets) {
      const rawTarget = target.replace(/^<|>$/g, "");
      if (
        rawTarget.startsWith("#") ||
        rawTarget.startsWith("/") ||
        /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)
      ) {
        continue;
      }

      let decodedTarget;
      try {
        decodedTarget = decodeURIComponent(rawTarget.split("#", 1)[0].split("?", 1)[0]);
      } catch {
        failures.push(`${file}: link target is not valid URI text: ${rawTarget}`);
        continue;
      }
      if (!decodedTarget) continue;

      const resolvedTarget = resolve(dirname(absoluteFile), decodedTarget);
      const relativeTarget = relative(repoRoot, resolvedTarget);
      if (
        relativeTarget === ".." ||
        relativeTarget.startsWith(`..${sep}`) ||
        !existsSync(resolvedTarget)
      ) {
        failures.push(`${file}: missing local link target ${rawTarget}`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Local Markdown link validation failed:\n${failures.join("\n")}`);
  }
}

function parseVersion(value, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) throw new Error(`${label} must be an exact semantic version.`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function documentedNodeVersions(source) {
  return [...source.matchAll(
    /\bNode(?:\.js)?(?:\s+(?:version|runtime))?[^0-9\n]{0,20}v?(\d+(?:\.\d+){0,2})/gi,
  )].map((match) => match[1]);
}

function validateNodeDocumentationContract(repoRoot) {
  const nvm = readFileSync(resolve(repoRoot, ".nvmrc"), "utf8").trim();
  const pinnedVersion = parseVersion(nvm, ".nvmrc");

  const packageJson = JSON.parse(
    readFileSync(resolve(repoRoot, "package.json"), "utf8"),
  );
  const engineMatch = /^>=(\d+\.\d+\.\d+)$/.exec(packageJson.engines?.node || "");
  if (!engineMatch) {
    throw new Error("package.json engines.node must be a >= semantic-version floor.");
  }
  const minimumVersion = parseVersion(engineMatch[1], "package.json engines.node");
  if (compareVersions(pinnedVersion, minimumVersion) < 0) {
    throw new Error(".nvmrc must satisfy package.json engines.node.");
  }

  const agents = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");
  const agentVersions = documentedNodeVersions(agents);
  if (
    !agents.includes(".nvmrc") ||
    agentVersions.some((version) => Number(version.split(".")[0]) !== pinnedVersion[0])
  ) {
    throw new Error("AGENTS.md must reference .nvmrc and must not prescribe a conflicting Node major.");
  }

  const readme = readFileSync(resolve(repoRoot, "README.md"), "utf8");
  const readmeVersions = documentedNodeVersions(readme);
  const resolvesPin =
    readme.includes(".nvmrc") ||
    readmeVersions.some((version) => version === nvm);
  if (
    !resolvesPin ||
    readmeVersions.some((version) => Number(version.split(".")[0]) !== pinnedVersion[0])
  ) {
    throw new Error(`README.md must resolve to the .nvmrc Node ${nvm} pin without conflicting majors.`);
  }
}

export function validateDocumentationChange({
  baseSha,
  headSha,
  repoRoot = process.cwd(),
}) {
  assertCommit(baseSha, "Base SHA", repoRoot);
  assertCommit(headSha, "Head SHA", repoRoot);

  const records = readGitDiff(baseSha, headSha, repoRoot);
  const classification = classifyChangeSet({
    eventName: "pull_request",
    records,
  });
  if (!classification.classificationSucceeded || classification.lane !== "docs") {
    throw new Error(
      `Documentation lane revalidation selected ${classification.lane}: ${classification.reason}.`,
    );
  }

  const changelogChanged = records.some(
    ({ status, paths }) =>
      (status === "A" || status === "M") &&
      paths.length === 1 &&
      paths[0] === "CHANGELOG.md",
  );
  if (!changelogChanged) {
    throw new Error("Documentation-only changes must update CHANGELOG.md.");
  }

  const markdownFiles = changedMarkdownFiles(records);
  validateMarkdownLinks(repoRoot, markdownFiles);
  validateNodeDocumentationContract(repoRoot);

  return {
    classification,
    records,
    markdownFiles,
    checks: [
      "exact base/head commits",
      "documentation allowlist",
      "CHANGELOG.md changed",
      "local Markdown links",
      "Node documentation contract",
    ],
  };
}

export function scanDiffForSecrets({
  baseSha,
  headSha,
  repoRoot = process.cwd(),
}) {
  assertCommit(baseSha, "Base SHA", repoRoot);
  assertCommit(headSha, "Head SHA", repoRoot);
  const patch = execFileSync(
    "git",
    ["diff", "--unified=0", "--no-ext-diff", baseSha, headSha],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  const addedLines = patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .join("\n");
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[opusr]_[A-Za-z0-9_]{20,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
    /\brk_live_[A-Za-z0-9]{16,}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  ];
  const matched = patterns.find((pattern) => pattern.test(addedLines));
  if (matched) throw new Error(`Potential credential matched ${matched}.`);
}
