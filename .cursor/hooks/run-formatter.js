#!/usr/bin/env node
/**
 * Hook: afterFileEdit
 * Purpose: Run formatters and lint checks after the agent edits a file.
 *
 * Input:  { file_path, edits: [{ old_string, new_string }] }
 * Output: { agent_message } (informational; does not block)
 *
 * This hook runs the project's formatter on the edited file.
 * It is non-blocking — it reports formatting results to the agent
 * but does not deny the edit. The agent can use the feedback to
 * fix formatting issues in a subsequent turn.
 */

const { execSync } = require("child_process");
const path = require("path");

function getFormatter(filePath) {
  const ext = path.extname(filePath);
  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "npx prettier --write";
    case ".json":
    case ".jsonc":
      return "npx prettier --write";
    case ".css":
    case ".scss":
      return "npx prettier --write";
    case ".md":
    case ".mdc":
      return null; // Don't auto-format markdown
    case ".sql":
      return null; // Don't auto-format SQL migrations
    default:
      return null;
  }
}

function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch {
      console.log(JSON.stringify({ agent_message: "Formatter hook could not parse input; skipping." }));
      process.exit(0);
    }

    const filePath = parsed.file_path || "";
    const formatter = getFormatter(filePath);

    if (!formatter) {
      console.log(JSON.stringify({ agent_message: `No formatter configured for ${path.extname(filePath)} files; skipping.` }));
      process.exit(0);
    }

    try {
      execSync(`${formatter} "${filePath}"`, {
        timeout: 25000,
        stdio: "pipe",
        encoding: "utf8",
      });
      console.log(JSON.stringify({
        agent_message: `Formatted ${filePath} with ${formatter.split(" ")[1] || formatter}.`,
      }));
    } catch (err) {
      console.log(JSON.stringify({
        agent_message: `Formatter ran but reported issues on ${filePath}. Run the formatter manually to check: ${formatter} "${filePath}"`,
      }));
    }
    process.exit(0);
  });
}

main();
