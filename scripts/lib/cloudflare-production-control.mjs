import { createHash } from "node:crypto";

const API_BASE = "https://api.cloudflare.com/client/v4";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const MAX_BODY_BYTES = 1024 * 1024;

function required(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} metadata is required.`);
  return normalized;
}

function endpointPart(value, label) {
  return encodeURIComponent(required(value, label));
}

function cloudflareError(payload, status) {
  const code = payload?.errors?.[0]?.code;
  return new Error(
    `Cloudflare control-plane request failed${code ? ` (${code})` : ""} with HTTP ${status}.`,
  );
}

async function boundedJsonResponse(response, label) {
  const bytes = await boundedResponseBytes(response, MAX_BODY_BYTES, label);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} was not JSON (HTTP ${response.status}).`);
  }
}

async function boundedResponseBytes(response, maximumBytes, label) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`${label} exceeded its size limit.`);
  }
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) {
      throw new Error(`${label} exceeded its size limit.`);
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      throw new Error(`${label} exceeded its size limit.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, length);
}

export async function cloudflareApiRequest({
  accountId,
  apiToken,
  body,
  fetcher = fetch,
  method = "GET",
  path,
}) {
  required(accountId, "Cloudflare account");
  required(apiToken, "Cloudflare API token");
  if (!String(path).startsWith("/accounts/")) {
    throw new Error(
      "Cloudflare control-plane path is outside the account scope.",
    );
  }
  const response = await fetcher(`${API_BASE}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    method,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await boundedJsonResponse(
    response,
    "Cloudflare control-plane response",
  );
  if (!response.ok || payload?.success !== true) {
    throw cloudflareError(payload, response.status);
  }
  return payload.result;
}

function workerDomainSummary(domain) {
  return {
    environment: domain?.environment ?? null,
    hostname: domain?.hostname ?? null,
    id: domain?.id ?? null,
    service: domain?.service ?? null,
    zoneId: domain?.zone_id ?? null,
  };
}

function pagesDomainSummary(domain) {
  return {
    name: domain?.name ?? null,
    status: domain?.status ?? null,
    verificationData: domain?.verification_data ? "present" : "absent",
  };
}

function deploymentSummary(deployment) {
  return deployment
    ? {
        createdOn: deployment.created_on ?? deployment.createdOn ?? null,
        id: deployment.id ?? null,
        versions: Array.isArray(deployment.versions)
          ? deployment.versions.map((version) => ({
              percentage: version.percentage,
              versionId: version.version_id,
            }))
          : [],
      }
    : null;
}

function pagesDeploymentSummary(deployment) {
  return deployment
    ? {
        environment: deployment.environment ?? null,
        id: deployment.id ?? null,
        url: deployment.url ?? null,
      }
    : null;
}

export async function captureProductionState({
  accountId,
  apiToken,
  fetcher = fetch,
  pagesProjectName,
  policy,
  workerName,
}) {
  const account = endpointPart(accountId, "Cloudflare account");
  const worker = endpointPart(workerName, "Worker name");
  const project = endpointPart(pagesProjectName, "Pages project name");
  const request = (path) =>
    cloudflareApiRequest({ accountId, apiToken, fetcher, path });
  const [
    deploymentResult,
    workerDomainsResult,
    pagesProject,
    pagesDomains,
    pagesDeployments,
  ] = await Promise.all([
    request(`/accounts/${account}/workers/scripts/${worker}/deployments`),
    request(`/accounts/${account}/workers/domains`),
    request(`/accounts/${account}/pages/projects/${project}`),
    request(`/accounts/${account}/pages/projects/${project}/domains`),
    request(
      `/accounts/${account}/pages/projects/${project}/deployments?env=production&page=1&per_page=1`,
    ),
  ]);
  if (!pagesProject || pagesProject.name !== pagesProjectName) {
    throw new Error("The allowlisted Pages project metadata was not found.");
  }
  if (
    pagesProject.production_branch !== policy?.pagesRollback?.productionBranch
  ) {
    throw new Error("The Pages rollback production branch is not approved.");
  }
  const productionDeployment = Array.isArray(pagesDeployments)
    ? pagesDeployments[0]
    : null;
  if (!productionDeployment) {
    throw new Error(
      "The Pages project has no production deployment to restore.",
    );
  }
  let deploymentUrl;
  try {
    deploymentUrl = new URL(productionDeployment.url);
  } catch {
    throw new Error("The Pages rollback deployment URL is invalid.");
  }
  const approvedSuffix = policy?.pagesRollback?.deploymentHostnameSuffix;
  if (
    productionDeployment.environment !== "production" ||
    deploymentUrl.protocol !== "https:" ||
    (deploymentUrl.hostname !== approvedSuffix &&
      !deploymentUrl.hostname.endsWith(`.${approvedSuffix}`))
  ) {
    throw new Error(
      "The Pages rollback deployment is not the approved production target.",
    );
  }
  return {
    capturedAt: new Date().toISOString(),
    pages: {
      domains: (Array.isArray(pagesDomains) ? pagesDomains : []).map(
        pagesDomainSummary,
      ),
      productionBranch: pagesProject.production_branch ?? null,
      productionDeployment: pagesDeploymentSummary(productionDeployment),
      projectName: pagesProject.name,
      subdomain: pagesProject.subdomain ?? null,
    },
    worker: {
      deployment: deploymentSummary(deploymentResult?.deployments?.[0]),
      domains: (Array.isArray(workerDomainsResult)
        ? workerDomainsResult
        : []
      ).map(workerDomainSummary),
      name: workerName,
    },
  };
}

async function mutatePagesDomain({
  accountId,
  apiToken,
  fetcher,
  hostname,
  method,
  pagesProjectName,
}) {
  const account = endpointPart(accountId, "Cloudflare account");
  const project = endpointPart(pagesProjectName, "Pages project name");
  const suffix =
    method === "DELETE"
      ? `/${endpointPart(hostname, "Pages custom domain")}`
      : "";
  return cloudflareApiRequest({
    accountId,
    apiToken,
    body: method === "POST" ? { name: hostname } : undefined,
    fetcher,
    method,
    path: `/accounts/${account}/pages/projects/${project}/domains${suffix}`,
  });
}

async function attachWorkerDomain({
  accountId,
  apiToken,
  fetcher,
  hostname,
  workerName,
  zoneId,
}) {
  const account = endpointPart(accountId, "Cloudflare account");
  return cloudflareApiRequest({
    accountId,
    apiToken,
    body: {
      environment: "production",
      hostname,
      service: workerName,
      zone_id: zoneId,
    },
    fetcher,
    method: "PUT",
    path: `/accounts/${account}/workers/domains`,
  });
}

async function getWorkerDomain({ accountId, apiToken, domainId, fetcher }) {
  const account = endpointPart(accountId, "Cloudflare account");
  const domain = endpointPart(domainId, "Worker custom-domain ID");
  return cloudflareApiRequest({
    accountId,
    apiToken,
    fetcher,
    path: `/accounts/${account}/workers/domains/${domain}`,
  });
}

async function deleteWorkerDomain({ accountId, apiToken, domainId, fetcher }) {
  const account = endpointPart(accountId, "Cloudflare account");
  const domain = endpointPart(domainId, "Worker custom-domain ID");
  return cloudflareApiRequest({
    accountId,
    apiToken,
    fetcher,
    method: "DELETE",
    path: `/accounts/${account}/workers/domains/${domain}`,
  });
}

async function poll(check, { attempts = 10, delayMs = 3_000, sleep } = {}) {
  let lastError;
  const wait =
    sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await check();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(delayMs);
    }
  }
  throw lastError;
}

