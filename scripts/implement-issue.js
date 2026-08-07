#!/usr/bin/env node
/**
 * Manager-Worker Orchestration Example
 *
 * Demonstrates the WRITER Agent → Cursor cloud agent manager-worker pattern:
 * 1. Launch a Cursor cloud agent to implement a feature from a GitHub issue
 * 2. Poll for completion
 * 3. Retrieve the result (pushed branches, PR URL)
 * 4. Trigger a Bugbot dry-run review
 * 5. Output a summary for WRITER Agent to verify against governance constraints
 *
 * Usage:
 *   CURSOR_API_KEY=crsr_xxx node implement-issue.js --issue 298 --repo theonlygeranium/vinifera
 *
 * Environment variables:
 *   CURSOR_API_KEY - Cursor API key (Bearer auth for Cloud Agents API)
 *   GITHUB_REPO_URL - Optional default repo URL (default: https://github.com/theonlygeranium/vinifera)
 */

const { CursorClient } = require("./cursor-client");
const { BugbotClient } = require("./bugbot-client");

const REPO_URL = process.env.GITHUB_REPO_URL || "https://github.com/theonlygeranium/vinifera";
const STARTING_REF = "dev"; // PRs always target dev

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--issue") parsed.issue = args[++i];
    else if (args[i] === "--repo") parsed.repo = args[++i];
    else if (args[i] === "--prompt") parsed.prompt = args[++i];
    else if (args[i] === "--model") parsed.model = args[++i];
    else if (args[i] === "--no-pr") parsed.autoCreatePR = false;
    else if (args[i] === "--dry-run-bugbot") parsed.dryRunBugbot = true;
  }
  return parsed;
}

async function main() {
  const args = parseArgs();
  const apiKey = process.env.CURSOR_API_KEY;

  if (!apiKey) {
    console.error("Error: CURSOR_API_KEY environment variable is required.");
    console.error("Generate a key from Cursor Dashboard → API Keys.");
    process.exit(1);
  }

  if (!args.issue && !args.prompt) {
    console.error("Error: --issue or --prompt is required.");
    process.exit(1);
  }

  const client = new CursorClient(apiKey);
  const repoUrl = args.repo ? `https://github.com/${args.repo}` : REPO_URL;

  // Construct the implementation prompt
  const promptText = args.prompt || `Implement the feature described in GitHub issue #${args.issue}.

Constraints:
- Target the dev branch (never staging or main)
- Follow the existing code patterns in the repository
- Include tests for any new functionality
- Run the test suite to verify your changes
- Create a PR targeting dev when done
- Do not modify governance labels or promotion workflows`;

  console.log(`\n🚀 Launching Cursor cloud agent...`);
  console.log(`   Repository: ${repoUrl}`);
  console.log(`   Branch: ${STARTING_REF}`);
  console.log(`   Auto-create PR: ${args.autoCreatePR !== false}`);
  console.log(`   Prompt: ${promptText.substring(0, 100)}...`);

  // Launch the cloud agent
  const { agent, run } = await client.createAgent({
    prompt: { text: promptText },
    model: args.model ? { id: args.model } : undefined,
    repos: [{ url: repoUrl, startingRef: STARTING_REF }],
    autoCreatePR: args.autoCreatePR !== false,
  });

  console.log(`\n✅ Agent created:`);
  console.log(`   Agent ID: ${agent.id}`);
  console.log(`   Run ID: ${run.id}`);
  console.log(`   Status: ${run.status}`);
  console.log(`   URL: ${agent.url || "(not available)"}`);

  // Wait for the run to complete
  console.log(`\n⏳ Waiting for agent to complete...`);

  const finalRun = await client.waitForRun(agent.id, run.id, {
    pollIntervalMs: 5000,
    timeoutMs: 600000, // 10 minutes
    onPoll: (r) => {
      process.stdout.write(`\r   Status: ${r.status}...`);
    },
  });

  console.log(`\n\n📊 Run completed:`);
  console.log(`   Status: ${finalRun.status}`);
  console.log(`   Duration: ${finalRun.durationMs ? (finalRun.durationMs / 1000).toFixed(1) + "s" : "N/A"}`);
  if (finalRun.git?.branches?.length) {
    console.log(`   Pushed branches: ${finalRun.git.branches.map(b => b.branch).join(", ")}`);
  }
  const prUrl = finalRun.git?.branches?.find(b => b.prUrl)?.prUrl;
  if (prUrl) {
    console.log(`   PR URL: ${prUrl}`);
  }
  if (finalRun.result) {
    console.log(`   Result: ${finalRun.result.substring(0, 200)}...`);
  }

  // If a PR was created, optionally trigger Bugbot review
  if (prUrl) {
    const bugbotKey = process.env.CURSOR_API_KEY; // Bugbot uses the same key (requires admin:* scope)
    console.log(`\n🔍 Triggering Bugbot review${args.dryRunBugbot ? " (dry-run)" : ""}...`);
    try {
      const bugbot = new BugbotClient(bugbotKey);
      const reviewResult = args.dryRunBugbot
        ? await bugbot.dryRunReview(prUrl)
        : await bugbot.triggerReview(prUrl);
      console.log(`   Review queued: ${reviewResult.message}`);
      console.log(`   Request ID: ${reviewResult.request_id}`);
    } catch (err) {
      console.log(`   ⚠️  Bugbot review failed: ${err.message}`);
      console.log(`   (This may require an Enterprise plan API key with admin:* scope)`);
    }
  }

  // Output summary for WRITER Agent verification
  console.log(`\n📋 Summary for governance verification:`);
  console.log(JSON.stringify({
    agentId: agent.id,
    runId: finalRun.id,
    status: finalRun.status,
    pushedBranches: finalRun.git?.branches?.map(b => b.branch) || [],
    prUrl: prUrl || null,
    durationMs: finalRun.durationMs || null,
  }, null, 2));

  console.log(`\n✨ Done. WRITER Agent should now verify the PR against governance constraints:`);
  console.log(`   - PR targets dev (not staging/main)`);
  console.log(`   - No governance labels removed or modified`);
  console.log(`   - brand_id scoping present in any data queries`);
  console.log(`   - CI checks pass on the PR`);
}

main().catch((err) => {
  console.error(`\n❌ Error: ${err.message}`);
  if (err.status === 409) {
    console.error("   The agent was busy. The script will retry with cancel-if-busby logic if using sendPrompt.");
  }
  if (err.status === 429) {
    console.error("   Rate limit exceeded. Wait and retry.");
  }
  process.exit(1);
});
