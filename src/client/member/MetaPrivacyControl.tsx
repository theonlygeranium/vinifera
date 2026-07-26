import { ShieldCheck } from "lucide-react";
import { useCallback, useState } from "react";
import { ApiError, apiRequest } from "../api/client";
import { FormFeedback } from "../shared/FormFeedback";
import {
  ErrorBlock,
  LoadingBlock,
} from "../shared/OperationalState";
import { useApiResource } from "../staff/phase2/useApiResource";
import {
  META_PRIVACY_POLICY_VERSION,
  updateMemberMetaConsent,
} from "./metaAttribution";

interface MetaPrivacyPreference {
  consentSource: string | null;
  consented: boolean | null;
  consentedAt: string | null;
  policyVersion: string | null;
  revokedAt: string | null;
  updatedAt: string | null;
}

export function MetaPrivacyControl() {
  const loadPreference = useCallback(
    () => apiRequest<MetaPrivacyPreference>("/api/member/privacy/meta"),
    [],
  );
  const preference = useApiResource(loadPreference, [loadPreference]);
  const [busy, setBusy] = useState<"accept" | "decline" | "revoke" | null>(
    null,
  );
  const [feedback, setFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);

  async function savePreference(
    consented: boolean,
    action: "accept" | "decline" | "revoke",
  ) {
    setBusy(action);
    setFeedback(null);
    try {
      await updateMemberMetaConsent({
        consentSource: `member_portal_${action}`,
        consented,
        policyVersion: META_PRIVACY_POLICY_VERSION,
      });
      setFeedback({
        kind: "success",
        message:
          action === "accept"
            ? "Meta attribution is allowed for your member activity."
            : action === "revoke"
              ? "Meta attribution consent was revoked and stored identifiers were redacted."
              : "Your choice to decline Meta attribution was saved.",
      });
      await preference.refresh();
    } catch (caught) {
      setFeedback({
        kind: "error",
        message:
          caught instanceof ApiError
            ? caught.message
            : "Your Meta privacy preference could not be saved.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      className="operation-panel member-privacy"
      aria-labelledby="meta-privacy-title"
    >
      <div className="panel-heading panel-heading--split">
        <div>
          <p className="eyebrow eyebrow--wine">Privacy controls</p>
          <h2 id="meta-privacy-title">Meta attribution</h2>
        </div>
        <ShieldCheck aria-hidden="true" />
      </div>
      <p>
        Choose whether first-party campaign and browser attribution may be used
        to measure your winery interactions. Policy version{" "}
        {META_PRIVACY_POLICY_VERSION}.
      </p>
      {preference.state.status === "loading" ? (
        <LoadingBlock label="Loading your Meta privacy preference" />
      ) : preference.state.status === "error" ? (
        <ErrorBlock
          error={preference.state.error}
          onRetry={() => void preference.refresh()}
        />
      ) : (
        <>
          <p role="status">
            Current choice:{" "}
            <strong>
              {preference.state.data.consented === true
                ? "Allowed"
                : preference.state.data.consented === false
                  ? preference.state.data.revokedAt
                    ? "Revoked"
                    : "Declined"
                  : "No choice recorded"}
            </strong>
          </p>
          <div className="button-row">
            {preference.state.data.consented === true ? (
              <button
                type="button"
                className="button button--secondary"
                disabled={busy !== null}
                onClick={() => void savePreference(false, "revoke")}
              >
                {busy === "revoke" ? "Revoking…" : "Revoke consent"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy !== null}
                  onClick={() => void savePreference(true, "accept")}
                >
                  {busy === "accept" ? "Saving…" : "Allow attribution"}
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={busy !== null}
                  onClick={() => void savePreference(false, "decline")}
                >
                  {busy === "decline" ? "Saving…" : "Decline"}
                </button>
              </>
            )}
          </div>
        </>
      )}
      <div aria-live="polite">
        <FormFeedback
          kind={feedback?.kind ?? "error"}
          message={feedback?.message ?? null}
        />
      </div>
    </section>
  );
}
