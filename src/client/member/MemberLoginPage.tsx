import { Mail } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError, postJson } from "../api/client";
import { Link, useRouter, useSearchParams } from "../routes/router";
import { AuthLayout } from "../shared/AuthLayout";
import { FormFeedback } from "../shared/FormFeedback";
import {
  getNativeDeviceFingerprint,
  isNativeShell,
} from "../mobile/native-session";
import { MOBILE_AUTH_REDIRECT_URI } from "../mobile/mobile-identity";
import { useMemberSession } from "./MemberSessionContext";

export function MemberLoginPage() {
  const { navigate } = useRouter();
  const { state: sessionState } = useMemberSession();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [clubCode, setClubCode] = useState("");
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "invalid_link"
      ? "That magic link is invalid or expired. Request a new link below."
      : null,
  );
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (sessionState === "authenticated") {
      navigate("/portal", { replace: true });
    }
  }, [navigate, sessionState]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isNativeShell()) {
        await postJson("/api/auth/member/mobile/magic-link", {
          email,
          clubCode: clubCode.trim() || undefined,
          deviceFingerprint: await getNativeDeviceFingerprint(),
          redirectUri: MOBILE_AUTH_REDIRECT_URI,
        });
      } else {
        await postJson("/api/auth/member/magic-link", { email });
      }
      setSent(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "We could not send your magic link. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      surface="member"
      title="Your wine club, one click away"
      description="Enter the email associated with your membership."
      footer={<Link to="/app/login">Winery staff sign in</Link>}
    >
      {sent ? (
        <div className="confirmation-panel" role="status" aria-live="polite">
          <span className="confirmation-panel__icon" aria-hidden="true">
            <Mail />
          </span>
          <h2>Check your email</h2>
          <p>
            We sent a secure, single-use sign-in link to <strong>{email}</strong>.
            The link expires in 15 minutes.
          </p>
          <button
            type="button"
            className="button button--secondary button--wide"
            onClick={() => setSent(false)}
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          <FormFeedback message={error} />
          <div className="form-field">
            <label htmlFor="member-email">Member email</label>
            <input
              id="member-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          {isNativeShell() ? (
            <div className="form-field">
              <label htmlFor="member-club-code">
                Wine club code <span>(if you belong to more than one club)</span>
              </label>
              <input
                id="member-club-code"
                name="clubCode"
                type="text"
                autoCapitalize="none"
                autoComplete="off"
                value={clubCode}
                onChange={(event) => setClubCode(event.target.value)}
              />
            </div>
          ) : null}
          <button className="button button--primary button--wide" disabled={submitting}>
            {submitting ? "Sending secure link…" : "Email me a magic link"}
          </button>
          <p className="form-legal">
            For your security, only five links can be requested per email each hour.
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
