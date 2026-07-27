export type FieldErrors = Record<string, string[] | string>;

const BRAND_STORAGE_KEY = "vinifera.active-brand";
const COMMAND_STORAGE_PREFIX = "vinifera.pending-command.";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let nativeAccessTokenProvider: (() => Promise<string | null>) | null = null;
let authCommandScope: {
  brandId: string | null;
  organizationId: string | null;
  subjectId: string;
} | null = null;
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

function isTransactionalCommand(
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
      path === "/api/member/cancel-flow" ||
      path === "/api/member/cancel-flow/events" ||
      path === "/api/member/loyalty/redeem" ||
      /^\/api\/club-tiers\/[0-9a-f-]+\/assign$/i.test(path) ||
      /^\/api\/loyalty\/members\/[0-9a-f-]+\/adjust$/i.test(path) ||
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

function isBrandNeutralPath(path: `/api/${string}`): boolean {
  return (
    path.startsWith("/api/auth/") ||
    path.startsWith("/api/member/") ||
    path.startsWith("/api/mobile/") ||
    path.startsWith("/api/portal/") ||
    path.startsWith("/api/brands") ||
    path.startsWith("/api/organization/")
  );
}

function updateAuthTenantScope(
  path: `/api/${string}`,
  payload: unknown,
  responseOk: boolean,
): void {
  if (!responseOk) return;
  if (
    path === "/api/auth/staff/logout" ||
    path === "/api/auth/member/logout" ||
    path === "/api/auth/member/mobile/logout"
  ) {
    authCommandScope = null;
    return;
  }
  if (
    path !== "/api/auth/staff/session" &&
    path !== "/api/auth/member/session"
  ) {
    return;
  }
  const unwrapped =
    payload &&
    typeof payload === "object" &&
    "data" in payload
      ? (payload as { data: unknown }).data
      : payload;
  if (!unwrapped || typeof unwrapped !== "object") {
    authCommandScope = null;
    return;
  }
  const session = unwrapped as {
    authenticated?: unknown;
    brand?: { id?: unknown } | null;
    organization?: { id?: unknown } | null;
    user?: { id?: unknown } | null;
  };
  const brandId = session.brand?.id;
  const organizationId = session.organization?.id;
  const subjectId = session.user?.id;
  authCommandScope =
    session.authenticated === true &&
    typeof subjectId === "string" &&
    UUID_PATTERN.test(subjectId)
      ? {
          brandId:
            typeof brandId === "string" && UUID_PATTERN.test(brandId)
              ? brandId
              : null,
          organizationId:
            typeof organizationId === "string" &&
            UUID_PATTERN.test(organizationId)
              ? organizationId
              : null,
          subjectId,
        }
      : null;
}

function commandScope(
  brandNeutral: boolean,
  activeBrandId: string | null,
): string {
  const authScope = authCommandScope
    ? `tenant:${authCommandScope.organizationId ?? "platform"}:subject:${authCommandScope.subjectId}:session-brand:${authCommandScope.brandId ?? "none"}`
    : "tenant:auth-session:subject:unknown:session-brand:unknown";
  return brandNeutral
    ? authScope
    : `${authScope}:active-brand:${activeBrandId ?? "default"}`;
}

async function commandFingerprint(
  scope: string,
  method: string,
  path: `/api/${string}`,
  body: BodyInit | null | undefined,
): Promise<string> {
  let bodyForFingerprint = typeof body === "string" ? body : "";
  if (bodyForFingerprint) {
    try {
      const parsed = JSON.parse(bodyForFingerprint) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        "idempotencyKey" in parsed
      ) {
        const canonical = { ...(parsed as Record<string, unknown>) };
        delete canonical.idempotencyKey;
        bodyForFingerprint = JSON.stringify(canonical);
      }
    } catch {
      // Non-JSON request bodies are fingerprinted exactly as supplied.
    }
  }
  const source = `${scope}:${method}:${path}:${bodyForFingerprint}`;
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
  const brandId = readActiveBrandId();
  const brandNeutral = isBrandNeutralPath(path);
  const transactionalCommand = isTransactionalCommand(method, path);
  const fingerprintScope = commandScope(brandNeutral, brandId);
  const fingerprint = transactionalCommand
    ? await commandFingerprint(fingerprintScope, method, path, options.body)
    : null;
  let requestBody = options.body;
  if (fingerprint && !headers.has("Idempotency-Key")) {
    const retainedKey = readPendingCommandKey(fingerprint);
    let bodyKey: string | null = null;
    if (typeof requestBody === "string") {
      try {
        const parsed = JSON.parse(requestBody) as unknown;
        if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          typeof (parsed as Record<string, unknown>).idempotencyKey === "string" &&
          UUID_PATTERN.test(
            (parsed as Record<string, unknown>).idempotencyKey as string,
          )
        ) {
          bodyKey = (parsed as Record<string, unknown>).idempotencyKey as string;
        }
      } catch {
        // The generated header still protects non-JSON transactional commands.
      }
    }
    const nextKey = retainedKey ?? bodyKey ?? crypto.randomUUID();
    retainPendingCommandKey(fingerprint, nextKey);
    headers.set("Idempotency-Key", nextKey);
    if (typeof requestBody === "string" && bodyKey) {
      const parsed = JSON.parse(requestBody) as Record<string, unknown>;
      requestBody = JSON.stringify({ ...parsed, idempotencyKey: nextKey });
    }
  }
  if (requestBody && !(requestBody instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");
  if (brandId && !brandNeutral) {
    headers.set("X-Vinifera-Brand-Id", brandId);
  }
  const nativeAccessToken = await nativeAccessTokenProvider?.();
  if (nativeAccessToken) {
    headers.set("Authorization", `Bearer ${nativeAccessToken}`);
  }

  // P2-2: Add request timeout via AbortController to prevent hung requests
  // from blocking indefinitely, which is especially problematic on mobile.
  const timeoutMs = 30_000;
  const controller = new AbortController();
  const callerSignal = options.signal;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // If the caller provided their own signal, abort on either trigger.
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timeoutId);
      controller.abort();
    } else {
      callerSignal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), {
      ...options,
      body: requestBody,
      headers,
      credentials: "include",
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(
        "The request timed out. Please try again.",
        { status: 0, code: "TIMEOUT" },
      );
    }
    throw new ApiError(
      "Vinifera could not reach the server. Check your connection and try again.",
      { status: 0, code: "NETWORK_ERROR" },
    );
  }
  clearTimeout(timeoutId);

  const payload = await parseResponse(response);
  updateAuthTenantScope(path, payload, response.ok);
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
