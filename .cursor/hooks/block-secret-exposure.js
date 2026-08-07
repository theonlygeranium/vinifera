#!/usr/bin/env node
/**
 * Hook: beforeReadFile
 * Purpose: Block secret files from being read into the model context.
 *
 * Input:  { file_path, content, attachments }
 * Output: { permission: "allow" | "deny", user_message }
 *
 * This hook uses fail-closed behavior: if the hook script itself crashes
 * or times out, the read is blocked (exit code 2). Set failClosed: true
 * in hooks.json for this hook.
 */

const SECRET_PATTERNS = [
  /\.env$/i,
  /\.env\./i,
  /\.env\.local$/i,
  /\.env\.production$/i,
  /\.env\.staging$/i,
  /.*secret.*/i,
  /.*service-role.*/i,
  /.*service_role.*/i,
  /.*\.pem$/i,
  /.*\.key$/i,
  /.*\.pfx$/i,
  /.*credentials\.json/i,
  /.*service-account.*\.json/i,
  /supabase\/.*keys.*/i,
  /\.cursor\/mcp\.json$/i,
  /.*\.cursor\/mcp\.json$/i,
];

const ALLOWED_SECRET_FILES = [
  /\.env\.example$/i,
  /\.env\.template$/i,
  /\.env\.sample$/i,
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
      // Fail-closed: block the read if we can't parse
      console.log(JSON.stringify({
        permission: "deny",
        user_message: "Blocked: file read blocked (hook could not parse input, fail-closed).",
      }));
      process.exit(2);
    }

    const filePath = parsed.file_path || "";

    // Allow explicitly safe example/template files
    if (ALLOWED_SECRET_PATTERNS.some((p) => p.test(filePath))) {
      console.log(JSON.stringify({ permission: "allow" }));
      process.exit(0);
    }

    // Block secret files
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(filePath)) {
        console.log(JSON.stringify({
          permission: "deny",
          user_message: `Blocked: file "${filePath}" matches a secret/sensitive file pattern and cannot be read into the model context. This prevents accidental secret exposure.`,
        }));
        process.exit(2);
      }
    }

    console.log(JSON.stringify({ permission: "allow" }));
    process.exit(0);
  });
}

main();
