export type ErrorCode =
  | "activation_required"
  | "configuration_error"
  | "conflict"
  | "forbidden"
  | "invalid_request"
  | "not_found"
  | "rate_limited"
  | "unauthorized"
  | "upstream_error";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: Record<string, string>;
  readonly status: number;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(500, "upstream_error", "The request could not be completed.");
  }

  return new AppError(500, "upstream_error", "An unexpected error occurred.");
}

export function requireConfigured(
  value: string | undefined,
  variableName: string,
): string {
  if (!value) {
    throw new AppError(
      503,
      "activation_required",
      `${variableName} must be connected before this operation can run.`,
    );
  }
  return value;
}
