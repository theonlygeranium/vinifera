#!/usr/bin/env node
/**
 * Hook: beforeMCPExecution
 * Purpose: Audit and gate MCP tool calls. Log all MCP calls for observability.
 *
 * Input:  { tool_name, tool_input, url?, command? }
 * Output: { permission: "allow" | "deny", agent_message }
 *
 * This hook logs every MCP tool call to a local audit log and blocks
 * calls that appear to be write operations on sensitive resources.
 * Set failClosed: true in hooks.json for this hook.
 */

const fs = require("fs");
const path = require("path");

const AUDIT_LOG = path.join(process.cwd(), ".cursor", "hooks", "mcp-audit.log");

// MCP tools that are allowed (read-only operations)
const ALLOWED_TOOL_PATTERNS = [
  /^github.*get/i,
  /^github.*list/i,
  /^github.*search/i,
  /^github.*view/i,
  /^supabase.*schema/i,
  /^supabase.*introspect/i,
  /^supabase.*list/i,
  /^context7.*/i,
  /^cursor.*list/i,
  /^cursor.*get/i,
];

// MCP tools that should be blocked (write operations on sensitive resources)
const BLOCKED_TOOL_PATTERNS = [
  /^supabase.*delete/i,
  /^supabase.*drop/i,
  /^supabase.*truncate/i,
  /^supabase.*service_role/i,
  /^github.*merge/i,
  /^github.*delete/i,
  /^github.*admin/i,
];

function logAudit(entry) {
  try {
    const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + "\n";
    fs.appendFileSync(AUDIT_LOG, line, { encoding: "utf8" });
  } catch {
    // Non-blocking: audit log failure should not deny the call
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
      // Fail-closed
      console.log(JSON.stringify({
        permission: "deny",
        agent_message: "MCP call blocked: hook could not parse input (fail-closed).",
      }));
      process.exit(2);
    }

    const toolName = parsed.tool_name || "unknown";
    const toolInput = parsed.tool_input || {};

    // Log the call
    logAudit({
      tool_name: toolName,
      tool_input: typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput),
      url: parsed.url || null,
      command: parsed.command || null,
    });

    // Check blocked patterns
    for (const pattern of BLOCKED_TOOL_PATTERNS) {
      if (pattern.test(toolName)) {
        console.log(JSON.stringify({
          permission: "deny",
          agent_message: `MCP tool "${toolName}" was blocked. This tool matches a blocked pattern for sensitive write operations. If this is a legitimate operation, route it through WRITER Agent's connector gateway instead of the Cursor MCP configuration.`,
        }));
        process.exit(2);
      }
    }

    // Check if the tool is explicitly allowed
    const isAllowed = ALLOWED_TOOL_PATTERNS.some((p) => p.test(toolName));

    if (!isAllowed) {
      // Unknown tool — allow but log a warning
      console.log(JSON.stringify({
        permission: "allow",
        agent_message: `MCP tool "${toolName}" is not in the allowlist but does not match a blocked pattern. Proceeding with audit logging.`,
      }));
    } else {
      console.log(JSON.stringify({ permission: "allow" }));
    }
    process.exit(0);
  });
}

main();
