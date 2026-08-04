#!/usr/bin/env node

const DEFAULT_OCTOPUS_URL = "https://octopus.schubert.life";

function parseArgs(argv) {
  const options = {
    requireMachine: false,
    origin: process.env.OCTOPUS_URL || DEFAULT_OCTOPUS_URL,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--require-machine") {
      options.requireMachine = true;
    } else if (arg === "--origin") {
      options.origin = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function normalizeOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("Octopus smoke origin must use HTTPS");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url;
}

function endpoint(origin, path) {
  return new URL(path, origin).toString();
}

async function readBody(response) {
  const text = await response.text();
  return text.slice(0, 500);
}

function assertNoCloudflareAccessRedirect(response, name) {
  const location = response.headers.get("location") || "";
  if (/cloudflareaccess\.com/i.test(location)) {
    throw new Error(`${name} redirected to Cloudflare Access: ${location}`);
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function expectRootRedirect(origin) {
  const response = await fetchWithTimeout(endpoint(origin, "/"), {
    redirect: "manual",
  });
  assertNoCloudflareAccessRedirect(response, "root");

  if (![301, 302, 303, 307, 308].includes(response.status)) {
    throw new Error(`Expected root redirect to Octopus app, got ${response.status}`);
  }

  const location = response.headers.get("location") || "";
  if (!location.startsWith("/app")) {
    throw new Error(`Expected root redirect to /app, got ${location || "<none>"}`);
  }

  return `root=${response.status}->${location}`;
}

async function expectAppShell(origin) {
  const response = await fetchWithTimeout(endpoint(origin, "/app"));
  assertNoCloudflareAccessRedirect(response, "app");

  const body = await readBody(response);
  if (response.status !== 200 || !body.includes("Octopus Deploy")) {
    throw new Error(`Expected Octopus app shell, got ${response.status}: ${body}`);
  }

  return "app=200";
}

async function expectApiMetadata(origin) {
  const response = await fetchWithTimeout(endpoint(origin, "/api"));
  assertNoCloudflareAccessRedirect(response, "api");

  const payload = await response.json();
  if (response.status !== 200 || payload.Application !== "Octopus Deploy") {
    throw new Error(`Expected Octopus API metadata, got ${response.status}`);
  }

  return `api=200 version=${payload.Version || "unknown"}`;
}

async function expectOctopusAuthBoundary(origin) {
  const response = await fetchWithTimeout(endpoint(origin, "/api/users/me"));
  assertNoCloudflareAccessRedirect(response, "auth boundary");

  const payload = await response.json();
  if (
    response.status !== 401 ||
    !String(payload.ErrorMessage || "").includes("logged in")
  ) {
    throw new Error(`Expected Octopus-native 401 auth boundary, got ${response.status}`);
  }

  return "auth_boundary=octopus_401";
}

function machineHeaders() {
  const required = [
    "CF_ACCESS_CLIENT_ID",
    "CF_ACCESS_CLIENT_SECRET",
    "OCTOPUS_API_KEY",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    return { missing };
  }

  return {
    missing: [],
    headers: {
      "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
      "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
      "X-Octopus-ApiKey": process.env.OCTOPUS_API_KEY,
    },
  };
}

async function expectMachinePath(origin, requireMachine) {
  const { missing, headers } = machineHeaders();
  if (missing.length > 0) {
    if (requireMachine) {
      throw new Error(`Missing machine-path environment: ${missing.join(", ")}`);
    }
    return `machine_path=skipped missing=${missing.join(",")}`;
  }

  const response = await fetchWithTimeout(endpoint(origin, "/api/users/me"), {
    headers,
  });
  assertNoCloudflareAccessRedirect(response, "machine path");

  const payload = await response.json();
  if (response.status !== 200 || !payload.Id) {
    throw new Error(`Expected authenticated Octopus user metadata, got ${response.status}`);
  }

  return `machine_path=200 user=${payload.Username || payload.Id}`;
}

async function main() {
  const options = parseArgs(process.argv);
  const origin = normalizeOrigin(options.origin);
  const checks = [];

  checks.push(await expectRootRedirect(origin));
  checks.push(await expectAppShell(origin));
  checks.push(await expectApiMetadata(origin));
  checks.push(await expectOctopusAuthBoundary(origin));
  checks.push(await expectMachinePath(origin, options.requireMachine));

  console.log(`Octopus access smoke passed for ${origin.origin}`);
  for (const check of checks) {
    console.log(`- ${check}`);
  }
}

main().catch((error) => {
  console.error(`Octopus access smoke failed: ${error.message}`);
  process.exitCode = 1;
});
