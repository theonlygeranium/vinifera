export type FieldErrors = Record<string, string[] | string>;

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

export async function apiRequest<T>(
  path: `/api/${string}`,
  options: Omit<RequestInit, "credentials"> = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");

  let response: Response;
  try {
    response = await fetch(path, {
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
