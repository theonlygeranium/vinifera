import { Building2, Check, Mail } from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ApiError, postJson } from "../api/client";
import type { PlanTier } from "../api/types";
import { Link, useRouter, useSearchParams } from "../routes/router";
import { AuthLayout } from "../shared/AuthLayout";
import { FormFeedback } from "../shared/FormFeedback";
import { PasswordField } from "../shared/PasswordField";
import { useStaffSession } from "./StaffSessionContext";

interface SignupResponse {
  billingActivationRequired: boolean;
}

const plans: {
  id: PlanTier;
  name: string;
  price: string;
  description: string;
}[] = [
  { id: "vine", name: "Vine", price: "$149/mo", description: "For emerging clubs" },
  { id: "cellar", name: "Cellar", price: "$349/mo", description: "For growing programs" },
  { id: "estate", name: "Estate", price: "$749/mo", description: "For established wineries" },
  { id: "reserve", name: "Reserve", price: "$1,500+/mo", description: "For complex portfolios" },
];

function errorMessage(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : "Something went wrong. Please try again.";
}

function safeNavigate(url: string) {
  const target = new URL(url, window.location.origin);
  if (target.protocol !== "https:" && target.origin !== window.location.origin) {
    throw new Error("Unsafe checkout URL");
  }
  window.location.assign(target.toString());
}

