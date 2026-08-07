import { createHash, createSign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const identity = JSON.parse(
  await readFile(
    new URL("../mobile/app-identity.json", import.meta.url),
    "utf8",
  ),
);
const productionPolicy = JSON.parse(
  await readFile(
    new URL("../config/production-release-policy.json", import.meta.url),
    "utf8",
  ),
);

const APP_ID = identity.appId;
const FINAL_PRODUCTION_ORIGIN = "https://vinifera-live.edstratumlabs.ai";
const BUILD_CONFIRMATION = "BUILD SIGNED VINIFERA MOBILE RELEASE";
const UPLOAD_CONFIRMATION = "UPLOAD VINIFERA MOBILE INTERNAL TRACKS";
const PLAY_TRACK = "internal";
const GOOGLE_OAUTH_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_PLAY_API_ROOT =
  "https://androidpublisher.googleapis.com/androidpublisher/v3";
const GOOGLE_PLAY_UPLOAD_ROOT =
  "https://androidpublisher.googleapis.com/upload/androidpublisher/v3";
const GOOGLE_PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

const SECRET_FILES = Object.freeze({
  "android-keystore": {
    environmentName: "MOBILE_ANDROID_KEYSTORE_BASE64",
    minimumBytes: 32,
  },
  "ios-certificate": {
    environmentName: "MOBILE_IOS_DISTRIBUTION_CERTIFICATE_BASE64",
    minimumBytes: 32,
  },
  "ios-profile": {
    environmentName: "MOBILE_IOS_APP_STORE_PROFILE_BASE64",
    minimumBytes: 32,
  },
  "app-store-key": {
    environmentName: "APP_STORE_CONNECT_API_PRIVATE_KEY_BASE64",
    minimumBytes: 64,
    validate(contents) {
      const text = contents.toString("utf8");
      return (
        text.startsWith("-----BEGIN PRIVATE KEY-----") &&
        text.trimEnd().endsWith("-----END PRIVATE KEY-----")
      );
    },
  },
});

export const mobileReleaseConstants = Object.freeze({
  appId: APP_ID,
  buildConfirmation: BUILD_CONFIRMATION,
  googleOAuthEndpoint: GOOGLE_OAUTH_ENDPOINT,
  googlePlayApiRoot: GOOGLE_PLAY_API_ROOT,
  googlePlayScope: GOOGLE_PLAY_SCOPE,
  googlePlayUploadRoot: GOOGLE_PLAY_UPLOAD_ROOT,
  playTrack: PLAY_TRACK,
  productionOrigin: FINAL_PRODUCTION_ORIGIN,
  uploadConfirmation: UPLOAD_CONFIRMATION,
});

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function requireNames(env, names) {
  const missing = names.filter((name) => !hasValue(env[name]));
  if (missing.length > 0) {
    throw new Error(
      `Missing required mobile release secrets: ${missing.join(", ")}.`,
    );
  }
}

async function boundedMobileJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (
    !response.ok ||
    (response.url && new URL(response.url).origin !== url.origin)
  ) {
    throw new Error("Pre-cutover production Worker route is unavailable.");
  }
  const maximumBytes = 64 * 1024;
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(
      "Pre-cutover production Worker response exceeded its limit.",
    );
  }
  const reader = response.body?.getReader?.();
  const chunks = [];
  let length = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new Error(
          "Pre-cutover production Worker response exceeded its limit.",
        );
      }
      chunks.push(Buffer.from(value));
    }
  } else {
    const value = Buffer.from(await response.arrayBuffer());
    length = value.byteLength;
    chunks.push(value);
  }
  if (length > maximumBytes) {
    throw new Error(
      "Pre-cutover production Worker response exceeded its limit.",
    );
  }
  const bytes = Buffer.concat(chunks, length);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Pre-cutover production Worker route did not return JSON.");
  }
}

