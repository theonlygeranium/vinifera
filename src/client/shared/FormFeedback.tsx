import { AlertCircle, CheckCircle2 } from "lucide-react";

export function FormFeedback({
  message,
  kind = "error",
}: {
  message?: string | null;
  kind?: "error" | "success" | "info";
}) {
  if (!message) return null;

  return (
    <div
      className={`form-feedback form-feedback--${kind}`}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {kind === "success" ? (
        <CheckCircle2 aria-hidden="true" size={18} />
      ) : (
        <AlertCircle aria-hidden="true" size={18} />
      )}
      <span>{message}</span>
    </div>
  );
}
