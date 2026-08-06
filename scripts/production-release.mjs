import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertActiveDeployment,
  assertHealthPayload,
  assertProductionConfirmation,
  assertRollbackDeploymentHistory,
  assertVersionMatchesGitSha,
  buildProductionSecretBundle,
  hashProductionTarget,
  parseWranglerJson,
  parseWranglerStagingVersionUploadOutput,
  parseWranglerVersionUploadOutput,
  soleActiveVersionId,
  validateImmutableGitSha,
  validateWorkerVersionId,
  verifyProductionTargets,
} from "./lib/production-release-guard.mjs";
import {
  captureProductionState,
  cutoverToWorker,
  restorePages,
  workerResourceExists,
} from "./lib/cloudflare-production-control.mjs";

const policyPath = resolve(
  import.meta.dirname,
  "../config/production-release-policy.json",
);
const policy = JSON.parse(await readFile(policyPath, "utf8"));
const [operation, ...arguments_] = process.argv.slice(2);

function productionTargets() {
  return {
    cloudflareAccountId: process.env.PRODUCTION_CLOUDFLARE_ACCOUNT_ID,
    cloudflareZoneId: process.env.PRODUCTION_CLOUDFLARE_ZONE_ID,
    customHostname: process.env.PRODUCTION_CUSTOM_HOSTNAME,
    pagesProjectName: process.env.PRODUCTION_PAGES_PROJECT_NAME,
    workerName: policy.workerName,
    workerOrigin: process.env.PRODUCTION_WORKER_ORIGIN,
  };
}

function controlOptions() {
  return {
    accountId: process.env.PRODUCTION_CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.PRODUCTION_CLOUDFLARE_API_TOKEN,
    hostname: process.env.PRODUCTION_CUSTOM_HOSTNAME,
    pagesProjectName: process.env.PRODUCTION_PAGES_PROJECT_NAME,
    policy,
    workerName: policy.workerName,
    zoneId: process.env.PRODUCTION_CLOUDFLARE_ZONE_ID,
  };
}

async function readJson(path, label) {
  return parseWranglerJson(await readFile(path, "utf8"), label);
}

async function writeJson(path, value, options) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, options);
}

