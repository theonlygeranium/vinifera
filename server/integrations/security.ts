import {
  createHash,
  timingSafeEqual as nodeTimingSafeEqual,
} from "node:crypto";

import { AppError, requireConfigured } from "../lib/errors";
import type { WorkerEnv } from "../types";

const ENVELOPE_VERSION = 1;
const GCM_IV_BYTES = 12;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const KEY_VERSION = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const EXTERNAL_INTEGRATION_SECRET_REFERENCE =
  /^env:\/\/(VINIFERA_INTEGRATION_SECRET_[A-Z0-9_]{1,96})$/;

export interface CredentialContext {
  integrationType: string;
  organizationId: string;
  targetId: string;
}

export interface EncryptedCredentialEnvelope {
  algorithm: "A256GCM";
  ciphertext: string;
  iv: string;
  keyVersion: string;
  version: 1;
}

export function resolveExternalIntegrationCredentials<T>(
  env: WorkerEnv,
  reference: string | null | undefined,
): T {
  const match =
    typeof reference === "string"
      ? EXTERNAL_INTEGRATION_SECRET_REFERENCE.exec(reference)
      : null;
  if (!match) {
    throw new AppError(
      503,
      "activation_required",
      "The external integration credential reference is invalid.",
    );
  }
  const binding = Reflect.get(env, match[1]!);
  if (
    typeof binding !== "string" ||
    !binding ||
    Buffer.byteLength(binding, "utf8") > 32_768
  ) {
    throw new AppError(
      503,
      "activation_required",
      "The external integration credential binding is unavailable.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(binding);
  } catch {
    throw new AppError(
      503,
      "activation_required",
      "The external integration credential binding is invalid.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(
      503,
      "activation_required",
      "The external integration credential binding is invalid.",
    );
  }
  return parsed as T;
}

function decodeBase64(value: string): Uint8Array {
  try {
    return new Uint8Array(Buffer.from(value, "base64"));
  } catch {
    throw new AppError(
      503,
      "activation_required",
      "The integration credential encryption key is invalid.",
    );
  }
}

function encodeBase64(value: ArrayBuffer | Uint8Array): string {
  return Buffer.from(
    value instanceof Uint8Array ? value : new Uint8Array(value),
  ).toString("base64");
}

function exactBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}

function aad(context: CredentialContext, keyVersion: string): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      integrationType: context.integrationType,
      keyVersion,
      organizationId: context.organizationId,
      purpose: "vinifera-integration-credentials",
      targetId: context.targetId,
      version: ENVELOPE_VERSION,
    }),
  );
}

function credentialKeyring(env: WorkerEnv): {
  activeVersion: string;
  keys: Record<string, Uint8Array>;
} {
  const activeVersion = requireConfigured(
    env.INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION,
    "INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION",
  );
  const rawKeyring = requireConfigured(
    env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEYS,
    "INTEGRATION_CREDENTIAL_ENCRYPTION_KEYS",
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawKeyring);
  } catch {
    throw new AppError(
      503,
      "activation_required",
      "The integration credential encryption keyring is invalid.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(
      503,
      "activation_required",
      "The integration credential encryption keyring is invalid.",
    );
  }
  const keys = Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(
      ([version, value]) => {
        if (!KEY_VERSION.test(version) || typeof value !== "string") {
          throw new AppError(
            503,
            "activation_required",
            "The integration credential encryption keyring is invalid.",
          );
        }
        const decoded = decodeBase64(value);
        if (decoded.byteLength !== 32) {
          throw new AppError(
            503,
            "activation_required",
            "Integration credential encryption keys must be 256 bits.",
          );
        }
        return [version, decoded];
      },
    ),
  );
  if (!keys[activeVersion]) {
    throw new AppError(
      503,
      "activation_required",
      "The active integration credential key version is unavailable.",
    );
  }
  return { activeVersion, keys };
}

