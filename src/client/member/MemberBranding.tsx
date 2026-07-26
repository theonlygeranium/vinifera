import { Grape } from "lucide-react";
import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiRequest } from "../api/client";
import { Link } from "../routes/router";
import { LoadingScreen } from "../shared/LoadingScreen";

const CANONICAL_BRAND = {
  fontFamily: "system-ui",
  logoUrl: null,
  name: "Vinifera",
  portalTitle: "Vinifera",
  primaryColor: "#6b1e30",
  secondaryColor: "#c9993a",
} as const;

const ALLOWED_FONTS = new Set(["system-ui", "Georgia", "Arial"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export interface MemberBranding {
  fontFamily: string;
  logoUrl: string | null;
  mode: "custom" | "canonical";
  name: string;
  portalTitle: string;
  primaryColor: string;
  secondaryColor: string;
}

const MemberBrandingContext = createContext<MemberBranding>({
  ...CANONICAL_BRAND,
  mode: "canonical",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function channel(value: number) {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function contrastAgainstText(hex: string) {
  const rgb = [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  const luminance =
    0.2126 * channel(rgb[0]!) +
    0.7152 * channel(rgb[1]!) +
    0.0722 * channel(rgb[2]!);
  const white = 1.05 / (luminance + 0.05);
  const darkLuminance =
    0.2126 * channel(26) + 0.7152 * channel(0) + 0.0722 * channel(9);
  const dark = (luminance + 0.05) / (darkLuminance + 0.05);
  return {
    foreground: white >= dark ? "#ffffff" : "#1a0009",
    ratio: Math.max(white, dark),
  };
}

function safeLogoUrl(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      Boolean(url.hostname)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeMemberBranding(value: unknown): MemberBranding {
  if (!isRecord(value) || value.mode !== "custom" || !isRecord(value.brand)) {
    return { ...CANONICAL_BRAND, mode: "canonical" };
  }
  const brand = value.brand;
  const logoUrl = safeLogoUrl(brand.logoUrl);
  const fontFamily =
    brand.fontFamily === "Inter" || brand.fontFamily === "Source Sans 3"
      ? "system-ui"
      : brand.fontFamily;
  const valid =
    typeof brand.name === "string" &&
    brand.name.trim().length > 0 &&
    brand.name.length <= 200 &&
    typeof brand.portalTitle === "string" &&
    brand.portalTitle.trim().length > 0 &&
    brand.portalTitle.length <= 200 &&
    typeof brand.primaryColor === "string" &&
    HEX_COLOR.test(brand.primaryColor) &&
    typeof brand.secondaryColor === "string" &&
    HEX_COLOR.test(brand.secondaryColor) &&
    typeof fontFamily === "string" &&
    ALLOWED_FONTS.has(fontFamily) &&
    logoUrl !== undefined &&
    contrastAgainstText(brand.primaryColor).ratio >= 4.5 &&
    contrastAgainstText(brand.secondaryColor).ratio >= 4.5;
  if (!valid) return { ...CANONICAL_BRAND, mode: "canonical" };
  return {
    fontFamily: fontFamily as string,
    logoUrl: logoUrl ?? null,
    mode: "custom",
    name: (brand.name as string).trim(),
    portalTitle: (brand.portalTitle as string).trim(),
    primaryColor: (brand.primaryColor as string).toLowerCase(),
    secondaryColor: (brand.secondaryColor as string).toLowerCase(),
  };
}

function BrandingProvider({
  children,
  loadingLabel,
  surfaceClassName,
}: {
  children: ReactNode;
  loadingLabel: string;
  surfaceClassName: "member-brand-surface" | "staff-brand-surface";
}) {
  const [branding, setBranding] = useState<MemberBranding | null>(null);

  useEffect(() => {
    let active = true;
    void apiRequest<unknown>("/api/portal/branding")
      .then((response) => {
        if (active) setBranding(normalizeMemberBranding(response));
      })
      .catch(() => {
        if (active) {
          setBranding({ ...CANONICAL_BRAND, mode: "canonical" });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const style = useMemo(() => {
    if (!branding) return undefined;
    const primary = contrastAgainstText(branding.primaryColor);
    const secondary = contrastAgainstText(branding.secondaryColor);
    return {
      "--gold": branding.secondaryColor,
      "--member-font": branding.fontFamily,
      "--member-primary": branding.primaryColor,
      "--member-primary-ink": primary.foreground,
      "--member-secondary": branding.secondaryColor,
      "--member-secondary-ink": secondary.foreground,
      "--wine": branding.primaryColor,
    } as CSSProperties;
  }, [branding]);

  if (!branding) {
    return <LoadingScreen label={loadingLabel} />;
  }

  return (
    <MemberBrandingContext.Provider value={branding}>
      <div className={surfaceClassName} style={style}>
        {children}
      </div>
    </MemberBrandingContext.Provider>
  );
}

export function MemberBrandingProvider({ children }: { children: ReactNode }) {
  return (
    <BrandingProvider
      loadingLabel="Loading member portal"
      surfaceClassName="member-brand-surface"
    >
      {children}
    </BrandingProvider>
  );
}

export function StaffBrandingProvider({ children }: { children: ReactNode }) {
  return (
    <BrandingProvider
      loadingLabel="Loading staff portal"
      surfaceClassName="staff-brand-surface"
    >
      {children}
    </BrandingProvider>
  );
}

export function useMemberBranding() {
  return useContext(MemberBrandingContext);
}

export function MemberBrand({
  compact = false,
  inverse = false,
  homeHref = "/portal",
}: {
  compact?: boolean;
  inverse?: boolean;
  homeHref?: string;
}) {
  const branding = useMemberBranding();
  return (
    <Link
      to={homeHref}
      className={`brand${compact ? " brand--compact" : ""}${
        inverse ? " brand--inverse" : ""
      }`}
      aria-label={`${branding.portalTitle} home`}
    >
      {branding.logoUrl ? (
        <span className="brand__mark brand__mark--custom" aria-hidden="true">
          <img src={branding.logoUrl} alt="" />
        </span>
      ) : (
        <span className="brand__mark" aria-hidden="true">
          <Grape size={18} strokeWidth={2.2} />
        </span>
      )}
      <span className="brand__wordmark">
        <strong>{branding.portalTitle}</strong>
        {compact ? null : <small>{branding.name}</small>}
      </span>
    </Link>
  );
}
