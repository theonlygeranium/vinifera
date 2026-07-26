// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  StaffBrandingProvider,
  useMemberBranding,
} from "../../src/client/member/MemberBranding";
import { MetaPrivacyControl } from "../../src/client/member/MetaPrivacyControl";
import {
  collectFirstPartyMetaAttribution,
  META_PRIVACY_POLICY_VERSION,
} from "../../src/client/member/metaAttribution";

const apiRequest = vi.hoisted(() => vi.fn());
const putJson = vi.hoisted(() => vi.fn());

vi.mock("../../src/client/api/client", () => ({
  apiRequest,
  putJson,
}));

function BrandingProbe() {
  const branding = useMemberBranding();
  return <span data-testid="brand-name">{branding.portalTitle}</span>;
}

afterEach(() => {
  cleanup();
  apiRequest.mockReset();
  putJson.mockReset();
});

describe("Phase 5 first-party brand and attribution seams", () => {
  it("applies a validated custom-host theme to the staff surface", async () => {
    apiRequest.mockResolvedValue({
      brand: {
        fontFamily: "Georgia",
        logoUrl: "https://assets.example.test/club.svg",
        name: "North Block",
        portalTitle: "North Block Club",
        primaryColor: "#6b1e30",
        secondaryColor: "#c9993a",
      },
      mode: "custom",
    });
    const { container } = render(
      <StaffBrandingProvider>
        <BrandingProbe />
      </StaffBrandingProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("brand-name")).toHaveTextContent(
        "North Block Club",
      );
    });
    const surface = container.querySelector<HTMLElement>(
      ".staff-brand-surface",
    );
    expect(apiRequest).toHaveBeenCalledWith("/api/portal/branding");
    expect(surface?.style.getPropertyValue("--wine")).toBe("#6b1e30");
    expect(surface?.style.getPropertyValue("--gold")).toBe("#c9993a");
    expect(surface?.style.getPropertyValue("--member-font")).toBe("Georgia");
  });

  it("falls back to canonical staff branding when a host theme is unsafe", async () => {
    apiRequest.mockResolvedValue({
      brand: {
        fontFamily: "Comic Sans MS",
        logoUrl: "javascript:alert(1)",
        name: "Unsafe",
        portalTitle: "Unsafe",
        primaryColor: "#ffffff",
        secondaryColor: "#ffffff",
      },
      mode: "custom",
    });
    render(
      <StaffBrandingProvider>
        <BrandingProbe />
      </StaffBrandingProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("brand-name")).toHaveTextContent("Vinifera");
    });
  });

  it("reads browser attribution only after consent and preserves first-party context", () => {
    const pageUrl =
      "https://club.example.test/join?fbclid=click_123&utm_id=launch&utm_campaign=Summer&utm_source=meta&utm_medium=paid";
    expect(
      collectFirstPartyMetaAttribution({
        consented: false,
        cookieHeader:
          "_fbc=fb.1.1721995200000.private; _fbp=fb.1.1721995200000.browser",
        now: 1721995200000,
        pageUrl,
      }),
    ).toBeNull();
    expect(
      collectFirstPartyMetaAttribution({
        consented: true,
        cookieHeader: "_fbp=fb.1.1721995200000.browser_123",
        now: 1721995200000,
        pageUrl,
      }),
    ).toMatchObject({
      campaignId: "launch",
      campaignName: "Summer",
      eventSourceUrl: pageUrl,
      fbc: "fb.1.1721995200000.click_123",
      fbp: "fb.1.1721995200000.browser_123",
      medium: "paid",
      occurredAt: "2024-07-26T12:00:00.000Z",
      source: "meta",
    });
  });

  it("offers explicit versioned accept and decline controls in the member portal", async () => {
    apiRequest.mockResolvedValue({
      consentSource: null,
      consented: null,
      consentedAt: null,
      policyVersion: null,
      revokedAt: null,
      updatedAt: null,
    });
    putJson.mockResolvedValue({
      attributionCaptured: true,
      attributionId: "40000000-0000-4000-8000-000000000001",
      consented: true,
    });
    render(<MetaPrivacyControl />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Allow attribution" }),
    );
    await waitFor(() => {
      expect(putJson).toHaveBeenCalledWith(
        "/api/member/privacy/meta",
        expect.objectContaining({
          attribution: expect.objectContaining({
            eventSourceUrl: window.location.href,
          }),
          clientEventId: expect.any(String),
          consentSource: "member_portal_accept",
          consented: true,
          policyVersion: META_PRIVACY_POLICY_VERSION,
        }),
      );
    });

    putJson.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => {
      expect(putJson).toHaveBeenCalledWith("/api/member/privacy/meta", {
        consentSource: "member_portal_decline",
        consented: false,
        policyVersion: META_PRIVACY_POLICY_VERSION,
      });
    });
  });

  it("offers an explicit revoke control for stored consent", async () => {
    apiRequest.mockResolvedValue({
      consentSource: "member_portal_accept",
      consented: true,
      consentedAt: "2026-07-26T12:00:00.000Z",
      policyVersion: META_PRIVACY_POLICY_VERSION,
      revokedAt: null,
      updatedAt: "2026-07-26T12:00:00.000Z",
    });
    putJson.mockResolvedValue({
      attributionCaptured: false,
      attributionId: null,
      consented: false,
    });
    render(<MetaPrivacyControl />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke consent" }),
    );
    await waitFor(() => {
      expect(putJson).toHaveBeenCalledWith("/api/member/privacy/meta", {
        consentSource: "member_portal_revoke",
        consented: false,
        policyVersion: META_PRIVACY_POLICY_VERSION,
      });
    });
  });
});
