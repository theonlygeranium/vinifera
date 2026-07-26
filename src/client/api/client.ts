export type FieldErrors = Record<string, string[] | string>;

const BRAND_STORAGE_KEY = "vinifera.active-brand";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let nativeAccessTokenProvider: (() => Promise<string | null>) | null = null;

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
  const configuredOrigin =
    import.meta.env.VITE_MOBILE_API_ORIGIN?.trim() ||
    "https://vinifera.edstratumlabs.ai";
  const origin = new URL(configuredOrigin);
  if (origin.protocol !== "https:") {
    throw new ApiError("The native API origin must use HTTPS.", {
      status: 0,
      code: "INVALID_MOBILE_API_ORIGIN",
    });
  }
  return new URL(path, origin).toString();
}

export async function apiRequest<T>(
  path: `/api/${string}`,
  options: Omit<RequestInit, "credentials"> = {},
): Promise<T> {
  const headers = new Headers(options.headers);
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
