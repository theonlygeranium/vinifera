import { createHash } from "node:crypto";

const API_BASE = "https://api.cloudflare.com/client/v4";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      `Cloudflare control-plane response was not JSON (HTTP ${response.status}).`,
    );
  }
  if (!response.ok || payload?.success !== true) {
    throw cloudflareError(payload, response.status);
  }
  return payload.result;
}

function workerDomainSummary(domain) {
  const certificateId = String(domain?.cert_id ?? "");
  return {
    certificateIdSha256: UUID.test(certificateId)
      ? createHash("sha256").update(certificateId).digest("hex")
      : null,
    certificatePresent: UUID.test(certificateId),
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
  const productionDeployment = Array.isArray(pagesDeployments)
    ? pagesDeployments[0]
    : null;
  if (!productionDeployment) {
    throw new Error(
      "The Pages project has no production deployment to restore.",
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

export async function probeWorkerHealth({
  attempts,
  delayMs,
  fetcher = fetch,
  origin,
  policy,
  profile = "core",
  sleep,
}) {
  return poll(
    async () => {
      const [healthResponse, configurationResponse] = await Promise.all([
        fetcher(new URL("/api/health", origin)),
        fetcher(new URL("/api/health/configuration", origin)),
      ]);
      if (!healthResponse.ok || !configurationResponse.ok) {
        throw new Error("Worker health endpoints are not ready.");
      }
      const [health, configuration] = await Promise.all([
        healthResponse.json(),
        configurationResponse.json(),
      ]);
      if (
        health?.data?.service !== "vinifera-api" ||
        health?.data?.status !== "ok"
      ) {
        throw new Error(
          "Worker health response is not the Vinifera API contract.",
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
      return { configuration, health };
    },
    { attempts, delayMs, sleep },
  );
}

export async function probeWorkerDomainCertificate({
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
        domain?.zone_id !== zoneId ||
        !UUID.test(String(domain?.cert_id ?? ""))
      ) {
        throw new Error(
          "Worker custom-domain certificate is not ready for the allowlisted target.",
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
  sleep,
}) {
  return poll(
    async () => {
      const [root, app] = await Promise.all([
        fetcher(new URL("/", origin)),
        fetcher(new URL("/app/", origin)),
      ]);
      if (!root.ok || !app.ok) {
        throw new Error("Pages rollback routes are not ready.");
      }
      const [rootText, appText] = await Promise.all([root.text(), app.text()]);
      if (
        !rootText.includes("Vinifera") ||
        !appText.includes("Fall 2026 Club Release")
      ) {
        throw new Error("Pages rollback content contract did not match.");
      }
      return { appStatus: app.status, rootStatus: root.status };
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
    },
  );
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      `Cloudflare Worker lookup was not JSON (HTTP ${response.status}).`,
    );
  }
  if (response.status === 404 && payload?.success === false) return false;
  if (!response.ok || payload?.success !== true) {
    throw cloudflareError(payload, response.status);
  }
  return true;
}

export async function cutoverToWorker(options) {
  const snapshot = await captureProductionState(options);
  if (!snapshot.worker.deployment) {
    throw new Error("The production Worker has no active deployment.");
  }
  const pagesDomain = findPagesDomain(snapshot, options.hostname);
  if (!pagesDomain) {
    throw new Error(
      "The production hostname is not attached to the Pages project.",
    );
  }
  if (pagesDomain.status !== "active") {
    throw new Error(
      "The production Pages hostname must be active before cutover.",
    );
  }
  if (findWorkerDomain(snapshot, options.hostname, options.workerName)) {
    throw new Error(
      "The production hostname is already attached to the Worker.",
    );
  }

  await mutatePagesDomain({ ...options, method: "DELETE" });
  let attached;
  let certified;
  try {
    attached = await attachWorkerDomain(options);
    certified = await probeWorkerDomainCertificate({
      ...options,
      domainId: attached?.id,
    });
    await probeWorkerHealth({
      ...options,
      origin: `https://${options.hostname}`,
      profile: "cutover",
    });
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
      await probePagesRestored({
        ...options,
        origin: `https://${options.hostname}`,
      });
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
  return { attached: certified, before: snapshot };
}

export async function restorePages(options) {
  const snapshot = await captureProductionState(options);
  const workerDomain = findWorkerDomain(
    snapshot,
    options.hostname,
    options.workerName,
  );
  if (!workerDomain?.id) {
    throw new Error(
      "The production hostname is not attached to the allowlisted Worker.",
    );
  }
  if (findPagesDomain(snapshot, options.hostname)) {
    throw new Error(
      "The production hostname is already attached to the Pages project.",
    );
  }

  await deleteWorkerDomain({ ...options, domainId: workerDomain.id });
  let pagesAttached = false;
  try {
    await mutatePagesDomain({ ...options, method: "POST" });
    pagesAttached = true;
    await probePagesRestored({
      ...options,
      origin: `https://${options.hostname}`,
    });
  } catch (error) {
    if (pagesAttached) {
      await mutatePagesDomain({ ...options, method: "DELETE" }).catch(
        () => undefined,
      );
    }
    await attachWorkerDomain(options).catch(() => undefined);
    throw new Error(
      `Pages restoration failed and Worker reattachment was attempted: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  return { before: snapshot, restored: true };
}