async function boundedPublicRequest(fetcher, url) {
  const expected = new URL(url);
  const response = await fetcher(expected, {
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (response.url && new URL(response.url).origin !== expected.origin) {
    throw new Error("Public verification escaped the approved origin.");
  }
  const bytes = await boundedResponseBytes(
    response,
    MAX_BODY_BYTES,
    "Public verification response",
  );
  return { bytes, response };
}

function jsonBytes(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} did not return JSON.`);
  }
}

function expectedAssociationPayloads(mobile) {
  const teamId = required(mobile?.appleTeamId, "Apple team");
  const bundleId = required(mobile?.iosBundleId, "iOS bundle");
  const packageName = required(mobile?.androidPackageName, "Android package");
  const fingerprint = required(
    mobile?.androidSigningCertSha256,
    "Android signing certificate",
  ).toUpperCase();
  const paths = ["/portal", "/portal/auth", "/app/fulfillment"];
  return {
    android: [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: packageName,
          sha256_cert_fingerprints: [fingerprint],
        },
      },
    ],
    apple: {
      applinks: {
        details: [
          {
            appIDs: [`${teamId}.${bundleId}`],
            components: paths.map((path) => ({ "/": path })),
          },
        ],
      },
    },
  };
}

async function marketingDigest(options) {
  const origin = required(options.policy?.marketingOrigin, "Marketing origin");
  const paths = ["/", "/app/", "/guide/"];
  const results = await Promise.all(
    paths.map((path) =>
      boundedPublicRequest(options.fetcher ?? fetch, new URL(path, origin)),
    ),
  );
  if (!results.every(({ response }) => response.ok)) {
    throw new Error("Marketing baseline is unavailable.");
  }
  return Object.fromEntries(
    results.map(({ bytes }, index) => [
      paths[index],
      createHash("sha256").update(bytes).digest("hex"),
    ]),
  );
}

async function assertMarketingUnchanged(options, before) {
  const after = await marketingDigest(options);
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error("Marketing baseline changed during live-domain control.");
  }
  return after;
}

export async function probeWorkerHealth({
  attempts,
  delayMs,
  fetcher = fetch,
  origin,
  policy,
  profile = "core",
  expectedRevision,
  mobile,
  sleep,
}) {
  return poll(
    async () => {
      const [healthResult, configurationResult] = await Promise.all([
        boundedPublicRequest(fetcher, new URL("/api/health", origin)),
        boundedPublicRequest(
          fetcher,
          new URL("/api/health/configuration", origin),
        ),
      ]);
      const healthResponse = healthResult.response;
      const configurationResponse = configurationResult.response;
      if (!healthResponse.ok || !configurationResponse.ok) {
        throw new Error("Worker health endpoints are not ready.");
      }
      const health = jsonBytes(healthResult.bytes, "Worker health");
      const configuration = jsonBytes(
        configurationResult.bytes,
        "Worker configuration",
      );
      if (
        health?.data?.service !== "vinifera-api" ||
        health?.data?.status !== "ok" ||
        health?.data?.environment !== "production" ||
        !SHA.test(String(expectedRevision ?? "")) ||
        health?.data?.revision !== expectedRevision
      ) {
        throw new Error(
          "Worker health response is not the exact production Vinifera API revision.",
        );
      }
      const capabilities =
        profile === "cutover"
          ? policy.cutoverHealthCapabilities
          : profile === "core"
            ? policy.coreHealthCapabilities
            : null;
      if (!Array.isArray(capabilities) || capabilities.length === 0) {
        throw new Error(`Production ${profile} health policy is missing.`);
      }
      for (const capability of capabilities) {
        if (configuration?.data?.[capability]?.configured !== true) {
          throw new Error(
            `Worker configuration capability ${capability} is not activated.`,
          );
        }
      }
      let routes = null;
      if (profile === "cutover") {
        const expectedAssociations = expectedAssociationPayloads(mobile);
        const [root, app, portal, apple, android] = await Promise.all([
          boundedPublicRequest(fetcher, new URL("/", origin)),
          boundedPublicRequest(fetcher, new URL("/app/", origin)),
          boundedPublicRequest(fetcher, new URL("/portal/", origin)),
          boundedPublicRequest(
            fetcher,
            new URL("/.well-known/apple-app-site-association", origin),
          ),
          boundedPublicRequest(
            fetcher,
            new URL("/.well-known/assetlinks.json", origin),
          ),
        ]);
        if (
          ![root, app, portal, apple, android].every(({ response }) =>
            Boolean(response.ok),
          ) ||
          !root.bytes.toString("utf8").includes("Vinifera") ||
          !app.bytes.toString("utf8").includes("Vinifera Club Management") ||
          !portal.bytes.toString("utf8").includes("Vinifera Club Management") ||
          JSON.stringify(jsonBytes(apple.bytes, "Apple association")) !==
            JSON.stringify(expectedAssociations.apple) ||
          JSON.stringify(jsonBytes(android.bytes, "Android association")) !==
            JSON.stringify(expectedAssociations.android)
        ) {
          throw new Error(
            "Production application and mobile association routes are not exact.",
          );
        }
        routes = {
          androidAssociation: true,
          appleAssociation: true,
          app: true,
          portal: true,
          root: true,
        };
      }
      return { configuration, health, routes };
    },
    { attempts, delayMs, sleep },
  );
}

export async function probeWorkerDomainAttachment({
  accountId,
  apiToken,
  attempts,
  delayMs,
  domainId,
  fetcher = fetch,
  hostname,
  sleep,
  workerName,
  zoneId,
}) {
  return poll(
    async () => {
      const domain = await getWorkerDomain({
        accountId,
        apiToken,
        domainId,
        fetcher,
      });
      if (
        domain?.hostname !== hostname ||
        domain?.service !== workerName ||
        domain?.environment !== "production" ||
        domain?.zone_id !== zoneId
      ) {
        throw new Error(
          "Worker custom-domain attachment does not match the allowlisted target.",
        );
      }
      return workerDomainSummary(domain);
    },
    { attempts, delayMs, sleep },
  );
}

export async function probePagesRestored({
  attempts,
  delayMs,
  fetcher = fetch,
  origin,
  policy,
  sleep,
}) {
  return poll(
    async () => {
      const [root, app] = await Promise.all([
        boundedPublicRequest(fetcher, new URL("/", origin)),
        boundedPublicRequest(fetcher, new URL("/app/", origin)),
      ]);
      if (!root.response.ok || !app.response.ok) {
        throw new Error("Pages rollback routes are not ready.");
      }
      if (
        !DIGEST.test(policy?.pagesRollback?.rootSha256 ?? "") ||
        !DIGEST.test(policy?.pagesRollback?.appSha256 ?? "") ||
        createHash("sha256").update(root.bytes).digest("hex") !==
          policy.pagesRollback.rootSha256 ||
        createHash("sha256").update(app.bytes).digest("hex") !==
          policy.pagesRollback.appSha256
      ) {
        throw new Error("Pages rollback content contract did not match.");
      }
      return {
        appSha256: policy.pagesRollback.appSha256,
        appStatus: app.response.status,
        rootSha256: policy.pagesRollback.rootSha256,
        rootStatus: root.response.status,
      };
    },
    { attempts, delayMs, sleep },
  );
}

function findWorkerDomain(snapshot, hostname, workerName) {
  return snapshot.worker.domains.find(
    (domain) =>
      domain.hostname === hostname &&
      domain.service === workerName &&
      domain.environment === "production",
  );
}

function findPagesDomain(snapshot, hostname) {
  return snapshot.pages.domains.find((domain) => domain.name === hostname);
}

async function verifyWorkerAttachment(options, domainId) {
  const attached = await probeWorkerDomainAttachment({
    ...options,
    domainId,
  });
  const publicProof = await probeWorkerHealth({
    ...options,
    origin: `https://${options.hostname}`,
    profile: "cutover",
  });
  return { attached, publicProof };
}

