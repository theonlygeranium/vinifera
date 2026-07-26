import { Grape, LogOut, ShieldCheck, Wine } from "lucide-react";
import { useState } from "react";
import { ApiError, postJson } from "../api/client";
import { useRouter } from "../routes/router";
import { Brand } from "../shared/Brand";
import { FormFeedback } from "../shared/FormFeedback";
import { useMemberSession } from "./MemberSessionContext";

export function MemberPortal() {
  const { navigate } = useRouter();
  const { session, clear } = useMemberSession();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function logout() {
    setSubmitting(true);
    setError(null);
    try {
      await postJson("/api/auth/member/logout");
      clear();
      navigate("/portal/login", { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "We could not sign you out. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const user = session?.user;
  const name =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email;
  const firstName = user?.firstName || "Member";
  const organizationName = session?.organization?.name || "Your winery";

  return (
    <div className="member-app">
      <header className="member-topbar">
        <Brand compact inverse homeHref="/portal" />
        <div className="member-topbar__account">
          <span className="member-topbar__name">{name}</span>
          <button
            type="button"
            className="button button--member-ghost"
            onClick={logout}
            disabled={submitting}
          >
            <LogOut aria-hidden="true" />
            <span>{submitting ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>
      </header>

      <main className="member-content">
        <FormFeedback message={error} />
        <section className="member-hero" aria-labelledby="member-welcome">
          <div>
            <p className="member-hero__organization">{organizationName}</p>
            <h1 id="member-welcome">Welcome, {firstName}</h1>
            <p>Your membership is protected by passwordless, magic-link access.</p>
          </div>
          <span className="member-hero__mark" aria-hidden="true">
            <Grape />
          </span>
        </section>

        <section className="member-empty" aria-labelledby="member-empty-title">
          <span className="member-empty__icon" aria-hidden="true">
            <Wine />
          </span>
          <h2 id="member-empty-title">Your member portal is ready</h2>
          <p>
            No release or shipment information is available yet. Your winery’s
            connected club activity will appear here automatically.
          </p>
        </section>

        <section className="member-security" aria-labelledby="member-security-title">
          <ShieldCheck aria-hidden="true" />
          <div>
            <h2 id="member-security-title">Secure member access</h2>
            <p>
              Your session is separate from winery staff accounts and is stored in
              a secure, HTTP-only cookie.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