export function LoginPage() {
  const { navigate, location } = useRouter();
  const { refresh, state: sessionState } = useStaffSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (sessionState === "authenticated") {
      navigate("/app", { replace: true });
    }
  }, [navigate, sessionState]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await postJson("/api/auth/staff/login", { email, password });
      const session = await refresh();
      if (!session) throw new Error("Session not established");
      const returnTo =
        typeof location.state === "object" &&
        location.state !== null &&
        "returnTo" in location.state &&
        typeof location.state.returnTo === "string" &&
        location.state.returnTo.startsWith("/app")
          ? location.state.returnTo
          : "/app";
      navigate(returnTo, { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      description="Sign in to manage your wine club."
      footer={
        <p>
          New to Vinifera? <Link to="/app/signup">Create an account</Link>
        </p>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormFeedback message={error} />
        <div className="form-field">
          <label htmlFor="staff-email">Email address</label>
          <input
            id="staff-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <PasswordField
          id="staff-password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <div className="form-row form-row--end">
          <Link to="/app/forgot-password">Forgot password?</Link>
        </div>
        <button className="button button--primary button--wide" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <div className="form-divider" aria-hidden="true">
          <span>or</span>
        </div>
        <a className="button button--secondary button--wide" href="/api/auth/staff/google">
          <span className="google-mark" aria-hidden="true">G</span>
          Continue with Google
        </a>
      </form>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { navigate } = useRouter();
  const { refresh } = useStaffSession();
  const [organizationName, setOrganizationName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [planTier, setPlanTier] = useState<PlanTier>("vine");
  const [error, setError] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const passwordError = useMemo(() => {
    if (!confirmation) return undefined;
    return password === confirmation ? undefined : "Passwords do not match.";
  }, [confirmation, password]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      setError("Check that both password fields match.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await postJson<SignupResponse>("/api/auth/staff/signup", {
        organizationName,
        fullName,
        email,
        password,
        planTier,
      });
      const session = await refresh();
      if (!session) {
        setConfirmationEmail(email);
        return;
      }
      if (!result.billingActivationRequired) {
        const checkout = await postJson<{ url: string }>("/api/billing/checkout", {
          planTier,
        });
        safeNavigate(checkout.url);
        return;
      }
      navigate("/app", {
        replace: true,
        state: {
          notice:
            "Your secure workspace is ready. Billing is connection-ready and can be activated later.",
        },
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Create your winery workspace"
      description="Start with secure staff access and Stripe test-mode billing."
      footer={
        <p>
          Already have an account? <Link to="/app/login">Sign in</Link>
        </p>
      }
    >
      {confirmationEmail ? (
        <div className="confirmation-panel" role="status" aria-live="polite">
          <span className="confirmation-panel__icon" aria-hidden="true">
            <Mail />
          </span>
          <h2>Confirm your staff email</h2>
          <p>
            We created the secure workspace. Open the confirmation link sent to{" "}
            <strong>{confirmationEmail}</strong> to finish signing in.
          </p>
          <Link className="button button--secondary button--wide" to="/app/login">
            Return to sign in
          </Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
        <FormFeedback message={error} />
        <div className="form-field">
          <label htmlFor="organization-name">Winery or organization name</label>
          <div className="input-with-icon">
            <Building2 aria-hidden="true" />
            <input
              id="organization-name"
              name="organizationName"
              autoComplete="organization"
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              required
            />
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="full-name">Your name</label>
          <input
            id="full-name"
            name="name"
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="signup-email">Work email</label>
          <input
            id="signup-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="form-grid">
          <PasswordField
            id="new-password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            hint="Use at least 12 characters."
          />
          <PasswordField
            id="confirm-password"
            label="Confirm password"
            value={confirmation}
            onChange={setConfirmation}
            autoComplete="new-password"
            error={passwordError}
          />
        </div>
        <fieldset className="plan-picker">
          <legend>Choose a plan</legend>
          <div className="plan-picker__grid">
            {plans.map((plan) => (
              <label
                className={`plan-option${
                  planTier === plan.id ? " plan-option--selected" : ""
                }`}
                key={plan.id}
              >
                <input
                  type="radio"
                  name="planTier"
                  value={plan.id}
                  checked={planTier === plan.id}
                  onChange={() => setPlanTier(plan.id)}
                />
                <span className="plan-option__body">
                  <span className="plan-option__title">
                    <strong>{plan.name}</strong>
                    <span>{plan.price}</span>
                  </span>
                  <small>{plan.description}</small>
                </span>
                {planTier === plan.id ? (
                  <Check className="plan-option__check" aria-hidden="true" />
                ) : null}
              </label>
            ))}
          </div>
        </fieldset>
        <button className="button button--primary button--wide" disabled={submitting}>
          {submitting ? "Creating workspace…" : "Continue to secure checkout"}
        </button>
        <p className="form-legal">
          Stripe remains in test mode. No real charge will be made during this build phase.
        </p>
        </form>
      )}
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await postJson("/api/auth/staff/forgot-password", { email });
      setSent(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="We’ll send password reset instructions to your staff email."
      footer={<Link to="/app/login">Return to sign in</Link>}
    >
      {sent ? (
        <div className="confirmation-panel" role="status" aria-live="polite">
          <span className="confirmation-panel__icon" aria-hidden="true">
            <Mail />
          </span>
          <h2>Check your email</h2>
          <p>
            If a staff account exists for <strong>{email}</strong>, reset instructions
            are on the way.
          </p>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          <FormFeedback message={error} />
          <div className="form-field">
            <label htmlFor="reset-email">Email address</label>
            <input
              id="reset-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <button className="button button--primary button--wide" disabled={submitting}>
            {submitting ? "Sending…" : "Send reset instructions"}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}

function PasswordCompletionForm({
  endpoint,
  token,
  submitLabel,
  successMessage,
}: {
  endpoint: "/api/auth/staff/reset-password" | "/api/auth/staff/accept-invite";
  token: string | null;
  submitLabel: string;
  successMessage: string;
}) {
  const { navigate } = useRouter();
  const { refresh } = useStaffSession();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(
    token ? null : "This link is missing its secure token. Request a new email.",
  );
  const [submitting, setSubmitting] = useState(false);
  const isInvite = endpoint.endsWith("accept-invite");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    if (password !== confirmation) {
      setError("Check that both password fields match.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await postJson(endpoint, {
        token,
        password,
        ...(isInvite ? { fullName } : {}),
      });
      await refresh();
      navigate("/app", { replace: true, state: { notice: successMessage } });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <FormFeedback message={error} />
      {isInvite ? (
        <div className="form-field">
          <label htmlFor="invite-name">Your name</label>
          <input
            id="invite-name"
            name="name"
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            required
          />
        </div>
      ) : null}
      <PasswordField
        id={isInvite ? "invite-password" : "reset-new-password"}
        label="New password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint="Use at least 12 characters."
      />
      <PasswordField
        id={isInvite ? "invite-confirmation" : "reset-confirmation"}
        label="Confirm new password"
        value={confirmation}
        onChange={setConfirmation}
        autoComplete="new-password"
        error={
          confirmation && password !== confirmation
            ? "Passwords do not match."
            : undefined
        }
      />
      <button
        className="button button--primary button--wide"
        disabled={submitting || !token}
      >
        {submitting ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

export function ResetPasswordPage() {
  const searchParams = useSearchParams();
  return (
    <AuthLayout
      title="Choose a new password"
      description="Your new password must be at least 12 characters."
      footer={<Link to="/app/login">Return to sign in</Link>}
    >
      <PasswordCompletionForm
        endpoint="/api/auth/staff/reset-password"
        token={searchParams.get("token")}
        submitLabel="Update password"
        successMessage="Your password has been updated."
      />
    </AuthLayout>
  );
}

export function InvitePage() {
  const searchParams = useSearchParams();
  return (
    <AuthLayout
      title="Join your winery team"
      description="Accept your invitation and create a secure staff password."
      footer={<Link to="/app/login">Already accepted? Sign in</Link>}
    >
      <PasswordCompletionForm
        endpoint="/api/auth/staff/accept-invite"
        token={searchParams.get("token")}
        submitLabel="Accept invitation"
        successMessage="Your staff account is ready."
      />
    </AuthLayout>
  );
}
