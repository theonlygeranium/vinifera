import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const STAGING_HOST_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?-)?vinifera-staging\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.workers\.dev$/;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const DEFAULT_REQUIRED_CAPABILITIES = Object.freeze([
  "app",
  "database",
  "billing",
  "security",
  "webhook",
]);

function stagingOrigin(rawOrigin) {
  let parsed;
  try {
    parsed = new URL(String(rawOrigin ?? "").trim());
  } catch {
    throw new Error("The staging Worker origin is invalid.");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !STAGING_HOST_PATTERN.test(parsed.hostname.toLowerCase())
  ) {
    throw new Error(
      "Hosted runtime verification accepts only the isolated vinifera-staging workers.dev origin.",
    );
  }
  return parsed.origin;
}

function responseData(payload, label) {
  if (
    payload === null ||
    typeof payload !== "object" ||
    payload.data === null ||
    typeof payload.data !== "object" ||
    Array.isArray(payload.data)
  ) {
    throw new Error(`${label} returned an invalid response contract.`);
  }
  return payload.data;
}

function configurationState(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.configured === "boolean"
  );
}

export function buildHostedRuntimeEvidence({
  healthPayload,
  configurationPayload,
  databasePayload,
  expectedRevision,
  requiredCapabilities = DEFAULT_REQUIRED_CAPABILITIES,
  now = () => new Date(),
}) {
  if (!GIT_SHA_PATTERN.test(expectedRevision ?? "")) {
    throw new Error("The expected staging revision must be a full Git SHA.");
  }
  const health = responseData(healthPayload, "Worker health");
  if (
    health.environment !== "staging" ||
    health.revision !== expectedRevision ||
    health.service !== "vinifera-api" ||
    health.status !== "ok"
  ) {
    throw new Error("The staging Worker health contract did not pass.");
  }

  const configuration = responseData(
    configurationPayload,
    "Worker configuration",
  );
  const capabilityNames = Object.keys(configuration).sort();
  if (
    capabilityNames.length === 0 ||
    capabilityNames.some(
      (name) => !configurationState(configuration[name]),
    )
  ) {
    throw new Error("The staging Worker configuration contract is invalid.");
  }

  const unknownRequired = requiredCapabilities.filter(
    (name) => !Object.hasOwn(configuration, name),
  );
  if (unknownRequired.length > 0) {
    throw new Error(
      `The configuration report is missing required capabilities: ${unknownRequired.join(", ")}.`,
    );
  }

  const capabilityConfigured = Object.fromEntries(
    capabilityNames.map((name) => [
      name,
      configuration[name].configured === true,
    ]),
  );
  const failedRequired = requiredCapabilities.filter(
    (name) => capabilityConfigured[name] !== true,
  );
  if (failedRequired.length > 0) {
    throw new Error(
      `The staging Worker is missing required capabilities: ${failedRequired.join(", ")}.`,
    );
  }

  const databaseProbe = responseData(databasePayload, "Database-backed route");
  if (
    !["canonical", "white-label"].includes(databaseProbe.mode) ||
    !(databaseProbe.brand === null || typeof databaseProbe.brand === "object")
  ) {
    throw new Error("The staging Worker database-backed route did not pass.");
  }

  return {
    checkedAt: now().toISOString(),
    configuration: {
      capabilityConfigured,
      requiredCapabilities: [...requiredCapabilities],
      requiredCapabilitiesPassed: true,
    },
    databaseProbe: {
      mode: databaseProbe.mode,
      passed: true,
    },
    health: {
      environment: "staging",
      passed: true,
      revision: expectedRevision,
      service: "vinifera-api",
      status: "ok",
    },
    targetClass: "isolated-staging-workers-dev",
  };
}

async function fetchJson(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error("The staging Worker returned a non-success status.");
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

export async function verifyHostedRuntime({
  fetchImpl = fetch,
  maxAttempts = 6,
  now,
  origin,
  expectedRevision,
  requiredCapabilities = DEFAULT_REQUIRED_CAPABILITIES,
  retryDelayMs = 2_000,
  timeoutMs = 10_000,
  waitImpl = wait,
}) {
  const validatedOrigin = stagingOrigin(origin);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("Hosted runtime verification attempts must be positive.");
  }
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const [healthPayload, configurationPayload, databasePayload] =
        await Promise.all([
          fetchJson(fetchImpl, `${validatedOrigin}/api/health`, timeoutMs),
          fetchJson(
            fetchImpl,
            `${validatedOrigin}/api/health/configuration`,
            timeoutMs,
          ),
          fetchJson(
            fetchImpl,
            `${validatedOrigin}/api/portal/branding`,
            timeoutMs,
          ),
        ]);
      return buildHostedRuntimeEvidence({
        configurationPayload,
        databasePayload,
        expectedRevision,
        healthPayload,
        now,
        requiredCapabilities,
      });
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await waitImpl(retryDelayMs);
    }
  }
  throw lastError;
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(
        "Usage: verify-hosted-runtime.mjs --origin <url> --expected-revision <sha> --output <path>",
      );
    }
    values[name.slice(2)] = value;
  }
  if (!values.origin || !values["expected-revision"] || !values.output) {
    throw new Error(
      "Usage: verify-hosted-runtime.mjs --origin <url> --expected-revision <sha> --output <path>",
    );
  }
  return values;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const evidence = await verifyHostedRuntime({
    expectedRevision: args["expected-revision"],
    origin: args.origin,
  });
  const outputPath = resolve(args.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(
    "Verified isolated staging Worker health and core configuration capabilities.",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