export async function verifyPrecutoverProductionOrigin({
  env,
  fetchImpl = fetch,
  platform,
}) {
  const origin = new URL(env.VITE_MOBILE_API_ORIGIN);
  validateReleaseEnvironment({
    action: env.MOBILE_RELEASE_ACTION,
    env,
    platform,
  });
  const health = await boundedMobileJson(
    fetchImpl,
    new URL("/api/health", origin),
  );
  if (
    health?.data?.environment !== "production" ||
    health?.data?.revision !== env.MOBILE_RELEASE_GIT_SHA ||
    health?.data?.service !== "vinifera-api" ||
    health?.data?.status !== "ok"
  ) {
    throw new Error("Pre-cutover production Worker revision is not exact.");
  }
  const associationPath =
    platform === "ios"
      ? "/.well-known/apple-app-site-association"
      : "/.well-known/assetlinks.json";
  const association = await boundedMobileJson(
    fetchImpl,
    new URL(associationPath, origin),
  );
  if (platform === "ios") {
    const appId = `${env.MOBILE_APPLE_TEAM_ID}.${env.MOBILE_IOS_BUNDLE_ID}`;
    const expected = {
      applinks: {
        details: [
          {
            appIDs: [appId],
            components: identity.externalDeepLinkPaths.map((path) => ({
              "/": path,
            })),
          },
        ],
      },
    };
    if (JSON.stringify(association) !== JSON.stringify(expected)) {
      throw new Error(
        "Apple association does not match the signed mobile identity.",
      );
    }
  } else {
    const expected = [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: env.MOBILE_ANDROID_PACKAGE_NAME,
          sha256_cert_fingerprints: [
            env.MOBILE_ANDROID_SIGNING_CERT_SHA256.toUpperCase(),
          ],
        },
      },
    ];
    if (JSON.stringify(association) !== JSON.stringify(expected)) {
      throw new Error(
        "Android association does not match the signed mobile identity.",
      );
    }
  }
  return {
    associationVerified: true,
    evidenceLevel: "production-precutover-worker",
    platform,
    revision: env.MOBILE_RELEASE_GIT_SHA,
    runtimeVerified: true,
  };
}

export function validateReleaseRequest({
  action,
  buildConfirmation,
  gitSha,
  uploadConfirmation,
}) {
  if (!/^[0-9a-f]{40}$/.test(gitSha ?? "")) {
    throw new Error(
      "The mobile release git SHA must be 40 lowercase hex characters.",
    );
  }
  if (!["build-only", "upload-internal"].includes(action)) {
    throw new Error(
      "MOBILE_RELEASE_ACTION must be build-only or upload-internal.",
    );
  }
  if (buildConfirmation !== BUILD_CONFIRMATION) {
    throw new Error("The signed mobile build confirmation is not exact.");
  }
  if (
    action === "upload-internal" &&
    uploadConfirmation !== UPLOAD_CONFIRMATION
  ) {
    throw new Error("The internal-track upload confirmation is not exact.");
  }
  if (action === "build-only" && hasValue(uploadConfirmation)) {
    throw new Error(
      "Build-only runs must leave the upload confirmation empty.",
    );
  }
  return { action, uploadAuthorized: action === "upload-internal" };
}

export function validateReleaseEnvironment({ action, env, platform }) {
  validateReleaseRequest({
    action,
    buildConfirmation: env.MOBILE_BUILD_CONFIRMATION,
    gitSha: env.MOBILE_RELEASE_GIT_SHA,
    uploadConfirmation: env.MOBILE_UPLOAD_CONFIRMATION,
  });

  if (
    env.MOBILE_BUILD_PROFILE !== "production-precutover" ||
    env.MOBILE_PRODUCTION_ORIGIN_AUTHORIZED !== "true" ||
    !productionPolicy.targetHashes.workerOriginSha256.includes(
      createHash("sha256")
        .update(
          String(env.VITE_MOBILE_API_ORIGIN ?? "")
            .trim()
            .toLowerCase(),
        )
        .digest("hex"),
    )
  ) {
    throw new Error(
      "The mobile release must use the exact allowlisted pre-cutover production Worker origin.",
    );
  }

  if (platform === "android") {
    requireNames(env, [
      "MOBILE_ANDROID_KEYSTORE_BASE64",
      "MOBILE_ANDROID_KEYSTORE_PASSWORD",
      "MOBILE_ANDROID_KEY_ALIAS",
      "MOBILE_ANDROID_KEY_PASSWORD",
      "MOBILE_ANDROID_PACKAGE_NAME",
      "MOBILE_ANDROID_SIGNING_CERT_SHA256",
      "MOBILE_GOOGLE_SERVICES_JSON_BASE64",
    ]);
    if (env.MOBILE_ANDROID_PACKAGE_NAME !== APP_ID) {
      throw new Error("The Android release package name does not match.");
    }
    if (
      !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/i.test(
        env.MOBILE_ANDROID_SIGNING_CERT_SHA256,
      )
    ) {
      throw new Error(
        "MOBILE_ANDROID_SIGNING_CERT_SHA256 must be a colon-delimited SHA-256 fingerprint.",
      );
    }
    if (action === "upload-internal") {
      requireNames(env, ["GOOGLE_PLAY_RELEASE_SERVICE_ACCOUNT_JSON_BASE64"]);
    }
    return { appId: APP_ID, platform };
  }

  if (platform === "ios") {
    requireNames(env, [
      "MOBILE_APPLE_TEAM_ID",
      "MOBILE_IOS_APP_STORE_PROFILE_BASE64",
      "MOBILE_IOS_BUNDLE_ID",
      "MOBILE_IOS_DISTRIBUTION_CERTIFICATE_BASE64",
      "MOBILE_IOS_DISTRIBUTION_CERTIFICATE_PASSWORD",
    ]);
    if (!/^[A-Z0-9]{10}$/.test(env.MOBILE_APPLE_TEAM_ID)) {
      throw new Error("The Apple team ID must be exactly 10 characters.");
    }
    if (env.MOBILE_IOS_BUNDLE_ID !== APP_ID) {
      throw new Error("The iOS release bundle ID does not match.");
    }
    if (action === "upload-internal") {
      requireNames(env, [
        "APP_STORE_CONNECT_API_KEY_ID",
        "APP_STORE_CONNECT_API_PRIVATE_KEY_BASE64",
        "APP_STORE_CONNECT_ISSUER_ID",
      ]);
      if (
        !/^[A-Z0-9]{10}$/.test(env.APP_STORE_CONNECT_API_KEY_ID) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          env.APP_STORE_CONNECT_ISSUER_ID,
        )
      ) {
        throw new Error(
          "The App Store Connect team API key identifiers are invalid.",
        );
      }
    }
    return { appId: APP_ID, platform };
  }

  throw new Error("MOBILE_RELEASE_PLATFORM must be android or ios.");
}