export function validateIntegrationCredentialKeyring(env: WorkerEnv): {
  activeVersion: string;
  versions: string[];
} {
  const keyring = credentialKeyring(env);
  return {
    activeVersion: keyring.activeVersion,
    versions: Object.keys(keyring.keys).sort(),
  };
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    exactBytes(raw),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptIntegrationCredentials(
  env: WorkerEnv,
  context: CredentialContext,
  credentials: Record<string, unknown>,
): Promise<EncryptedCredentialEnvelope> {
  const serialized = JSON.stringify(credentials);
  if (Buffer.byteLength(serialized, "utf8") > 32_768) {
    throw new AppError(
      400,
      "invalid_request",
      "Integration credentials exceed the supported size.",
    );
  }
  const { activeVersion, keys } = credentialKeyring(env);
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const key = await importAesKey(keys[activeVersion]!);
  const ciphertext = await crypto.subtle.encrypt(
    {
      additionalData: exactBytes(aad(context, activeVersion)),
      iv: exactBytes(iv),
      name: "AES-GCM",
      tagLength: 128,
    },
    key,
    exactBytes(new TextEncoder().encode(serialized)),
  );
  return {
    algorithm: "A256GCM",
    ciphertext: encodeBase64(ciphertext),
    iv: encodeBase64(iv),
    keyVersion: activeVersion,
    version: ENVELOPE_VERSION,
  };
}

export async function decryptIntegrationCredentials<T>(
  env: WorkerEnv,
  context: CredentialContext,
  envelope: EncryptedCredentialEnvelope,
): Promise<T> {
  if (
    envelope.version !== ENVELOPE_VERSION ||
    envelope.algorithm !== "A256GCM" ||
    !KEY_VERSION.test(envelope.keyVersion)
  ) {
    throw new AppError(
      503,
      "activation_required",
      "The stored integration credential format is unsupported.",
    );
  }
  const { keys } = credentialKeyring(env);
  const rawKey = keys[envelope.keyVersion];
  if (!rawKey) {
    throw new AppError(
      503,
      "activation_required",
      "The stored integration credential key version is unavailable.",
    );
  }
  try {
    const key = await importAesKey(rawKey);
    const plaintext = await crypto.subtle.decrypt(
      {
        additionalData: exactBytes(aad(context, envelope.keyVersion)),
        iv: exactBytes(decodeBase64(envelope.iv)),
        name: "AES-GCM",
        tagLength: 128,
      },
      key,
      exactBytes(decodeBase64(envelope.ciphertext)),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    throw new AppError(
      503,
      "activation_required",
      "The stored integration credentials could not be decrypted.",
    );
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    exactBytes(new TextEncoder().encode(value)),
  );
  return Buffer.from(digest).toString("hex");
}

export function normalizeMetaIdentifier(
  kind:
    | "city"
    | "country"
    | "date_of_birth"
    | "email"
    | "external_id"
    | "first_name"
    | "last_name"
    | "phone"
    | "state"
    | "zip",
  value: string,
): string {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  switch (kind) {
    case "email":
      return normalized;
    case "phone":
      return normalized.replace(/\D/g, "").replace(/^0+/, "");
    case "first_name":
    case "last_name":
    case "city":
      return normalized.replace(/[^\p{L}\p{N}]/gu, "");
    case "state":
    case "country":
    case "zip":
    case "external_id":
      return normalized.replace(/\s+/g, "");
    case "date_of_birth":
      return normalized.replace(/\D/g, "");
  }
}

export async function hashMetaIdentifier(
  kind: Parameters<typeof normalizeMetaIdentifier>[0],
  value: string | null | undefined,
): Promise<string | null> {
  if (!value) return null;
  const normalized = normalizeMetaIdentifier(kind, value);
  if (!normalized) return null;
  return sha256(normalized);
}

export function assertHashedMetaUserData(
  userData: Record<string, unknown>,
): void {
  const hashedKeys = new Set([
    "ct",
    "country",
    "db",
    "em",
    "external_id",
    "fn",
    "ln",
    "ph",
    "st",
    "zp",
  ]);
  for (const [key, value] of Object.entries(userData)) {
    if (!hashedKeys.has(key)) {
      throw new AppError(
        400,
        "invalid_request",
        `Unsupported Meta user-data field: ${key}.`,
      );
    }
    const values = Array.isArray(value) ? value : [value];
    if (
      values.some(
        (candidate) =>
          typeof candidate !== "string" || !SHA256_HEX.test(candidate),
      )
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "Meta user data must be normalized and SHA-256 hashed before serialization.",
      );
    }
  }
}

export async function hmacSha256Hex(
  secret: string,
  value: Uint8Array,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    exactBytes(new TextEncoder().encode(secret)),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, exactBytes(value));
  return Buffer.from(signature).toString("hex");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  const subtleTimingSafeEqual = (
    crypto.subtle as SubtleCrypto & {
      timingSafeEqual?: (
        left: ArrayBufferView,
        right: ArrayBufferView,
      ) => boolean;
    }
  ).timingSafeEqual;
  if (typeof subtleTimingSafeEqual === "function") {
    return subtleTimingSafeEqual.call(crypto.subtle, leftDigest, rightDigest);
  }
  // Node 22 does not expose the Workers-only SubtleCrypto extension used in
  // production, so local Vitest uses the equivalent fixed-size primitive.
  return nodeTimingSafeEqual(leftDigest, rightDigest);
}
