import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const source = resolve(projectRoot, "dist/app.html");
const target = resolve(projectRoot, "dist/index.html");

await stat(source);
const configuredOrigin =
  process.env.VITE_MOBILE_API_ORIGIN?.trim() ||
  "https://vinifera.edstratumlabs.ai";
const apiOrigin = new URL(configuredOrigin);
if (
  apiOrigin.protocol !== "https:" ||
  apiOrigin.username ||
  apiOrigin.password ||
  apiOrigin.pathname !== "/" ||
  apiOrigin.search ||
  apiOrigin.hash
) {
  throw new Error(
    "VITE_MOBILE_API_ORIGIN must be a credential-free HTTPS origin.",
  );
}

const policy = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: https:",
  `connect-src 'self' ${apiOrigin.origin}`,
  "form-action 'self'",
].join("; ");

if (
  policy.includes("connect-src *") ||
  policy.includes("'unsafe-eval'") ||
  /connect-src[^;]*\*/.test(policy)
) {
  throw new Error("The native content policy is broader than allowed.");
}

const html = await readFile(source, "utf8");
const contentPolicy = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
if (!html.includes("</head>")) {
  throw new Error("The native application entry does not contain </head>.");
}
await writeFile(
  target,
  html.replace("</head>", `    ${contentPolicy}\n  </head>`),
  "utf8",
);
const output = await readFile(target, "utf8");
if (!output.includes(contentPolicy)) {
  throw new Error("The native Content Security Policy was not written.");
}
console.log(
  `Prepared dist/index.html for Capacitor with connect-src ${apiOrigin.origin}.`,
);