async function verifyPagesAttachment(options) {
  const after = await poll(async () => {
    const state = await captureProductionState(options);
    const pages = findPagesDomain(state, options.hostname);
    const worker = findWorkerDomain(
      state,
      options.hostname,
      options.workerName,
    );
    if (worker || pages?.status !== "active") {
      throw new Error("Pages rollback control-plane state is not active.");
    }
    return state;
  }, options);
  const publicProof = await probePagesRestored({
    ...options,
    origin: `https://${options.hostname}`,
  });
  return { after, publicProof };
}

export async function workerResourceExists({
  accountId,
  apiToken,
  fetcher = fetch,
  workerName,
}) {
  const account = endpointPart(accountId, "Cloudflare account");
  const worker = endpointPart(workerName, "Worker name");
  const response = await fetcher(
    `${API_BASE}/accounts/${account}/workers/services/${worker}`,
    {
      headers: {
        Authorization: `Bearer ${required(apiToken, "Cloudflare API token")}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    },
  );
  const payload = await boundedJsonResponse(
    response,
    "Cloudflare Worker lookup",
  );
  if (response.status === 404 && payload?.success === false) return false;
  if (!response.ok || payload?.success !== true) {
    throw cloudflareError(payload, response.status);
  }
  return true;
}

export async function cutoverToWorker(options) {
  const marketingBefore = await marketingDigest(options);
  const snapshot = await captureProductionState(options);
  if (!snapshot.worker.deployment) {
    throw new Error("The production Worker has no active deployment.");
  }
  const pagesDomain = findPagesDomain(snapshot, options.hostname);
  const existingWorkerDomain = findWorkerDomain(
    snapshot,
    options.hostname,
    options.workerName,
  );
  if (pagesDomain && existingWorkerDomain) {
    throw new Error(
      "The production hostname is attached to both Worker and Pages.",
    );
  }
  if (pagesDomain && pagesDomain.status !== "active") {
    throw new Error(
      "The production Pages hostname must be active before cutover.",
    );
  }
  if (existingWorkerDomain?.id) {
    const verified = await verifyWorkerAttachment(
      options,
      existingWorkerDomain.id,
    );
    const marketingAfter = await assertMarketingUnchanged(
      options,
      marketingBefore,
    );
    return {
      ...verified,
      before: snapshot,
      marketing: { after: marketingAfter, before: marketingBefore },
      resumed: true,
    };
  }

  if (pagesDomain) {
    await mutatePagesDomain({ ...options, method: "DELETE" });
  }
  let attached;
  let certified;
  let publicProof;
  let marketingAfter;
  try {
    attached = await attachWorkerDomain(options);
    const verified = await verifyWorkerAttachment(options, attached?.id);
    certified = verified.attached;
    publicProof = verified.publicProof;
    marketingAfter = await assertMarketingUnchanged(options, marketingBefore);
  } catch (error) {
    let attachedDomainId = attached?.id;
    if (!attachedDomainId) {
      const current = await captureProductionState(options).catch(() => null);
      attachedDomainId = current
        ? findWorkerDomain(current, options.hostname, options.workerName)?.id
        : null;
    }
    if (attachedDomainId) {
      await deleteWorkerDomain({
        ...options,
        domainId: attachedDomainId,
      }).catch(() => undefined);
    }
    let restorationError;
    try {
      await mutatePagesDomain({ ...options, method: "POST" });
      await verifyPagesAttachment(options);
      await assertMarketingUnchanged(options, marketingBefore);
    } catch (restoreError) {
      restorationError =
        restoreError instanceof Error ? restoreError.message : "unknown error";
    }
    if (restorationError) {
      throw new Error(
        `Worker custom-domain attachment failed and Pages restoration also failed: ${restorationError}. Attachment error: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    throw new Error(
      `Worker custom-domain attachment failed and Pages was restored: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  return {
    attached: certified,
    before: snapshot,
    marketing: {
      after: marketingAfter,
      before: marketingBefore,
    },
    publicProof,
    resumed: !pagesDomain,
  };
}

export async function restorePages(options) {
  const marketingBefore = await marketingDigest(options);
  const snapshot = await captureProductionState(options);
  const workerDomain = findWorkerDomain(
    snapshot,
    options.hostname,
    options.workerName,
  );
  const pagesDomain = findPagesDomain(snapshot, options.hostname);
  if (workerDomain && pagesDomain) {
    throw new Error(
      "The production hostname is attached to both Worker and Pages.",
    );
  }
  if (pagesDomain) {
    if (pagesDomain.status !== "active") {
      throw new Error("The production Pages hostname is not active.");
    }
    const verified = await verifyPagesAttachment(options);
    return {
      before: snapshot,
      marketing: {
        after: await assertMarketingUnchanged(options, marketingBefore),
        before: marketingBefore,
      },
      restored: true,
      resumed: true,
      ...verified,
    };
  }

  if (workerDomain?.id) {
    await deleteWorkerDomain({ ...options, domainId: workerDomain.id });
  }
  let pagesAttached = false;
  try {
    await mutatePagesDomain({ ...options, method: "POST" });
    pagesAttached = true;
    const verified = await verifyPagesAttachment(options);
    return {
      before: snapshot,
      marketing: {
        after: await assertMarketingUnchanged(options, marketingBefore),
        before: marketingBefore,
      },
      restored: true,
      resumed: !workerDomain,
      ...verified,
    };
  } catch (error) {
    let current;
    let recoveryError;
    try {
      current = await captureProductionState(options);
      const currentPages = findPagesDomain(current, options.hostname);
      if (pagesAttached || currentPages) {
        await mutatePagesDomain({ ...options, method: "DELETE" });
      }
      if (workerDomain?.id) {
        const currentWorker = findWorkerDomain(
          current,
          options.hostname,
          options.workerName,
        );
        const reattached = currentWorker ?? (await attachWorkerDomain(options));
        await verifyWorkerAttachment(options, reattached?.id);
      } else {
        await poll(async () => {
          const restored = await captureProductionState(options);
          if (
            findPagesDomain(restored, options.hostname) ||
            findWorkerDomain(
              restored,
              options.hostname,
              options.workerName,
            )
          ) {
            throw new Error(
              "The previously unowned hostname was not restored.",
            );
          }
          return restored;
        }, options);
      }
      await assertMarketingUnchanged(options, marketingBefore);
    } catch (workerError) {
      recoveryError =
        workerError instanceof Error ? workerError.message : "unknown error";
    }
    if (recoveryError) {
      throw new Error(
        `Pages restoration failed and prior topology recovery also failed: ${recoveryError}. Pages error: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    if (!workerDomain) {
      throw new Error(
        `Pages restoration failed and the prior unowned topology was restored: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    throw new Error(
      `Pages restoration failed and the Worker was fully restored: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}
