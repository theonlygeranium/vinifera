import {
  CheckCircle2,
  Copy,
  Globe2,
  MailCheck,
  Palette,
  ShieldCheck,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ApiError,
  deleteJson,
  patchJson,
  postJson,
  putJson,
} from "../../api/client";
import type {
  Brand,
  DomainVerification,
  SenderVerification,
} from "../../api/phase5";
import { FormFeedback } from "../../shared/FormFeedback";
import {
  ActivationBlock,
  EmptyBlock,
} from "../../shared/OperationalState";
import { StaffShell } from "../StaffShell";
import { useStaffSession } from "../StaffSessionContext";
import { useBrandScope } from "./BrandScopeContext";

const FONT_OPTIONS = [
  { value: "system-ui", label: "System sans · platform native" },
  { value: "Georgia", label: "Georgia · classic serif" },
  { value: "Arial", label: "Arial · universal sans" },
] as const;

function parseHex(value: string) {
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1]!;
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ] as const;
}

function luminance(rgb: readonly number[]) {
  const channels = rgb.map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
  );
}

function contrast(left: readonly number[], right: readonly number[]) {
  const bright = Math.max(luminance(left), luminance(right));
  const dark = Math.min(luminance(left), luminance(right));
  return (bright + 0.05) / (dark + 0.05);
}

function evaluateColor(value: string) {
  const rgb = parseHex(value);
  if (!rgb) return null;
  const white = contrast(rgb, [255, 255, 255]);
  const ink = contrast(rgb, [26, 0, 9]);
  return {
    foreground: white >= ink ? "#ffffff" : "#1a0009",
    ratio: Math.max(white, ink),
    passes: Math.max(white, ink) >= 4.5,
  };
}

function editableBrand(brand: Brand) {
  return {
    name: brand.name,
    portalTitle: brand.portalTitle ?? `${brand.name} Wine Club`,
    logoUrl: brand.logoUrl ?? "",
    primaryColor: brand.primaryColor ?? "#6b1e30",
    secondaryColor: brand.secondaryColor ?? "#c9993a",
    fontFamily: ["system-ui", "Georgia", "Arial"].includes(
      brand.fontFamily ?? "",
    )
      ? (brand.fontFamily as string)
      : "system-ui",
    emailSenderName: brand.emailSenderName ?? brand.name,
    emailSenderAddress: brand.emailSenderAddress ?? "",
  };
}

