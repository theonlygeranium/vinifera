import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveMobileBuildTarget } from "./lib/activation-guard.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const source = resolve(projectRoot, "dist/app.html");
const target = resolve(projectRoot, "dist/index.html");

await stat(source);
const mobileTarget = resolveMobileBuildTarget({
  apiOrigin: process.env.VITE_MOBILE_API_ORIGIN,
  buildProfile: process.env.MOBILE_BUILD_PROFILE,
  productionAuthorized: process.env.MOBILE_PRODUCTION_ORIGIN_AUTHORIZED,
});
const apiOrigin = new URL(mobileTarget.origin);

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
const buildClassification =
  `<meta name="vinifera-mobile-build-classification" ` +
  `content="${mobileTarget.classification}">`;
if (!html.includes("</head>")) {
  throw new Error("The native application entry does not contain </head>.");
}
await writeFile(
  target,
  html.replace(
    "</head>",
    `    ${contentPolicy}\n    ${buildClassification}\n  </head>`,
  ),
  "utf8",
);
const output = await readFile(target, "utf8");
if (
  !output.includes(contentPolicy) ||
  !output.includes(buildClassification)
) {
  throw new Error("Native policy and build classification were not written.");
}
console.log(
  `Prepared Capacitor bundle: classification=${mobileTarget.classification}; ` +
    `connect-src=${apiOrigin.origin}.`,
);
