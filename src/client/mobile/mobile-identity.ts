import identity from "../../../mobile/app-identity.json";

export const MOBILE_APP_ID = identity.appId;
export const MOBILE_AUTH_REDIRECT_URI =
  `${identity.customScheme}://${identity.mobileAuthRedirectPath.slice(1)}`;
export const MOBILE_CUSTOM_SCHEME = identity.customScheme;
export const MOBILE_EXTERNAL_DEEP_LINK_PATHS = Object.freeze(
  [...identity.externalDeepLinkPaths],
);
export const MOBILE_UNIVERSAL_LINK_HOST = identity.universalLinkHost;

const allowedDeepLinks = new Set(MOBILE_EXTERNAL_DEEP_LINK_PATHS);

export function isAllowedMobileDeepLinkPath(path: string): boolean {
  return allowedDeepLinks.has(path);
}

export function routeFromMobileUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const isCustomScheme = url.protocol === `${MOBILE_CUSTOM_SCHEME}:`;
  const isUniversalLink =
    url.protocol === "https:" &&
    url.hostname === MOBILE_UNIVERSAL_LINK_HOST;
  if (!isCustomScheme && !isUniversalLink) return null;
  const path = isCustomScheme
    ? `/${url.hostname}${url.pathname}`.replace(/\/+$/, "")
    : url.pathname.replace(/\/+$/, "");
  const normalized = path || "/portal";
  if (!isAllowedMobileDeepLinkPath(normalized)) return null;
  return { path: normalized, search: url.searchParams };
}