function decodeBase64Secret(value, label) {
  if (!hasValue(value)) {
    throw new Error(`${label} is missing.`);
  }
  const compact = value.replace(/\s+/g, "");
  if (compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new Error(`${label} is not valid base64.`);
  }
  const contents = Buffer.from(compact, "base64");
  if (contents.length === 0) {
    throw new Error(`${label} decoded to an empty value.`);
  }
  return contents;
}

async function writePrivateFile(path, contents) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
  await writeFile(absolutePath, contents, { mode: 0o600 });
}

export async function materializeSecretFile({ env, kind, outputPath }) {
  const definition = SECRET_FILES[kind];
  if (!definition) {
    throw new Error("Unsupported mobile secret file kind.");
  }
  const contents = decodeBase64Secret(
    env[definition.environmentName],
    definition.environmentName,
  );
  if (
    contents.length < definition.minimumBytes ||
    (definition.validate && !definition.validate(contents))
  ) {
    throw new Error(
      `${definition.environmentName} has an invalid release format.`,
    );
  }
  await writePrivateFile(outputPath, contents);
}

export async function materializeGoogleServices({ encoded, outputPath }) {
  const contents = decodeBase64Secret(
    encoded,
    "MOBILE_GOOGLE_SERVICES_JSON_BASE64",
  );
  let configuration;
  try {
    configuration = JSON.parse(contents.toString("utf8"));
  } catch {
    throw new Error(
      "MOBILE_GOOGLE_SERVICES_JSON_BASE64 does not contain JSON.",
    );
  }
  const clients = Array.isArray(configuration.client)
    ? configuration.client
    : [];
  const packageMatches = clients.some(
    (client) =>
      client?.client_info?.android_client_info?.package_name === APP_ID,
  );
  if (!hasValue(configuration?.project_info?.project_id) || !packageMatches) {
    throw new Error(
      "The Google services configuration does not match the release app.",
    );
  }
  await writePrivateFile(outputPath, `${JSON.stringify(configuration)}\n`);
}

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function iosExportOptions({ bundleId, profileUuid, teamId }) {
  if (bundleId !== APP_ID) {
    throw new Error("The iOS export bundle ID does not match.");
  }
  if (!/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new Error("The iOS export team ID is invalid.");
  }
  if (!/^[0-9A-F-]{36}$/i.test(profileUuid)) {
    throw new Error("The iOS provisioning profile UUID is invalid.");
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key>
  <string>export</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>method</key>
  <string>app-store-connect</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>${xmlEscape(bundleId)}</key>
    <string>${xmlEscape(profileUuid)}</string>
  </dict>
  <key>signingCertificate</key>
  <string>Apple Distribution</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>teamID</key>
  <string>${xmlEscape(teamId)}</string>
  <key>testFlightInternalTestingOnly</key>
  <true/>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
`;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function validateServiceAccount(serviceAccount) {
  if (
    serviceAccount?.type !== "service_account" ||
    !/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(
      serviceAccount.client_email ?? "",
    ) ||
    !hasValue(serviceAccount.private_key) ||
    !serviceAccount.private_key.startsWith(
      ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
    )
  ) {
    throw new Error("The Google Play release service account is invalid.");
  }
}

function createServiceAccountAssertion(serviceAccount, now) {
  validateServiceAccount(serviceAccount);
  const issuedAt = Math.floor(now.getTime() / 1000) - 30;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      aud: GOOGLE_OAUTH_ENDPOINT,
      exp: issuedAt + 3_600,
      iat: issuedAt,
      iss: serviceAccount.client_email,
      scope: GOOGLE_PLAY_SCOPE,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${signer
    .sign(serviceAccount.private_key)
    .toString("base64url")}`;
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Provider bodies are intentionally excluded from all release output.
  }
}

