import {
  Building2,
  CreditCard,
  Grape,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, postJson } from "../api/client";
import type { PlanTier } from "../api/types";
import { useRouter } from "../routes/router";
import { Brand } from "../shared/Brand";
import { FormFeedback } from "../shared/FormFeedback";
import { useStaffSession } from "./StaffSessionContext";

const planNames: Record<PlanTier, string> = {
  vine: "Vine",
  cellar: "Cellar",
  estate: "Estate",
  reserve: "Reserve",
};

function sentenceCase(value?: string | null) {
  if (!value) return "Not configured";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function StaffDashboard() {
  const { navigate, location } = useRouter();
  const { session, clear } = useStaffSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<"logout" | "billing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notice =
    typeof location.state === "object" &&
    location.state !== null &&
    "notice" in location.state &&
    typeof location.state.notice === "string"
      ? location.state.notice
      : null;

  useEffect(() => {
    if (!menuOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  async function logout() {
    setBusy("logout");
    setError(null);
    try {
      await postJson("/api/auth/staff/logout");
      clear();
      navigate("/app/login", { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "We could not sign you out. Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function openBilling() {
    setBusy("billing");
    setError(null);
    try {
      const hasSubscription =
        organization?.stripeSubscriptionId ||
        ["active", "trialing", "past_due", "unpaid"].includes(
          organization?.subscriptionStatus ?? "",
        );
      const result = hasSubscription
        ? await postJson<{ url: string }>("/api/billing/portal")
        : await postJson<{ url: string }>("/api/billing/checkout", {
            planTier: organization?.planTier ?? "vine",
          });
      const target = new URL(result.url, window.location.origin);
      if (target.protocol !== "https:" && target.origin !== window.location.origin) {
        throw new Error("Invalid billing URL");
      }
      window.location.assign(target.toString());
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Billing is not available yet. Your workspace remains ready to connect.",
      );
    } finally {
      setBusy(null);
    }
  }

  const user = session?.user;
  const organization = session?.organization;
  const accessState = session?.access?.state ?? organization?.accessState;

  return (
    <div className="staff-app">
      <div
        className={`staff-app__overlay${menuOpen ? " staff-app__overlay--open" : ""}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={`staff-sidebar${menuOpen ? " staff-sidebar--open" : ""}`}
        aria-label="Staff navigation"
      >
        <div className="staff-sidebar__brand">
          <Brand inverse homeHref="/app" />
          <button
            type="button"
            className="icon-button staff-sidebar__close"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <nav className="staff-sidebar__nav" aria-label="Primary">
          <p className="staff-sidebar__label">Overview</p>
          <a className="staff-nav-item staff-nav-item--active" href="/app" aria-current="page">
            <LayoutDashboard aria-hidden="true" />
            Dashboard
          </a>
          <p className="staff-sidebar__label">Workspace</p>
          <button className="staff-nav-item" type="button" onClick={openBilling}>
            <CreditCard aria-hidden="true" />
            Subscription
          </button>
        </nav>
        <div className="staff-sidebar__user">
          <span className="avatar" aria-hidden="true">
            {(user?.fullName || user?.email || "V").slice(0, 2).toUpperCase()}
          </span>
          <span>
            <strong>{user?.fullName || user?.email}</strong>
            <small>{sentenceCase(user?.role)}</small>
          </span>
        </div>
      </aside>

      <div className="staff-main">
        <header className="staff-topbar">
          <div className="staff-topbar__title">
            <button
              type="button"
              className="icon-button staff-topbar__menu"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
            >
              <Menu aria-hidden="true" />
            </button>
            <h1>Dashboard</h1>
          </div>
          <button
            type="button"
            className="button button--secondary button--compact"
            onClick={logout}
            disabled={busy === "logout"}
          >
            <LogOut aria-hidden="true" />
            <span>{busy === "logout" ? "Signing out…" : "Sign out"}</span>
          </button>
        </header>

        <main className="staff-content">
          <FormFeedback message={error} />
          <FormFeedback message={notice} kind="success" />
          {accessState && accessState !== "active" ? (
            <section
              className={`access-banner access-banner--${accessState}`}
              aria-labelledby="access-banner-title"
            >
              <ShieldCheck aria-hidden="true" />
              <div>
                <h2 id="access-banner-title">
                  Subscription access: {sentenceCase(accessState)}
                </h2>
                <p>
                  Update test-mode billing to restore full workspace access.
                </p>
              </div>
              <button className="button button--primary" onClick={openBilling}>
                Update billing
              </button>
            </section>
          ) : null}

          <section className="welcome-panel" aria-labelledby="welcome-title">
            <div>
              <p className="eyebrow">Workspace ready</p>
              <h2 id="welcome-title">
                {organization?.name
                  ? `Welcome to ${organization.name}`
                  : "Welcome to Vinifera"}
              </h2>
              <p>
                Your secure organization foundation is in place. Club operations
                will appear here as they are connected.
              </p>
            </div>
            <span className="welcome-panel__mark" aria-hidden="true">
              <Grape />
            </span>
          </section>

          <div className="foundation-grid">
            <section className="foundation-card" aria-labelledby="organization-title">
              <div className="foundation-card__icon foundation-card__icon--wine">
                <Building2 aria-hidden="true" />
              </div>
              <div>
                <h2 id="organization-title">Organization</h2>
                <p>Your staff workspace is isolated to one winery tenant.</p>
              </div>
              <dl>
                <div>
                  <dt>Name</dt>
                  <dd>{organization?.name ?? "Pending setup"}</dd>
                </div>
                <div>
                  <dt>Your role</dt>
                  <dd>{sentenceCase(user?.role)}</dd>
                </div>
              </dl>
            </section>

            <section className="foundation-card" aria-labelledby="subscription-title">
              <div className="foundation-card__icon foundation-card__icon--gold">
                <CreditCard aria-hidden="true" />
              </div>
              <div>
                <h2 id="subscription-title">Subscription</h2>
                <p>Billing status is synchronized from Stripe test mode.</p>
              </div>
              <dl>
                <div>
                  <dt>Plan</dt>
                  <dd>
                    {organization?.planTier
                      ? planNames[organization.planTier]
                      : "Not selected"}
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{sentenceCase(organization?.subscriptionStatus)}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="button button--secondary button--wide"
                onClick={openBilling}
                disabled={busy === "billing"}
              >
                {busy === "billing" ? "Opening Stripe…" : "Manage test subscription"}
              </button>
            </section>
          </div>

          <section className="empty-state" aria-labelledby="empty-dashboard-title">
            <span className="empty-state__icon" aria-hidden="true">
              <Grape />
            </span>
            <h2 id="empty-dashboard-title">Your club dashboard is ready</h2>
            <p>
              There is no production club data yet. Members, releases, shipments,
              and analytics will populate from connected services in later phases.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
