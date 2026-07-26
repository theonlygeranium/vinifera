export type FieldErrors = Record<string, string[] | string>;

const BRAND_STORAGE_KEY = "vinifera.active-brand";
const COMMAND_STORAGE_PREFIX = "vinifera.pending-command.";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let nativeAccessTokenProvider: (() => Promise<string | null>) | null = null;
const pendingCommandKeys = new Map<string, string>();

interface ErrorBody {
  error?: {
    code?: string;
    message?: string;
    fieldErrors?: FieldErrors;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: FieldErrors;

  constructor(
    message: string,
    options: { status: number; code?: string; fieldErrors?: FieldErrors },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code ?? "REQUEST_FAILED";
    this.fieldErrors = options.fieldErrors;
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function setNativeAccessTokenProvider(
  provider: (() => Promise<string | null>) | null,
) {
  nativeAccessTokenProvider = provider;
}

export function readActiveBrandId() {
  try {
    const value = window.localStorage.getItem(BRAND_STORAGE_KEY);
    return value && UUID_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeActiveBrandId(brandId: string | null) {
  try {
    if (brandId && UUID_PATTERN.test(brandId)) {
      window.localStorage.setItem(BRAND_STORAGE_KEY, brandId);
    } else {
      window.localStorage.removeItem(BRAND_STORAGE_KEY);
    }
  } catch {
    // Storage is a convenience for a non-sensitive scope preference.
  }
}

function resolveApiUrl(path: `/api/${string}`) {
  if (import.meta.env.VITE_CAPACITOR_BUILD !== "true") return path;
  const configuredOrigin = import.meta.env.VITE_MOBILE_API_ORIGIN?.trim();
  if (!configuredOrigin) {
    throw new ApiError("The native API origin is not configured.", {
      status: 0,
      code: "INVALID_MOBILE_API_ORIGIN",
    });
  }
  const origin = new URL(configuredOrigin);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new ApiError("The native API origin must be a credential-free HTTPS origin.", {
      status: 0,
      code: "INVALID_MOBILE_API_ORIGIN",
    });
  }
  return new URL(path, origin).toString();
}

function isTransactionalCoreCommand(
  method: string,
  path: `/api/${string}`,
): boolean {
  if (
    method === "POST" &&
    (
      path === "/api/club-tiers" ||
      path === "/api/members" ||
      path === "/api/members/batch" ||
      path === "/api/releases" ||
      /^\/api\/club-tiers\/[0-9a-f-]+\/assign$/i.test(path) ||
      /^\/api\/releases\/[0-9a-f-]+\/schedule$/i.test(path) ||
      /^\/api\/shipments\/[0-9a-f-]+\/refund$/i.test(path)
    )
  ) {
    return true;
  }
  if (
    method === "PATCH" &&
    (
      path === "/api/member/profile/address" ||
      /^\/api\/club-tiers\/[0-9a-f-]+$/i.test(path) ||
      /^\/api\/members\/[0-9a-f-]+$/i.test(path) ||
      /^\/api\/releases\/[0-9a-f-]+$/i.test(path)
    )
  ) {
    return true;
  }
  return method === "DELETE" && (
    /^\/api\/club-tiers\/[0-9a-f-]+$/i.test(path) ||
    /^\/api\/members\/[0-9a-f-]+$/i.test(path)
  );
}

async function commandFingerprint(
  method: string,
  path: `/api/${string}`,
  body: BodyInit | null | undefined,
): Promise<string> {
  const source = `${method}:${path}:${typeof body === "string" ? body : ""}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function readPendingCommandKey(fingerprint: string): string | null {
  const memoryKey = pendingCommandKeys.get(fingerprint);
  if (memoryKey) return memoryKey;
  try {
    const stored = window.sessionStorage.getItem(
      `${COMMAND_STORAGE_PREFIX}${fingerprint}`,
    );
    if (stored && UUID_PATTERN.test(stored)) {
      pendingCommandKeys.set(fingerprint, stored);
      return stored;
    }
  } catch {
    // In-memory retry safety remains available when storage is unavailable.
  }
  return null;
}

function retainPendingCommandKey(fingerprint: string, commandId: string): void {
  pendingCommandKeys.set(fingerprint, commandId);
  try {
    window.sessionStorage.setItem(
      `${COMMAND_STORAGE_PREFIX}${fingerprint}`,
      commandId,
    );
  } catch {
    // In-memory retry safety remains available when storage is unavailable.
  }
}

function clearPendingCommandKey(fingerprint: string): void {
  pendingCommandKeys.delete(fingerprint);
  try {
    window.sessionStorage.removeItem(
      `${COMMAND_STORAGE_PREFIX}${fingerprint}`,
    );
  } catch {
    // Nothing else is required after the server reaches a terminal response.
  }
}

export async function apiRequest<T>(
  path: `/api/${string}`,
  options: Omit<RequestInit, "credentials"> = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  const method = (options.method ?? "GET").toUpperCase();
  const transactionalCommand = isTransactionalCoreCommand(method, path);
  const fingerprint = transactionalCommand
    ? await commandFingerprint(method, path, options.body)
    : null;
  if (fingerprint && !headers.has("Idempotency-Key")) {
    const retainedKey = readPendingCommandKey(fingerprint);
    const nextKey = retainedKey ?? crypto.randomUUID();
    retainPendingCommandKey(fingerprint, nextKey);
    headers.set("Idempotency-Key", nextKey);
  }
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");
  const brandId = readActiveBrandId();
  const brandNeutral =
    path.startsWith("/api/auth/") ||
    path.startsWith("/api/member/") ||
    path.startsWith("/api/mobile/") ||
    path.startsWith("/api/portal/") ||
    path.startsWith("/api/brands") ||
    path.startsWith("/api/organization/");
  if (brandId && !brandNeutral) {
    headers.set("X-Vinifera-Brand-Id", brandId);
  }
  const nativeAccessToken = await nativeAccessTokenProvider?.();
  if (nativeAccessToken) {
    headers.set("Authorization", `Bearer ${nativeAccessToken}`);
  }

  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), {
      ...options,
      headers,
      credentials: "include",
    });
  } catch {
    throw new ApiError(
      "Vinifera could not reach the server. Check your connection and try again.",
      { status: 0, code: "NETWORK_ERROR" },
    );
  }

  const payload = await parseResponse(response);
  const retryableResponse =
    response.status >= 500 ||
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429;
  if (fingerprint && !retryableResponse) {
    clearPendingCommandKey(fingerprint);
  }
  if (!response.ok) {
    const errorBody =
      typeof payload === "object" && payload !== null
        ? (payload as ErrorBody)
        : undefined;
    throw new ApiError(
      errorBody?.error?.message ??
        (response.status >= 500
          ? "Vinifera is temporarily unavailable. Please try again."
          : "We could not complete that request."),
      {
        status: response.status,
        code: errorBody?.error?.code,
        fieldErrors: errorBody?.error?.fieldErrors,
      },
    );
  }

  if (
    typeof payload === "object" &&
    payload !== null &&
    "data" in payload
  ) {
    return (payload as { data: T }).data;
  }

  return payload as T;
}

export function postJson<T>(
  path: `/api/${string}`,
  body?: Record<string, unknown>,
) {
  return apiRequest<T>(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function patchJson<T>(
  path: `/api/${string}`,
  body: Record<string, unknown>,
) {
  return apiRequest<T>(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function putJson<T>(
  path: `/api/${string}`,
  body: Record<string, unknown>,
) {
  return apiRequest<T>(path, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteJson<T>(
  path: `/api/${string}`,
  body?: Record<string, unknown>,
) {
  return apiRequest<T>(path, {
    method: "DELETE",
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function downloadApiFile(
  path: `/api/${string}`,
  fallbackName: string,
) {
  const headers = new Headers({
    Accept: "text/csv,application/pdf,application/json",
  });
  const brandId = readActiveBrandId();
  if (brandId) headers.set("X-Vinifera-Brand-Id", brandId);
  const nativeAccessToken = await nativeAccessTokenProvider?.();
  if (nativeAccessToken) {
    headers.set("Authorization", `Bearer ${nativeAccessToken}`);
  }
  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), {
      credentials: "include",
      headers,
    });
  } catch {
    throw new ApiError(
      "Vinifera could not reach the server. Check your connection and try again.",
      { status: 0, code: "NETWORK_ERROR" },
    );
  }

  if (!response.ok) {
    const payload = await parseResponse(response);
    const errorBody =
      typeof payload === "object" && payload !== null
        ? (payload as ErrorBody)
        : undefined;
    throw new ApiError(
      errorBody?.error?.message ?? "The requested export is not available.",
      {
        status: response.status,
        code: errorBody?.error?.code,
        fieldErrors: errorBody?.error?.fieldErrors,
      },
    );
  }

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const fileName = encodedName
    ? decodeURIComponent(encodedName)
    : (plainName ?? fallbackName);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
