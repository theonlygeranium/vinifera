#!/usr/bin/env node
/**
 * Parallel Agent Fan-Out Example
 *
 * Demonstrates WRITER Agent launching multiple Cursor cloud agents in parallel
 * for independent tasks. Each agent runs in its own isolated VM.
 *
 * Usage:
 *   CURSOR_API_KEY=crsr_xxx node parallel-tasks.js tasks.json
 *
 * tasks.json format:
 * [
 *   { "name": "fix-typo", "prompt": "Fix the typo in the README...", "branch": "fix/readme-typo" },
 *   { "name": "add-tests", "prompt": "Add tests for the auth middleware...", "branch": "test/auth-middleware" }
 * ]
 */

const { CursorClient } = require("./cursor-client");
const fs = require("fs");

const REPO_URL = process.env.GITHUB_REPO_URL || "https://github.com/theonlygeranium/vinifera";

async function main() {
  const tasksFile = process.argv[2];
  const apiKey = process.env.CURSOR_API_KEY;

  if (!apiKey || !tasksFile) {
    console.error("Usage: CURSOR_API_KEY=crsr_xxx node parallel-tasks.js <tasks.json>");
    process.exit(1);
  }

  const tasks = JSON.parse(fs.readFileSync(tasksFile, "utf8"));
  const client = new CursorClient(apiKey);

  console.log(`\n🚀 Launching ${tasks.length} agents in parallel...\n`);

  // Launch all agents in parallel
  const launchPromises = tasks.map(async (task) => {
    try {
      const { agent, run } = await client.createAgent({
        prompt: { text: task.prompt },
        name: task.name,
        repos: [{ url: REPO_URL, startingRef: task.branch || "dev" }],
        autoCreatePR: true,
      });
      console.log(`  ✅ ${task.name}: agent ${agent.id}, run ${run.id}`);
      return { task, agent, run, error: null };
    } catch (err) {
      console.error(`  ❌ ${task.name}: ${err.message}`);
      return { task, agent: null, run: null, error: err };
    }
  });

  const launched = await Promise.all(launchPromises);
  const successful = launched.filter((l) => !l.error);

  console.log(`\n⏳ Waiting for ${successful.length} agents to complete...\n`);

  // Wait for all runs to complete in parallel
  const waitPromises = successful.map(async ({ task, agent, run }) => {
    try {
      const finalRun = await client.waitForRun(agent.id, run.id, {
        pollIntervalMs: 10000,
        timeoutMs: 900000, // 15 minutes
      });
      return { task, agent, run: finalRun, error: null };
    } catch (err) {
      return { task, agent, run: null, error: err };
    }
  });

  const results = await Promise.all(waitPromises);

  // Summarize
  console.log(`\n📊 Results:\n`);
  for (const { task, agent, run, error } of results) {
    if (error) {
      console.log(`  ❌ ${task.name}: ERROR — ${error.message}`);
    } else {
      console.log(`  ${run.status === "COMPLETED" || run.status === "completed" ? "✅" : "⚠️"} ${task.name}: ${run.status}`);
      if (run.prUrl) console.log(`     PR: ${run.prUrl}`);
    }
  }

  // Output JSON summary
  const summary = results.map(({ task, agent, run, error }) => ({
    taskName: task.name,
    agentId: agent?.id,
    runId: run?.id,
    status: run?.status || "ERROR",
    prUrl: run?.prUrl || null,
    pushedBranches: run?.pushedBranches || [],
    error: error?.message,
  }));

  console.log(`\n📋 Summary:`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(`\n❌ Error: ${err.message}`);
  process.exit(1);
});
