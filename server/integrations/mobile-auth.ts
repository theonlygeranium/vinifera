import { AppError } from "../lib/errors";
import type { WorkerEnv } from "../types";
import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
} from "./security";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESS_PREFIX = "vma1";

export interface MobileAccessIdentity {
  authUserId: string;
  brandId: string;
  deviceId: string;
  expiresAt: string;
  memberId: string;
  organizationId: string;
  sessionId: string;
}

export async function issueMobileAccessToken(
  env: WorkerEnv,
  input: Omit<MobileAccessIdentity, "expiresAt"> & {
    expiresAt?: string;
  },
): Promise<{ accessToken: string; expiresAt: string }> {
  const expiresAt =
    input.expiresAt ??
    new Date(Date.now() + 15 * 60 * 1_000).toISOString();
  const envelope = await encryptIntegrationCredentials(
    env,
    {
      integrationType: "mobile_access",
      organizationId: input.organizationId,
      targetId: input.sessionId,
    },
    { ...input, expiresAt },
  );
  const encoded = Buffer.from(JSON.stringify(envelope), "utf8").toString(
    "base64url",
  );
  return {
    accessToken: `${ACCESS_PREFIX}.${input.sessionId}.${encoded}`,
    expiresAt,
  };
}

export async function verifyMobileAccessTokenForOrganization(
  env: WorkerEnv,
  token: string,
  organizationId: string,
): Promise<MobileAccessIdentity> {
  const [prefix, sessionId, encoded, extra] = token.split(".");
  if (
    prefix !== ACCESS_PREFIX ||
    !sessionId ||
    !UUID.test(sessionId) ||
    !encoded ||
    extra
  ) {
    throw new AppError(401, "unauthorized", "The mobile access token is invalid.");
  }
  let envelope: Parameters<typeof decryptIntegrationCredentials>[2];
  try {
    envelope = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Parameters<typeof decryptIntegrationCredentials>[2];
  } catch {
    throw new AppError(401, "unauthorized", "The mobile access token is invalid.");
  }
  const identity = await decryptIntegrationCredentials<MobileAccessIdentity>(
    env,
    {
      integrationType: "mobile_access",
      organizationId,
      targetId: sessionId,
    },
    envelope,
  ).catch(() => {
    throw new AppError(401, "unauthorized", "The mobile access token is invalid.");
  });
  if (
    identity.sessionId !== sessionId ||
    identity.organizationId !== organizationId ||
    !UUID.test(identity.memberId) ||
    !UUID.test(identity.brandId) ||
    !UUID.test(identity.authUserId) ||
    !UUID.test(identity.deviceId) ||
    Date.parse(identity.expiresAt) <= Date.now()
  ) {
    throw new AppError(401, "unauthorized", "The mobile access token is invalid.");
  }
  return identity;
}

export function mobileAccessSessionId(token: string): string | null {
  const [prefix, sessionId] = token.split(".");
  return prefix === ACCESS_PREFIX && sessionId && UUID.test(sessionId)
    ? sessionId
    : null;
}