async function responseJson(response, stage) {
  if (!response.ok) {
    await cancelResponseBody(response);
    throw new Error(`${stage} failed.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${stage} returned an invalid response.`);
  }
}

async function googleAccessToken({ fetchImpl, now, serviceAccount }) {
  const assertion = createServiceAccountAssertion(serviceAccount, now);
  let response;
  try {
    response = await fetchImpl(GOOGLE_OAUTH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        assertion,
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      }),
      redirect: "error",
    });
  } catch {
    throw new Error("Google OAuth authentication failed.");
  }
  const payload = await responseJson(response, "Google OAuth authentication");
  if (!hasValue(payload.access_token)) {
    throw new Error("Google OAuth authentication returned no token.");
  }
  return payload.access_token;
}

async function playRequest({ body, fetchImpl, method, stage, token, url }) {
  let response;
  try {
    const hasBody = body !== null && body !== undefined;
    response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(hasBody
          ? Buffer.isBuffer(body)
            ? { "Content-Type": "application/octet-stream" }
            : { "Content-Type": "application/json" }
          : {}),
      },
      body: hasBody
        ? Buffer.isBuffer(body)
          ? body
          : JSON.stringify(body)
        : undefined,
      redirect: "error",
    });
  } catch {
    throw new Error(`${stage} failed.`);
  }
  return responseJson(response, stage);
}

export async function uploadGooglePlayInternal({
  aabBytes,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  serviceAccount,
  tokenProvider = googleAccessToken,
}) {
  if (!Buffer.isBuffer(aabBytes) || aabBytes.length < 32) {
    throw new Error("The signed Android App Bundle is missing or invalid.");
  }
  validateServiceAccount(serviceAccount);
  const token = await tokenProvider({
    fetchImpl,
    now,
    serviceAccount,
  });
  if (!hasValue(token)) {
    throw new Error("Google OAuth authentication returned no token.");
  }

  const packagePath = encodeURIComponent(APP_ID);
  const edit = await playRequest({
    body: {},
    fetchImpl,
    method: "POST",
    stage: "Google Play edit creation",
    token,
    url: `${GOOGLE_PLAY_API_ROOT}/applications/${packagePath}/edits`,
  });
  if (!hasValue(edit.id)) {
    throw new Error("Google Play edit creation returned no edit.");
  }
  const editPath = encodeURIComponent(edit.id);

  const bundle = await playRequest({
    body: aabBytes,
    fetchImpl,
    method: "POST",
    stage: "Google Play bundle upload",
    token,
    url:
      `${GOOGLE_PLAY_UPLOAD_ROOT}/applications/${packagePath}` +
      `/edits/${editPath}/bundles?uploadType=media`,
  });
  const versionCode = String(bundle.versionCode ?? "");
  if (!/^[1-9][0-9]*$/.test(versionCode)) {
    throw new Error("Google Play bundle upload returned no release version.");
  }

  await playRequest({
    body: {
      releases: [
        {
          status: "completed",
          versionCodes: [versionCode],
        },
      ],
      track: PLAY_TRACK,
    },
    fetchImpl,
    method: "PUT",
    stage: "Google Play internal track update",
    token,
    url:
      `${GOOGLE_PLAY_API_ROOT}/applications/${packagePath}` +
      `/edits/${editPath}/tracks/${PLAY_TRACK}`,
  });

  await playRequest({
    body: null,
    fetchImpl,
    method: "POST",
    stage: "Google Play edit commit",
    token,
    url:
      `${GOOGLE_PLAY_API_ROOT}/applications/${packagePath}` +
      `/edits/${editPath}:commit` +
      "?changesInReviewBehavior=ERROR_IF_IN_REVIEW",
  });

  return {
    bundleUploaded: true,
    committed: true,
    track: PLAY_TRACK,
    trackUpdated: true,
  };
}