if (operation === "verify-targets") {
  const [scope] = arguments_;
  verifyProductionTargets({
    policy,
    scope,
    targets: productionTargets(),
  });
  console.log(`Verified allowlisted production ${scope} targets.`);
} else if (operation === "hash-target") {
  const [kind] = arguments_;
  const targets = productionTargets();
  if (!Object.hasOwn(targets, kind)) {
    throw new Error("Production target kind is invalid.");
  }
  console.log(hashProductionTarget(kind, targets[kind]));
} else if (operation === "verify-confirmation") {
  const [mode] = arguments_;
  assertProductionConfirmation(
    policy,
    mode,
    process.env.PRODUCTION_CONFIRMATION,
  );
  console.log(`Verified exact production ${mode} confirmation.`);
} else if (operation === "prepare-secrets") {
  const [outputPath] = arguments_;
  if (!outputPath) throw new Error("Secret output path is required.");
  const bundle = buildProductionSecretBundle(process.env, policy);
  await writeJson(outputPath, bundle, { flag: "wx", mode: 0o600 });
  await chmod(outputPath, 0o600);
  console.log(
    `Prepared ${Object.keys(bundle).length} production Worker bindings.`,
  );
} else if (operation === "parse-upload") {
  const [inputPath, outputPath] = arguments_;
  if (!inputPath || !outputPath) {
    throw new Error("Upload input and evidence output paths are required.");
  }
  const result = parseWranglerVersionUploadOutput(
    await readFile(inputPath, "utf8"),
  );
  await writeJson(outputPath, result);
  console.log("Parsed one production Worker version and preview URL.");
} else if (operation === "parse-staging-upload") {
  const [inputPath, outputPath, configuredOrigin] = arguments_;
  if (!inputPath || !outputPath || !configuredOrigin) {
    throw new Error(
      "Staging upload input, evidence output, and configured origin are required.",
    );
  }
  const result = parseWranglerStagingVersionUploadOutput(
    await readFile(inputPath, "utf8"),
    configuredOrigin,
  );
  await writeJson(outputPath, result);
  console.log("Parsed one staging Worker version and verified runtime origin.");
} else if (operation === "verify-version") {
  const [inputPath] = arguments_;
  if (!inputPath) throw new Error("Worker version JSON path is required.");
  assertVersionMatchesGitSha({
    artifactSha256: process.env.RELEASE_ARTIFACT_SHA256,
    gitSha: validateImmutableGitSha(process.env.PRODUCTION_ARTIFACT_GIT_SHA),
    version: await readJson(inputPath, "Wrangler version view"),
    versionId: validateWorkerVersionId(process.env.PRODUCTION_VERSION_ID),
  });
  console.log("Verified Worker version metadata against immutable Git SHA.");
} else if (operation === "verify-version-id") {
  validateWorkerVersionId(process.env.PRODUCTION_VERSION_ID);
  console.log("Verified Worker Version ID format.");
} else if (operation === "verify-deployment") {
  const [inputPath] = arguments_;
  if (!inputPath) throw new Error("Worker deployment JSON path is required.");
  assertActiveDeployment(
    await readJson(inputPath, "Wrangler deployment status"),
    process.env.PRODUCTION_VERSION_ID,
  );
  console.log("Verified sole 100% active Worker version.");
} else if (operation === "verify-rollback-history") {
  const [historyPath, currentPath] = arguments_;
  if (!historyPath || !currentPath) {
    throw new Error(
      "Rollback deployment history and current deployment paths are required.",
    );
  }
  assertRollbackDeploymentHistory(
    await readJson(historyPath, "Wrangler deployment history"),
    await readJson(currentPath, "Wrangler deployment status"),
    process.env.PRODUCTION_VERSION_ID,
  );
  console.log(
    "Verified that the rollback version was previously active and is not current.",
  );
} else if (operation === "active-version") {
  const [inputPath, outputPath] = arguments_;
  if (!inputPath || !outputPath) {
    throw new Error("Deployment input and version output paths are required.");
  }
  await writeFile(
    outputPath,
    `${soleActiveVersionId(
      await readJson(inputPath, "Wrangler deployment status"),
    )}\n`,
  );
  console.log("Parsed the sole 100% active Worker version.");
} else if (operation === "verify-health") {
  const [healthPath, configurationPath, profile = "core"] = arguments_;
  if (!healthPath || !configurationPath) {
    throw new Error("Health and configuration JSON paths are required.");
  }
  assertHealthPayload(
    await readJson(healthPath, "Worker health"),
    await readJson(configurationPath, "Worker configuration"),
    policy,
    profile,
  );
  console.log(
    `Verified production Worker health and ${profile} configuration gates.`,
  );
} else if (operation === "verify-bootstrap-absent") {
  verifyProductionTargets({
    policy,
    scope: "worker",
    targets: productionTargets(),
  });
  assertProductionConfirmation(
    policy,
    "bootstrap",
    process.env.PRODUCTION_CONFIRMATION,
  );
  if (await workerResourceExists(controlOptions())) {
    throw new Error(
      "The production Worker already exists; use upload-version instead of bootstrap.",
    );
  }
  console.log(
    "Verified that first-time production Worker bootstrap is required.",
  );
} else if (operation === "snapshot") {
  const [outputPath] = arguments_;
  if (!outputPath) throw new Error("Snapshot output path is required.");
  verifyProductionTargets({
    policy,
    scope: "domain",
    targets: productionTargets(),
  });
  await writeJson(outputPath, await captureProductionState(controlOptions()));
  console.log("Captured sanitized Worker and Pages control-plane state.");
} else if (operation === "attach-live-domain") {
  const [outputPath] = arguments_;
  if (!outputPath) throw new Error("Cutover evidence output path is required.");
  verifyProductionTargets({
    policy,
    scope: "domain",
    targets: productionTargets(),
  });
  assertProductionConfirmation(
    policy,
    "attach-live-domain",
    process.env.PRODUCTION_CONFIRMATION,
  );
  await writeJson(outputPath, await cutoverToWorker(controlOptions()));
  console.log("Attached the allowlisted live application domain to the Worker.");
} else if (operation === "restore-live-pages") {
  const [outputPath] = arguments_;
  if (!outputPath) throw new Error("Restore evidence output path is required.");
  verifyProductionTargets({
    policy,
    scope: "domain",
    targets: productionTargets(),
  });
  assertProductionConfirmation(
    policy,
    "restore-live-pages",
    process.env.PRODUCTION_CONFIRMATION,
  );
  await writeJson(outputPath, await restorePages(controlOptions()));
  console.log("Restored the allowlisted custom domain to the Pages project.");
} else {
  throw new Error(
    "Usage: production-release.mjs hash-target <kind>, verify-targets <upload|worker|domain>, verify-confirmation <mode>, verify-bootstrap-absent, verify-version-id, prepare-secrets <path>, parse-upload <input> <output>, verify-version <json>, verify-deployment <json>, verify-rollback-history <history-json> <current-json>, active-version <deployment-json> <output>, verify-health <health-json> <configuration-json> [core|cutover], snapshot <output>, attach-live-domain <output>, or restore-live-pages <output>.",
  );
}
