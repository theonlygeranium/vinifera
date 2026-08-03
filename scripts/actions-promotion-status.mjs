#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import process from "node:process";

const PROMOTION_WORKFLOWS = new Set([
  "Development deployment candidate",
  "Development fast validation",
  "Direct Push Guard",
  "Full promotion validation",
  "Octopus Deploy — Main to Development",
  "Octopus PR Quality Gates",
  "Trusted development auto-merge",
  "Trusted frontend preview publication",
]);

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function usage() {
  return [
    "Usage: actions-promotion-status.mjs [--sha <sha-prefix>] [--branch <branch>] [--limit 30] [--json] [--strict-cancelled]",
    "",
    "Summarizes Vinifera promotion-relevant GitHub Actions runs and fails on hard failures.",
  ].join("\n");
}

if (hasFlag("help")) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}

const repo = arg("repo", "theonlygeranium/vinifera");
const limit = arg("limit", "30");
const sha = arg("sha");
const branch = arg("branch");
const strictCancelled = hasFlag("strict-cancelled");
const json = hasFlag("json");
const args = [
  "run",
  "list",
  "--repo",
  repo,
  "--limit",
  limit,
  "--json",
  "databaseId,name,status,conclusion,createdAt,headBranch,headSha,url",
];
if (branch) args.splice(4, 0, "--branch", branch);

const runs = JSON.parse(execFileSync("gh", args, { encoding: "utf8" }));
const rows = runs
  .filter((run) => PROMOTION_WORKFLOWS.has(run.name))
  .filter((run) => !sha || run.headSha?.startsWith(sha))
  .map((run) => ({
    id: run.databaseId,
    name: run.name,
    branch: run.headBranch,
    sha: run.headSha?.slice(0, 7),
    status: run.status,
    conclusion: run.conclusion || "",
    createdAt: run.createdAt,
    url: run.url,
  }));

if (json) {
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
} else {
  console.table(rows);
}

const hardFailures = new Set(["failure", "timed_out", "action_required"]);
const failures = rows.filter(
  (run) => hardFailures.has(run.conclusion) ||
    (strictCancelled && run.conclusion === "cancelled"),
);
const cancelled = rows.filter((run) => run.conclusion === "cancelled");
if (cancelled.length > 0 && !strictCancelled) {
  console.error(`Cancelled runs, usually superseded automation: ${cancelled.map((run) => run.id).join(", ")}`);
}
if (failures.length > 0) {
  console.error(`Problem runs: ${failures.map((run) => run.id).join(", ")}`);
  process.exit(1);
}
