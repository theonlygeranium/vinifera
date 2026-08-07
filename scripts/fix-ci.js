#!/usr/bin/env node
/**
 * CI Auto-Fix Orchestration Example
 *
 * Demonstrates WRITER Agent using the Cursor Cloud Agents API to fix CI failures:
 * 1. Detect a failing CI check on a PR (via GitHub API)
 * 2. Fetch the failing job logs
 * 3. Launch a Cursor cloud agent with the failure context to fix it
 * 4. The agent pushes the fix to the PR branch
 * 5. Verify CI passes on the updated PR
 *
 * This replaces the automatic CI auto-fix that's only available on Cursor Teams plans.
 * On Pro+, WRITER Agent can orchestrate this flow programmatically.
 *
 * Usage:
 *   CURSOR_API_KEY=crsr_xxx node fix-ci.js --pr 306 --repo theonlygeranium/vinifera
 */

const { CursorClient } = require("./cursor-client");

const REPO_URL = process.env.GITHUB_REPO_URL || "https://github.com/theonlygeranium/vinifera";

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pr") parsed.pr = args[++i];
    else if (args[i] === "--repo") parsed.repo = args[++i];
    else if (args[i] === "--log") parsed.log = args[++i];
    else if (args[i] === "--model") parsed.model = args[++i];
  }
  return parsed;
}

async function main() {
  const args = parseArgs();
  const apiKey = process.env.CURSOR_API_KEY;

  if (!apiKey) {
    console.error("Error: CURSOR_API_KEY environment variable is required.");
    process.exit(1);
  }

  if (!args.pr) {
    console.error("Error: --pr (PR number) is required.");
    process.exit(1);
  }

  const client = new CursorClient(apiKey);
  const repoUrl = args.repo ? `https://github.com/${args.repo}` : REPO_URL;
  const prUrl = `${repoUrl}/pull/${args.pr}`;

  // In a real workflow, WRITER Agent would fetch the CI failure logs via the GitHub connector.
  // Here we accept them as an argument or use a placeholder.
  const failureLog = args.log || "CI failure details would be fetched via the GitHub connector (GitHub Actions API).";

  const promptText = `Fix the CI failure on PR #${args.pr}.

The CI check is failing with the following error:

${failureLog}

Instructions:
- Work on the PR's existing branch (use workOnCurrentBranch: true)
- Fix only the CI failure — do not make unrelated changes
- Run the failing test or check locally to verify the fix
- Push the fix to the existing PR branch
- Do not create a new PR
- Do not modify governance labels or promotion workflows
- If the failure is a runner cancellation (not a source bug), document that and do not make code changes`;

  console.log(`\n🔧 Launching Cursor cloud agent to fix CI on PR #${args.pr}...`);
  console.log(`   Repository: ${repoUrl}`);
  console.log(`   PR URL: ${prUrl}`);

  // Launch the agent to work on the existing PR branch
  const { agent, run } = await client.createAgent({
    prompt: { text: promptText },
    model: args.model ? { id: args.model } : undefined,
    repos: [{ url: repoUrl, prUrl }],
    workOnCurrentBranch: true, // Work on the PR's existing branch
    autoCreatePR: false, // Don't create a new PR — push to existing branch
  });

  console.log(`\n✅ Agent created: ${agent.id}`);
  console.log(`   Run ID: ${run.id}`);

  // Wait for the fix
  console.log(`\n⏳ Waiting for fix...`);

  const finalRun = await client.waitForRun(agent.id, run.id, {
    pollIntervalMs: 5000,
    timeoutMs: 600000,
    onPoll: (r) => {
      process.stdout.write(`\r   Status: ${r.status}...`);
    },
  });

  console.log(`\n\n📊 Fix completed:`);
  console.log(`   Status: ${finalRun.status}`);
  if (finalRun.pushedBranches?.length) {
    console.log(`   Pushed to: ${finalRun.pushedBranches.join(", ")}`);
  }
  if (finalRun.result) {
    console.log(`   Result: ${finalRun.result.substring(0, 300)}`);
  }

  // WRITER Agent should now verify CI passes on the updated PR via the GitHub connector
  console.log(`\n📋 Next steps for WRITER Agent:`);
  console.log(`   1. Check CI status on PR #${args.pr} via GitHub connector`);
  console.log(`   2. If CI passes, verify governance constraints (labels, branch targeting)`);
  console.log(`   3. If CI still fails, analyze the new failure and decide whether to retry or surface for human review`);
  console.log(`   4. Post a summary to the PR or EL Wiki as appropriate`);
}

main().catch((err) => {
  console.error(`\n❌ Error: ${err.message}`);
  process.exit(1);
});
