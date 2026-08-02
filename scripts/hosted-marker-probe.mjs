#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_ORIGINS = Object.freeze([
  "https://vinifera-staging.pages.dev",
  "https://vinifera-staging.edstratumlabs.ai",
  "https://vinifera.pages.dev",
  "https://vinifera.edstratumlabs.ai",
  "https://vinifera-live.edstratumlabs.ai",
]);

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function usage() {
  return [
    "Usage: hosted-marker-probe.mjs --slug <slug> --marker <marker> [options]",
    "",
    "Options:",
    "  --expect present|absent      Marker expectation. Default: present",
    "  --origins <csv>              Override origins. Default: Vinifera staging/prod origins",
    "  --deadline-ms <number>       Retry deadline. Default: 240000",
    "  --interval-ms <number>       Retry interval. Default: 10000",
  ].join("\n");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function probeHostedMarker({
  slug,
  marker,
  expect = "present",
  origins = DEFAULT_ORIGINS,
  deadlineMs = 240_000,
  intervalMs = 10_000,
} = {}) {
  const normalizedOrigins = origins
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const deadline = Date.now() + deadlineMs;
  let attempt = 0;
  let lastResult;

  while (Date.now() <= deadline) {
    attempt += 1;
    const checks = [];
    const foundOrigins = new Set();
    let markerFoundAnywhere = false;

    for (const origin of normalizedOrigins) {
      for (const suffix of [".html", ""]) {
        const url = `${origin}/${slug}${suffix}?marker_probe=${Date.now()}_${attempt}`;
        try {
          const response = await fetch(url, {
            redirect: "follow",
            headers: { "cache-control": "no-cache" },
          });
          const body = await response.text();
          const markerFound = body.includes(marker);
          markerFoundAnywhere ||= markerFound;
          if (markerFound) foundOrigins.add(origin);
          checks.push({ url, status: response.status, finalUrl: response.url, markerFound });
        } catch (error) {
          checks.push({
            url,
            status: 0,
            error: error instanceof Error ? error.message : String(error),
            markerFound: false,
          });
        }
      }
    }

    const missingOrigins = normalizedOrigins.filter((origin) => !foundOrigins.has(origin));
    const passed = expect === "present" ? missingOrigins.length === 0 : !markerFoundAnywhere;
    lastResult = {
      attempt,
      expect,
      passed,
      markerFoundAnywhere,
      foundOrigins: [...foundOrigins],
      missingOrigins,
      checks,
    };
    if (passed) return lastResult;
    await sleep(intervalMs);
  }
  return lastResult;
}

async function main() {
  const slug = arg("slug");
  const marker = arg("marker");
  const expect = arg("expect", "present");
  const origins = (arg("origins") || DEFAULT_ORIGINS.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const deadlineMs = Number(arg("deadline-ms", "240000"));
  const intervalMs = Number(arg("interval-ms", "10000"));

  if (!slug || !marker || !["present", "absent"].includes(expect)) {
    console.error(usage());
    process.exit(2);
  }
  const result = await probeHostedMarker({
    slug,
    marker,
    expect,
    origins,
    deadlineMs,
    intervalMs,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result?.passed) {
    console.error(`Marker expectation was not met before deadline: expected ${expect}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
