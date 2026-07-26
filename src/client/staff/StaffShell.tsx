import {
  Boxes,
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageCheck,
  RefreshCw,
  Tags,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ApiError, postJson } from "../api/client";
import { Link, useRouter } from "../routes/router";
import { Brand } from "../shared/Brand";
import { FormFeedback } from "../shared/FormFeedback";
import { useStaffSession } from "./StaffSessionContext";

const navSections = [
  {
    label: "Overview",
    links: [{ href: "/app", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Club Operations",
    links: [
      { href: "/app/members", label: "Members", icon: Users },
      { href: "/app/tiers", label: "Club Tiers", icon: Tags },
      { href: "/app/releases", label: "Release Schedule", icon: CalendarDays },
      { href: "/app/shipments", label: "Shipments", icon: Boxes },
      { href: "/app/fulfillment", label: "Fulfillment", icon: PackageCheck },
      { href: "/app/recovery", label: "Payment Recovery", icon: RefreshCw },
      { href: "/app/import", label: "Import Members", icon: Upload },
    ],
  },
] as const;

function sentenceCase(value?: string | null) {
  if (!value) return "Not configured";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function StaffShell({
  title,
  eyebrow,
  actions,
  children,
}: {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { navigate, location } = useRouter();
  const { session, clear } = useStaffSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<"logout" | "billing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activePath = useMemo(() => {
    const pathname = location.pathname.replace(/\/+$/, "");
    if (pathname.startsWith("/app/members/")) return "/app/members";
    if (pathname.startsWith("/app/releases/")) return "/app/releases";
    return pathname || "/app";
  }, [location.pathname]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  const user = session?.user;
  const organization = session?.organization;
  const accessState = session?.access?.state ?? organization?.accessState;

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
      if (
        target.protocol !== "https:" &&
        target.origin !== window.location.origin
      ) {
        throw new Error("Invalid billing URL");
      }
      window.location.assign(target.toString());
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Billing is wired and will activate when Stripe is configured.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="staff-app">
      <button
        type="button"
        className={`staff-app__overlay${menuOpen ? " staff-app__overlay--open" : ""}`}
        onClick={() => setMenuOpen(false)}
        aria-label="Close navigation menu"
        tabIndex={menuOpen ? 0 : -1}
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
          {navSections.map((section) => (
            <div key={section.label}>
              <p className="staff-sidebar__label">{section.label}</p>
              {section.links.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  className={`staff-nav-item${
                    activePath === href ? " staff-nav-item--active" : ""
                  }`}
                  to={href}
                  aria-current={activePath === href ? "page" : undefined}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </div>
          ))}
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
            <div>
              {eyebrow ? <span>{eyebrow}</span> : null}
              <h1>{title}</h1>
            </div>
          </div>
          <div className="staff-topbar__actions">
            {actions}
            <button
              type="button"
              className="button button--secondary button--compact"
              onClick={logout}
              disabled={busy === "logout"}
            >
              <LogOut aria-hidden="true" />
              <span>{busy === "logout" ? "Signing out…" : "Sign out"}</span>
            </button>
          </div>
        </header>

        <main className="staff-content">
          <div className="staff-live-region" aria-live="polite">
            <FormFeedback message={error} />
          </div>
          {accessState && accessState !== "active" ? (
            <section
              className={`access-banner access-banner--${accessState}`}
              aria-labelledby="access-banner-title"
            >
              <CreditCard aria-hidden="true" />
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
          {children}
        </main>
      </div>
    </div>
  );
}
