#!/usr/bin/env node
/**
 * Hook: beforeShellExecution
 * Matcher: "curl|wget|nc "
 * Purpose: Block network exfiltration of secrets via curl, wget, nc.
 *
 * This hook inspects the full command string for patterns that suggest
 * secret exfiltration: environment variables piped to network tools,
 * secret files sent via curl, or reverse shell patterns.
 */

const SUSPICIOUS_PATTERNS = [
  /curl\s+.*\$\{?env?:?\s*SUPABASE/i,
  /curl\s+.*SUPABASE_SERVICE_ROLE/i,
  /curl\s+.*STRIPE_SECRET/i,
  /curl\s+.*\bJWT_SECRET\b/i,
  /curl\s+.*\bSECRET_KEY\b/i,
  /curl\s+.*\bAPI_KEY\b.*(-d|--data|-F)/i,
  /wget\s+.*\$\{?env?:?\s*SUPABASE/i,
  /wget\s+.*SUPABASE_SERVICE_ROLE/i,
  /nc\s+.*-e\s+\/bin\/(ba)?sh/i,
  /curl\s+.*-d\s+@\.env/i,
  /curl\s+.*-d\s+@.*secret/i,
  /curl\s+.*--data-urlencode.*TOKEN/i,
];

function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch {
      console.log(JSON.stringify({ permission: "allow" }));
      process.exit(0);
    }

    const command = parsed.command || "";

    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(command)) {
        console.log(JSON.stringify({
          permission: "deny",
          user_message: "Blocked: network command appears to exfiltrate secrets or environment variables. This is a security violation.",
          agent_message: `The command was blocked by the network exfiltration hook. It matched a pattern suggesting secret exfiltration via a network tool. If this is a legitimate operation (e.g., an API call with an API key), use the project's MCP server configuration instead of passing secrets through shell commands.`,
        }));
        process.exit(2);
      }
    }

    console.log(JSON.stringify({ permission: "allow" }));
    process.exit(0);
  });
}

main();