export function WhiteLabelPage() {
  const { session } = useStaffSession();
  const brandScope = useBrandScope();
  const brand = brandScope.activeBrand;
  const [draft, setDraft] = useState(() =>
    brand
      ? editableBrand(brand)
      : {
          name: "",
          portalTitle: "",
          logoUrl: "",
          primaryColor: "#6b1e30",
          secondaryColor: "#c9993a",
          fontFamily: "system-ui",
          emailSenderName: "",
          emailSenderAddress: "",
        },
  );
  const [hostname, setHostname] = useState(brand?.customDomain ?? "");
  const [verification, setVerification] = useState<DomainVerification | null>(
    null,
  );
  const [senderVerification, setSenderVerification] =
    useState<SenderVerification | null>(null);
  const [busy, setBusy] = useState<
    "brand" | "domain" | "remove-domain" | "sender" | null
  >(null);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const previousBrandId = useRef(brand?.id ?? null);

  useEffect(() => {
    if (!brand) return;
    setDraft(editableBrand(brand));
    setHostname(brand.customDomain ?? "");
    if (previousBrandId.current !== brand.id) {
      setVerification(null);
      setSenderVerification(null);
    }
    previousBrandId.current = brand.id;
  }, [brand]);

  const primaryContrast = useMemo(
    () => evaluateColor(draft.primaryColor),
    [draft.primaryColor],
  );
  const secondaryContrast = useMemo(
    () => evaluateColor(draft.secondaryColor),
    [draft.secondaryColor],
  );
  const themePasses =
    primaryContrast?.passes === true && secondaryContrast?.passes === true;
  const logoUrlIsValid = useMemo(() => {
    const value = draft.logoUrl.trim();
    if (!value) return true;
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === ""
      );
    } catch {
      return false;
    }
  }, [draft.logoUrl]);
  const eligible = session?.organization?.planTier === "reserve";

  async function saveBranding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!brand || !themePasses || !logoUrlIsValid) return;
    setBusy("brand");
    setFeedback(null);
    try {
      await patchJson(`/api/brands/${brand.id}`, {
        logoUrl: draft.logoUrl || null,
        primaryColor: draft.primaryColor,
        secondaryColor: draft.secondaryColor,
        fontFamily: draft.fontFamily,
        portalTitle: draft.portalTitle,
        emailSenderName: draft.emailSenderName,
        emailSenderAddress: draft.emailSenderAddress || null,
        contrast: {
          primary: primaryContrast?.ratio,
          secondary: secondaryContrast?.ratio,
        },
      });
      await brandScope.refresh();
      setFeedback({
        kind: "success",
        message:
          "Brand presentation saved. Sender identity remains pending until its domain is verified.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "The white-label settings could not be saved.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function verifyDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!brand) return;
    setBusy("domain");
    setFeedback(null);
    try {
      const result = await putJson<DomainVerification>(
        `/api/brands/${brand.id}/domain`,
        { hostname },
      );
      setVerification(result);
      setFeedback({
        kind: "success",
        message:
          result.status === "active"
            ? "The custom domain and certificate are active."
            : "DNS instructions are ready. Verification remains pending until the record resolves.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "The custom domain could not be verified.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function verifySender() {
    if (!brand || !draft.emailSenderAddress) return;
    setBusy("sender");
    setFeedback(null);
    try {
      await patchJson(`/api/brands/${brand.id}`, {
        emailSenderAddress: draft.emailSenderAddress,
        emailSenderName: draft.emailSenderName || brand.name,
      });
      const result = await postJson<SenderVerification>(
        `/api/brands/${brand.id}/sender/verify`,
      );
      await brandScope.refresh();
      setSenderVerification(result);
      setFeedback({
        kind: "success",
        message:
          result.status === "verified"
            ? "The brand sender domain is verified and active."
            : "Sender-domain verification started. Publish the DNS records below, then check again.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "The sender domain could not be verified.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function removeDomain() {
    if (!brand) return;
    setBusy("remove-domain");
    setFeedback(null);
    try {
      await deleteJson(`/api/brands/${brand.id}/domain`);
      setHostname("");
      setVerification(null);
      await brandScope.refresh();
      setFeedback({
        kind: "success",
        message: "The custom hostname was removed from this brand.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof ApiError
            ? error.message
            : "The custom hostname could not be removed.",
      });
    } finally {
      setBusy(null);
    }
  }

  if (!eligible) {
    return (
      <StaffShell title="White-label" eyebrow="Reserve capability">
        <ActivationBlock
          title="White-label portals require Reserve"
          detail="Upgrade the organization before configuring brand domains, themes, and sender identities."
        />
      </StaffShell>
    );
  }

  if (!brand || brandScope.activeBrandId === "all") {
    return (
      <StaffShell title="White-label" eyebrow="Brand experience">
        <EmptyBlock
          title="Select one brand"
          detail="White-label settings are isolated per brand and cannot be edited from the all-brand scope."
        />
      </StaffShell>
    );
  }

  const previewStyle = {
    "--preview-primary": draft.primaryColor,
    "--preview-secondary": draft.secondaryColor,
    "--preview-primary-ink": primaryContrast?.foreground ?? "#ffffff",
    "--preview-secondary-ink": secondaryContrast?.foreground ?? "#1a0009",
    "--preview-font": draft.fontFamily,
  } as CSSProperties;

  return (
    <StaffShell title="White-label" eyebrow={brand.name}>
      <div aria-live="polite">
        <FormFeedback
          message={feedback?.message ?? null}
          kind={feedback?.kind ?? "error"}
        />
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow eyebrow--wine">Member experience</p>
          <h2>White-label portal controls</h2>
          <p>
            Configure an accessible brand theme, verified custom hostname, and
            transactional sender identity without changing the shared app.
          </p>
        </div>
      </div>

      <div className="white-label-layout">
        <form className="operation-panel operation-form" onSubmit={saveBranding}>
          <div className="panel-heading">
            <span className="foundation-card__icon foundation-card__icon--wine">
              <Palette aria-hidden="true" />
            </span>
            <div>
              <h2>Brand presentation</h2>
              <p>Theme changes are scoped to {brand.name}.</p>
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="portal-title">Portal title</label>
            <input
              id="portal-title"
              required
              maxLength={100}
              value={draft.portalTitle}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  portalTitle: event.target.value,
                }))
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="brand-logo-url">Logo URL (HTTPS)</label>
            <input
              id="brand-logo-url"
              type="url"
              inputMode="url"
              pattern="https://.*"
              aria-describedby="brand-logo-url-help"
              aria-invalid={!logoUrlIsValid}
              value={draft.logoUrl}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  logoUrl: event.target.value,
                }))
              }
              placeholder="https://cdn.example.com/logo.png"
            />
            <small id="brand-logo-url-help">
              Optional. Use an HTTPS URL without embedded credentials.
            </small>
          </div>
          <div className="form-grid">
            <div className="form-field color-field">
              <label htmlFor="primary-color">Primary color</label>
              <div>
                <input
                  id="primary-color"
                  type="color"
                  value={draft.primaryColor}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      primaryColor: event.target.value,
                    }))
                  }
                />
                <input
                  aria-label="Primary color hex"
                  pattern="#[0-9a-fA-F]{6}"
                  value={draft.primaryColor}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      primaryColor: event.target.value,
                    }))
                  }
                />
              </div>
              <small>
                {primaryContrast
                  ? `${primaryContrast.ratio.toFixed(2)}:1 with ${primaryContrast.foreground === "#ffffff" ? "white" : "dark"} text`
                  : "Enter a six-digit hex color."}
              </small>
            </div>
            <div className="form-field color-field">
              <label htmlFor="secondary-color">Accent color</label>
              <div>
                <input
                  id="secondary-color"
                  type="color"
                  value={draft.secondaryColor}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      secondaryColor: event.target.value,
                    }))
                  }
                />
                <input
                  aria-label="Accent color hex"
                  pattern="#[0-9a-fA-F]{6}"
                  value={draft.secondaryColor}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      secondaryColor: event.target.value,
                    }))
                  }
                />
              </div>
              <small>
                {secondaryContrast
                  ? `${secondaryContrast.ratio.toFixed(2)}:1 with ${secondaryContrast.foreground === "#ffffff" ? "white" : "dark"} text`
                  : "Enter a six-digit hex color."}
              </small>
            </div>
          </div>
          {!themePasses ? (
            <p className="theme-contrast-error" role="alert">
              Both theme colors must support at least 4.5:1 text contrast.
            </p>
          ) : (
            <p className="theme-contrast-pass">
              <CheckCircle2 aria-hidden="true" />
              Theme colors pass WCAG AA normal-text contrast.
            </p>
          )}
          <div className="form-field">
            <label htmlFor="portal-font">Portal typeface</label>
            <select
              id="portal-font"
              value={draft.fontFamily}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  fontFamily: event.target.value,
                }))
              }
            >
              {FONT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="operation-fieldset">
            <legend>Transactional email sender</legend>
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="sender-name">Sender name</label>
                <input
                  id="sender-name"
                  value={draft.emailSenderName}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      emailSenderName: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="form-field">
                <label htmlFor="sender-address">Sender address</label>
                <input
                  id="sender-address"
                  type="email"
                  value={draft.emailSenderAddress}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      emailSenderAddress: event.target.value,
                    }))
                  }
                  placeholder="club@example.com"
                />
              </div>
            </div>
            <p className="provider-oauth-note">
              <MailCheck aria-hidden="true" />
              Sender status: {brand.emailDomainStatus ?? "unconfigured"}.
              Resend must verify the exact sender domain before activation.
            </p>
            <button
              type="button"
              className="button button--secondary"
              disabled={
                busy !== null ||
                !draft.emailSenderAddress ||
                brand.emailDomainStatus === "verified"
              }
              onClick={() => void verifySender()}
            >
              {busy === "sender"
                ? "Checking sender…"
                : brand.emailDomainStatus === "verified"
                  ? "Sender verified"
                  : "Verify sender domain"}
            </button>
            {senderVerification?.dnsRecords.map((record) => (
              <div
                className="dns-instructions"
                role="status"
                key={`${record.type}:${record.name}`}
              >
                <div>
                  <strong>{record.type || record.record}</strong>
                  <span>{record.name}</span>
                </div>
                <code>{record.value}</code>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Copy ${record.type || record.record} sender DNS value`}
                  onClick={() =>
                    void navigator.clipboard.writeText(record.value)
                  }
                >
                  <Copy aria-hidden="true" />
                </button>
              </div>
            ))}
          </fieldset>
          <button
            className="button button--primary"
            disabled={busy !== null || !themePasses || !logoUrlIsValid}
          >
            {busy === "brand" ? "Saving theme…" : "Save brand experience"}
          </button>
        </form>

        <aside className="white-label-preview" aria-label="Member portal preview">
          <div className="white-label-preview__device" style={previewStyle}>
            <header>
              {draft.logoUrl && logoUrlIsValid ? (
                <img src={draft.logoUrl} alt={`${brand.name} logo preview`} />
              ) : (
                <span aria-hidden="true">
                  <ShieldCheck />
                </span>
              )}
              <strong>{draft.portalTitle || brand.name}</strong>
            </header>
            <main>
              <p>Welcome back</p>
              <h2>Your next club release</h2>
              <div className="white-label-preview__shipment">
                <span>Release details come from live member data.</span>
                <strong>View shipment</strong>
              </div>
              <button type="button">Manage membership</button>
            </main>
          </div>
          <p>
            Preview content demonstrates layout only. Production values remain
            API-driven and are never seeded from this configuration screen.
          </p>
        </aside>
      </div>

      <form
        className="operation-panel custom-domain-panel"
        onSubmit={verifyDomain}
      >
        <div className="panel-heading">
          <span className="foundation-card__icon foundation-card__icon--gold">
            <Globe2 aria-hidden="true" />
          </span>
          <div>
            <h2>Custom portal hostname</h2>
            <p>
              Cloudflare provisions SSL only after the CNAME is verified and
              ownership policy passes.
            </p>
          </div>
        </div>
        <div className="custom-domain-panel__controls">
          <div className="form-field">
            <label htmlFor="custom-hostname">Hostname</label>
            <input
              id="custom-hostname"
              required
              inputMode="url"
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              placeholder="club.example.com"
            />
          </div>
          <button className="button button--primary" disabled={busy !== null}>
            {busy === "domain" ? "Checking DNS…" : "Verify domain"}
          </button>
          {brand.customDomain || verification ? (
            <button
              type="button"
              className="button button--secondary"
              disabled={busy !== null}
              onClick={() => void removeDomain()}
            >
              {busy === "remove-domain" ? "Removing…" : "Remove"}
            </button>
          ) : null}
        </div>
        {verification?.validation ? (
          <div className="dns-instructions" role="status">
            <div>
              <strong>{verification.validation.type}</strong>
              <span>{verification.validation.name}</span>
            </div>
            <code>{verification.validation.value}</code>
            <button
              type="button"
              className="icon-button"
              aria-label="Copy DNS verification value"
              onClick={() =>
                void navigator.clipboard.writeText(
                  verification.validation!.value,
                )
              }
            >
              <Copy aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <dl className="domain-status-list">
          <div>
            <dt>Domain</dt>
            <dd>{verification?.status ?? brand.domainStatus}</dd>
          </div>
          <div>
            <dt>SSL</dt>
            <dd>{verification?.sslStatus ?? brand.sslStatus ?? "unconfigured"}</dd>
          </div>
          <div>
            <dt>Sender domain</dt>
            <dd>{brand.emailDomainStatus ?? "unconfigured"}</dd>
          </div>
        </dl>
      </form>
    </StaffShell>
  );
}
