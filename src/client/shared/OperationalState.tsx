import { CircleAlert, Grape, PlugZap } from "lucide-react";
import { type ReactNode } from "react";
import { ApiError } from "../api/client";

export function isActivationError(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.status === 404 ||
      error.status === 501 ||
      error.status === 503 ||
      error.code === "INTEGRATION_NOT_CONFIGURED" ||
      error.code === "NOT_IMPLEMENTED")
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="operation-state" role="status" aria-live="polite">
      <span className="operation-state__icon operation-state__icon--loading" aria-hidden="true">
        <Grape />
      </span>
      <h2>{label}</h2>
      <p>Vinifera is reading your winery’s live workspace.</p>
    </div>
  );
}

export function ActivationBlock({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="operation-state operation-state--activation" role="status">
      <span className="operation-state__icon" aria-hidden="true">
        <PlugZap />
      </span>
      <h2>{title}</h2>
      <p>{detail}</p>
      <p className="operation-state__note">
        The screen and API boundary are ready. Add the required environment
        credentials later to activate live operations.
      </p>
    </div>
  );
}

export function EmptyBlock({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="operation-state">
      <span className="operation-state__icon" aria-hidden="true">
        <Grape />
      </span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {action ? <div className="operation-state__action">{action}</div> : null}
    </div>
  );
}

export function ErrorBlock({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <div className="operation-state operation-state--error" role="alert">
      <span className="operation-state__icon" aria-hidden="true">
        <CircleAlert />
      </span>
      <h2>We could not load this workspace</h2>
      <p>
        {error instanceof Error
          ? error.message
          : "An unexpected error interrupted the request."}
      </p>
      <div className="operation-state__action">
        <button type="button" className="button button--secondary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}
