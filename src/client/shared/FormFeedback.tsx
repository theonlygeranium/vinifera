import { AlertCircle, CheckCircle2 } from "lucide-react";

export function FormFeedback({
  message,
  kind = "error",
}: {
  message?: string | null;
  kind?: "error" | "success" | "info";
}) {
  return (
    <div
      className={`form-feedback form-feedback--${kind}${
        message ? "" : " form-feedback--empty"
      }`}
      role={kind === "error" && message ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {message ? (
        <>
          {kind === "success" ? (
            <CheckCircle2 aria-hidden="true" size={18} />
          ) : (
            <AlertCircle aria-hidden="true" size={18} />
          )}
          <span>{message}</span>
        </>
      ) : null}
    </div>
  );
}
