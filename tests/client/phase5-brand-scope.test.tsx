// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider } from "../../src/client/routes/router";
import {
  BrandScopeProvider,
  useBrandScope,
} from "../../src/client/staff/phase5/BrandScopeContext";

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock("../../src/client/api/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/api/client")>();
  return { ...actual, apiRequest };
});

const firstBrandId = "11000000-0000-4000-8000-000000000001";
const secondBrandId = "11000000-0000-4000-8000-000000000002";
const brands = [
  {
    billingMode: "shared" as const,
    customDomain: null,
    description: null,
    domainStatus: "unconfigured" as const,
    id: firstBrandId,
    isDefault: true,
    name: "Estate",
    slug: "estate",
    sslStatus: "unconfigured" as const,
  },
  {
    billingMode: "independent" as const,
    customDomain: null,
    description: null,
    domainStatus: "unconfigured" as const,
    id: secondBrandId,
    isDefault: false,
    name: "Cellars",
    slug: "cellars",
    sslStatus: "unconfigured" as const,
  },
];

function Probe() {
  const scope = useBrandScope();
  const [draft, setDraft] = useState("");
  return (
    <>
      <span data-testid="scope">{scope.activeBrandId}</span>
      <input
        aria-label="Brand-local draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        type="button"
        onClick={() => scope.setActiveBrandId(secondBrandId)}
      >
        Choose Cellars
      </button>
      <button type="button" onClick={() => scope.setActiveBrandId("all")}>
        Choose all
      </button>
      <button type="button" onClick={() => void scope.refresh()}>
        Refresh brands
      </button>
    </>
  );
}

function renderScope() {
  return render(
    <RouterProvider>
      <BrandScopeProvider>
        <Probe />
      </BrandScopeProvider>
    </RouterProvider>,
  );
}

describe("Phase 5 brand scope boundary", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({ canViewAllBrands: true, items: brands });
    window.localStorage.clear();
    window.history.replaceState(null, "", "/app/analytics?scope=all");
  });

  afterEach(() => cleanup());

  it("preserves all-brand analytics through refresh and clears it for one brand", async () => {
    renderScope();
    await screen.findByTestId("scope");
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent("all"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh brands" }));
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent("all"),
    );
    expect(window.location.search).toBe("?scope=all");

    fireEvent.change(screen.getByLabelText("Brand-local draft"), {
      target: { value: "unsaved brand A state" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose Cellars" }));
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent(secondBrandId),
    );
    expect(window.location.pathname).toBe("/app/analytics");
    expect(window.location.search).toBe("");
    expect(screen.getByLabelText("Brand-local draft")).toHaveValue("");
  });

  it("keeps the user on Analytics when selecting the aggregate scope", async () => {
    window.history.replaceState(null, "", "/app/analytics");
    window.localStorage.setItem("vinifera.active-brand", firstBrandId);
    renderScope();
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent(firstBrandId),
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose all" }));
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent("all"),
    );
    expect(window.location.pathname).toBe("/app/analytics");
    expect(window.location.search).toBe("?scope=all");
  });

  it("blocks tenant data behind a retryable brand-catalog error", async () => {
    apiRequest
      .mockRejectedValueOnce(new Error("Brand access is temporarily unavailable."))
      .mockResolvedValueOnce({ canViewAllBrands: true, items: brands });
    renderScope();

    expect(
      await screen.findByText("Brand access is temporarily unavailable."),
    ).toBeVisible();
    expect(screen.queryByTestId("scope")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent("all"),
    );
  });
});
