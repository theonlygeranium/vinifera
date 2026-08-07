#!/usr/bin/env node
/**
 * Hook: beforeShellExecution
 * Matcher: "git push"
 * Purpose: Block direct pushes to protected branches (staging, main).
 *
 * Cursor hooks communicate over stdio using JSON.
 * Input:  { command, cwd, sandbox }
 * Output: { permission: "allow" | "deny", user_message, agent_message }
 *
 * Exit code 2 also blocks the action (fail-closed).
 */

const PROTECTED_BRANCHES = ["staging", "main", "production", "prod"];

function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch {
      // Fail-closed: if we can't parse the input, deny the push
      console.log(JSON.stringify({
        permission: "deny",
        user_message: "Blocked: could not parse hook input. Push denied (fail-closed).",
        agent_message: "The git push was blocked because the security hook could not parse the command input. This is a fail-closed behavior to prevent accidental pushes to protected branches.",
      }));
      process.exit(2);
    }

    const command = parsed.command || "";

    // Check if this push targets a protected branch
    // Matches: git push origin staging, git push origin main, git push staging, etc.
    // Also catches: git push --force, git push -f to protected branches
    for (const branch of PROTECTED_BRANCHES) {
      const patterns = [
        new RegExp(`git\\s+push\\s+\\S+\\s+${branch}\\b`),
        new RegExp(`git\\s+push\\s+\\S+\\s+\\S+:${branch}\\b`),
        new RegExp(`git\\s+push\\s+${branch}\\b`),
      ];
      if (patterns.some((p) => p.test(command))) {
        console.log(JSON.stringify({
          permission: "deny",
          user_message: `Blocked: direct push to protected branch "${branch}" is not allowed. PRs must target the dev branch.`,
          agent_message: `The git push to "${branch}" was blocked by the agent-boundaries hook. Protected branches (staging, main, production) cannot receive direct pushes. Create a PR targeting the dev branch instead. Promotion to staging/main is a human-initiated action via the Vinifera Promotion Gate.`,
        }));
        process.exit(2);
      }
    }

    // Allow the push
    console.log(JSON.stringify({ permission: "allow" }));
    process.exit(0);
  });
}

main();