function normalizedOutcome(value) {
  return ["success", "failure", "skipped", "cancelled"].includes(value)
    ? value
    : "unknown";
}

export function sanitizedEvidence({
  action,
  buildOutcome,
  gitSha,
  platform,
  uploadOutcome,
  verificationOutcome,
}) {
  if (!["android", "ios"].includes(platform)) {
    throw new Error("Evidence platform must be android or ios.");
  }
  if (!["build-only", "upload-internal"].includes(action)) {
    throw new Error("Evidence action is invalid.");
  }
  if (!/^[0-9a-f]{40}$/.test(gitSha ?? "")) {
    throw new Error("Evidence git SHA is invalid.");
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    gitSha,
    platform,
    readOnlyEvidence: true,
    releaseAction: action,
    signedBuild: normalizedOutcome(buildOutcome) === "success",
    signatureVerified: normalizedOutcome(verificationOutcome) === "success",
    upload: {
      requested: action === "upload-internal",
      result: normalizedOutcome(uploadOutcome),
      target:
        platform === "android"
          ? "google-play-internal"
          : "testflight-internal-only",
    },
  };
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Mobile release arguments are invalid.");
    }
    options[key.slice(2)] = value;
  }
  return { command, options };
}

async function parseServiceAccount(encoded) {
  const decoded = decodeBase64Secret(
    encoded,
    "GOOGLE_PLAY_RELEASE_SERVICE_ACCOUNT_JSON_BASE64",
  );
  try {
    return JSON.parse(decoded.toString("utf8"));
  } catch {
    throw new Error("The Google Play release service account is not JSON.");
  }
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));

  if (command === "validate-request") {
    validateReleaseRequest({
      action: process.env.MOBILE_RELEASE_ACTION,
      buildConfirmation: process.env.MOBILE_BUILD_CONFIRMATION,
      gitSha: process.env.MOBILE_RELEASE_GIT_SHA,
      uploadConfirmation: process.env.MOBILE_UPLOAD_CONFIRMATION,
    });
    return;
  }

  if (command === "validate-environment") {
    validateReleaseEnvironment({
      action: process.env.MOBILE_RELEASE_ACTION,
      env: process.env,
      platform: options.platform,
    });
    return;
  }

  if (command === "verify-precutover-origin") {
    const evidence = await verifyPrecutoverProductionOrigin({
      env: process.env,
      platform: options.platform,
    });
    await writePrivateFile(
      options.output,
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    return;
  }

  if (command === "write-secret-file") {
    await materializeSecretFile({
      env: process.env,
      kind: options.kind,
      outputPath: options.output,
    });
    return;
  }

  if (command === "write-google-services") {
    await materializeGoogleServices({
      encoded: process.env.MOBILE_GOOGLE_SERVICES_JSON_BASE64,
      outputPath: options.output,
    });
    return;
  }

  if (command === "write-ios-export-options") {
    const contents = iosExportOptions({
      bundleId: process.env.MOBILE_IOS_BUNDLE_ID,
      profileUuid: process.env.MOBILE_IOS_PROFILE_UUID,
      teamId: process.env.MOBILE_APPLE_TEAM_ID,
    });
    await writePrivateFile(options.output, contents);
    return;
  }

  if (command === "upload-google-play") {
    const [aabBytes, serviceAccount] = await Promise.all([
      readFile(resolve(options.aab)),
      parseServiceAccount(
        process.env.GOOGLE_PLAY_RELEASE_SERVICE_ACCOUNT_JSON_BASE64,
      ),
    ]);
    await uploadGooglePlayInternal({
      aabBytes,
      serviceAccount,
    });
    return;
  }

  if (command === "write-evidence") {
    const evidence = sanitizedEvidence({
      action: options.action,
      buildOutcome: options.build,
      gitSha: options["git-sha"],
      platform: options.platform,
      uploadOutcome: options.upload,
      verificationOutcome: options.verification,
    });
    await writePrivateFile(
      options.output,
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    return;
  }

  throw new Error("Unsupported mobile release command.");
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch(() => {
    console.error("Mobile release operation failed.");
    process.exitCode = 1;
  });
}
