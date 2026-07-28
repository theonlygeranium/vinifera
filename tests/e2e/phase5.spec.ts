import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";

const organizationId = "10000000-0000-4000-8000-000000000001";
const brandId = "11000000-0000-4000-8000-000000000001";
const secondBrandId = "11000000-0000-4000-8000-000000000002";

const staffSession = {
  access: { graceEndsAt: null, state: "active", suspendedAt: null },
  authenticated: true,
  organization: {
    accessState: "active",
    id: organizationId,
    name: "QA Wine Group",
    planTier: "reserve",
    stripeCustomerId: "cus_phase5_test",
    stripeSubscriptionId: "sub_phase5_test",
    subscriptionStatus: "active",
  },
  user: {
    email: "owner@example.com",
    fullName: "QA Owner",
    id: "20000000-0000-4000-8000-000000000001",
    role: "owner",
  },
};

const brands = [
  {
    billingMode: "shared",
    customDomain: "club.qa-winery.example",
    description: "Estate-grown releases",
    domainStatus: "pending_validation",
    emailDomainStatus: "pending",
    emailSenderAddress: "club@qa-winery.example",
    emailSenderName: "QA Estate Club",
    fontFamily: "Inter",
    id: brandId,
    isDefault: true,
    logoUrl: null,
    name: "QA Estate",
    portalTitle: "QA Estate Wine Club",
    primaryColor: "#6b1e30",
    secondaryColor: "#c9993a",
    slug: "qa-estate",
    sslStatus: "pending",
  },
  {
    billingMode: "independent",
    customDomain: null,
    description: "Small-lot cellar program",
    domainStatus: "unconfigured",
    emailDomainStatus: "unconfigured",
    emailSenderAddress: null,
    emailSenderName: "QA Cellars",
    fontFamily: "Georgia",
    id: secondBrandId,
    isDefault: false,
    logoUrl: null,
    name: "QA Cellars",
    portalTitle: "QA Cellars Membership",
    primaryColor: "#184c3b",
    secondaryColor: "#bb8730",
    slug: "qa-cellars",
    sslStatus: "unconfigured",
  },
] as const;

const integrations = {
  health: { active: 1, activationRequired: 1, degraded: 1 },
  items: [
    {
      capabilities: ["profiles", "lists", "events"],
      consentedAt: null,
      lastErrorCode: null,
      lastSuccessAt: null,
      lastSyncAt: null,
      optedIn: false,
      status: "activation_required",
      syncConfig: {},
      type: "klaviyo",
    },
    {
      capabilities: ["sales_receipts", "refunds", "reconciliation"],
      consentedAt: "2026-07-26T16:00:00.000Z",
      lastErrorCode: null,
      lastSuccessAt: "2026-07-26T17:00:00.000Z",
      lastSyncAt: "2026-07-26T17:00:00.000Z",
      optedIn: true,
      status: "active",
      syncConfig: {
        currencyCode: "USD",
        defaultCustomerRef: "QBO-CUSTOMER-10",
        defaultItemRef: "QBO-ITEM-20",
        depositAccountRef: "QBO-ACCOUNT-30",
        exchangeRate: 1,
        syncFrequency: "daily",
        taxCodeRef: "QBO-TAX-40",
      },
      type: "quickbooks",
    },
    {
      capabilities: ["tax_calculation", "liability"],
      consentedAt: "2026-07-26T16:00:00.000Z",
      lastErrorCode: "PROVIDER_TIMEOUT",
      lastSuccessAt: "2026-07-25T17:00:00.000Z",
      lastSyncAt: "2026-07-26T17:00:00.000Z",
      optedIn: true,
      status: "degraded",
      syncConfig: {
        accountId: "QA-AV-001",
        companyCode: "QA",
        environment: "sandbox",
        filingEnabled: false,
        syncFrequency: "realtime",
      },
      type: "avalara",
    },
    {
      capabilities: ["server_events"],
      consentedAt: "2026-07-26T16:00:00.000Z",
      lastErrorCode: null,
      lastSuccessAt: null,
      lastSyncAt: null,
      optedIn: true,
      status: "configured",
      syncConfig: {
        graphApiVersion: "v24.0",
        pixelId: "pixel_qa_001",
        syncFrequency: "realtime",
      },
      type: "meta",
    },
  ],
};

type CapturedRequest = {
  body?: Record<string, unknown>;
  brandId: string | null;
  method: string;
  path: string;
  search: string;
};

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    body: JSON.stringify({ data }),
    contentType: "application/json",
    status,
  });
}

async function installPhase5Api(
  page: Page,
  capture: CapturedRequest[] = [],
  session: unknown = staffSession,
) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body =
      method !== "GET" && request.postData()
        ? (request.postDataJSON() as Record<string, unknown>)
        : undefined;
    capture.push({
      body,
      brandId: request.headers()["x-vinifera-brand-id"] ?? null,
      method,
      path: url.pathname,
      search: url.search,
    });

    if (url.pathname === "/api/auth/staff/session") {
      return json(route, session);
    }
    if (url.pathname === "/api/brands" && method === "GET") {
      return json(route, { canViewAllBrands: true, items: brands });
    }
    if (url.pathname === "/api/brands" && method === "POST") {
      return json(route, { ...brands[0], ...body, id: secondBrandId }, 201);
    }
    if (/^\/api\/brands\/[^/]+$/.test(url.pathname) && method === "PATCH") {
      return json(route, { ...brands[0], ...body });
    }
    if (
      /^\/api\/brands\/[^/]+\/sender\/verify$/.test(url.pathname) &&
      method === "POST"
    ) {
      return json(
        route,
        {
          dnsRecords: [
            {
              name: "send.qa-winery.example",
              record: "TXT",
              status: "pending",
              type: "TXT",
              value: "resend-verification=qa-token",
            },
          ],
          domain: "qa-winery.example",
          status: "pending",
        },
        202,
      );
    }
    if (
      /^\/api\/brands\/[^/]+\/domain$/.test(url.pathname) &&
      method === "PUT"
    ) {
      return json(route, {
        hostname: body?.hostname,
        sslStatus: "pending",
        status: "pending_validation",
        validation: {
          name: "_vinifera.club.qa-winery.example",
          type: "TXT",
          value: "vinifera-verification=qa-token",
        },
      });
    }
    if (
      /^\/api\/brands\/[^/]+\/domain$/.test(url.pathname) &&
      method === "DELETE"
    ) {
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === "/api/organization/overview") {
      return json(route, {
        activeMembers: 483,
        brandCount: 2,
        brands: [
          {
            activeMembers: 286,
            id: brandId,
            monthlyRecurringRevenueCents: 3425000,
            name: "QA Estate",
            shipmentsThisPeriod: 275,
          },
          {
            activeMembers: 197,
            id: secondBrandId,
            monthlyRecurringRevenueCents: 2180000,
            name: "QA Cellars",
            shipmentsThisPeriod: 183,
          },
        ],
        monthlyRecurringRevenueCents: 5605000,
        shipmentsThisPeriod: 458,
      });
    }
    if (url.pathname === "/api/analytics/dashboard") {
      return json(route, {
        generatedAt: "2026-07-26T17:00:00.000Z",
        range: {
          from: "2026-06-27",
          preset: "30d",
          to: "2026-07-26",
        },
      });
    }
    if (url.pathname === "/api/analytics/reports") {
      return json(route, { items: [] });
    }
    if (url.pathname === "/api/integrations" && method === "GET") {
      return json(route, integrations);
    }
    if (/^\/api\/integrations\/[^/]+\/logs$/.test(url.pathname)) {
      return json(route, {
        items: [
          {
            createdAt: "2026-07-26T17:00:00.000Z",
            errorCode: null,
            id: "12000000-0000-4000-8000-000000000001",
            recordsFailed: 0,
            recordsSynced: 286,
            status: "succeeded",
            syncType: "member_sync",
          },
        ],
      });
    }
    if (
      url.pathname === "/api/integrations/quickbooks/reconciliation" &&
      method === "GET"
    ) {
      return json(route, {
        currency: "USD",
        differenceCents: 0,
        period: "2026-07",
        quickbooksRevenueCents: 3425000,
        status: "matched",
        viniferaRevenueCents: 3425000,
      });
    }
    if (/^\/api\/integrations\/[^/]+\/sync$/.test(url.pathname)) {
      return json(route, {
        jobId: "13000000-0000-4000-8000-000000000001",
        status: "queued",
      }, 202);
    }
    if (
      /^\/api\/integrations\/[^/]+\/connect$/.test(url.pathname) &&
      method === "POST"
    ) {
      return json(route, { status: "configured" }, 201);
    }
    if (
      /^\/api\/integrations\/[^/]+$/.test(url.pathname) &&
      method === "PATCH"
    ) {
      return json(route, { status: "configured" });
    }
    if (
      /^\/api\/integrations\/[^/]+$/.test(url.pathname) &&
      method === "DELETE"
    ) {
      return route.fulfill({ status: 204 });
    }

    return route.fulfill({
      body: JSON.stringify({
        error: {
          code: "UNMOCKED_PHASE5_ROUTE",
          message: `No Phase 5 mock exists for ${method} ${url.pathname}.`,
        },
      }),
      contentType: "application/json",
      status: 501,
    });
  });
}

async function assertA11y(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(metrics.body).toBeLessThanOrEqual(metrics.viewport);
}

async function assertMobileTouchTargets(page: Page) {
  const tooSmall = await page
    .locator("button:visible, a[href]:visible, input:visible, select:visible")
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          const target =
            element instanceof HTMLInputElement &&
            (element.type === "checkbox" || element.type === "radio")
              ? (element.closest("label") ?? element)
              : element;
          const box = target.getBoundingClientRect();
          return {
            height: Math.round(box.height),
            label:
              element.getAttribute("aria-label") ||
              target.textContent?.trim().slice(0, 80) ||
              element.tagName,
            width: Math.round(box.width),
          };
        })
        .filter(({ height, width }) => height < 44 || width < 44),
    );
  expect(tooSmall).toEqual([]);
}

async function installWebVitalsProbe(page: Page) {
  await page.addInitScript(() => {
    const metrics = { cls: 0, lcp: 0 };
    Object.defineProperty(window, "__viniferaPhase5Metrics", {
      value: metrics,
    });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        metrics.lcp = Math.max(metrics.lcp, entry.startTime);
      }
    }).observe({ buffered: true, type: "largest-contentful-paint" });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          hadRecentInput: boolean;
          value: number;
        };
        if (!shift.hadRecentInput) metrics.cls += shift.value;
      }
    }).observe({ buffered: true, type: "layout-shift" });
  });
}

async function phase5WebVitals(page: Page) {
  await page.waitForTimeout(100);
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __viniferaPhase5Metrics: { cls: number; lcp: number };
        }
      ).__viniferaPhase5Metrics,
  );
}

test.describe("Phase 5 responsive production surfaces", () => {
  const routes = [
    { heading: "Integrations", path: "/app/integrations" },
    { heading: "Brands", path: "/app/brands" },
    { heading: "White-label", path: "/app/white-label" },
  ] as const;
  const viewports = [360, 375, 412, 430, 768, 1440] as const;

  for (const width of viewports) {
    for (const route of routes) {
      test(`${route.path} passes axe and layout QA at ${width}px`, async ({
        page,
      }) => {
        await installPhase5Api(page);
        await page.setViewportSize({
          height: width < 768 ? 900 : 1000,
          width,
        });
        await page.goto(route.path);
        await expect(
          page.getByRole("heading", { exact: true, name: route.heading }).first(),
        ).toBeVisible();
        await assertA11y(page);
        await assertNoHorizontalOverflow(page);
        if (width <= 430) await assertMobileTouchTargets(page);
        await expect(page.locator("vite-error-overlay")).toHaveCount(0);
        if (
          process.env.UPDATE_PHASE5_QA_EVIDENCE === "1" &&
          (width === 375 || width === 1440)
        ) {
          mkdirSync("docs/qa/phase-5", { recursive: true });
          await page.screenshot({
            fullPage: true,
            path: `docs/qa/phase-5/${route.path.split("/").at(-1)}-${width}.png`,
          });
        }
      });
    }
  }

  test("integration control center stays within the LCP and CLS budgets", async ({
    page,
  }) => {
    await installWebVitalsProbe(page);
    await installPhase5Api(page);
    await page.setViewportSize({ height: 812, width: 375 });
    await page.goto("/app/integrations");
    await expect(
      page.getByRole("heading", { exact: true, name: "Integrations" }).first(),
    ).toBeVisible();
    const metrics = await phase5WebVitals(page);
    expect(metrics.lcp).toBeGreaterThan(0);
    expect(metrics.lcp).toBeLessThan(2_500);
    expect(metrics.cls).toBeLessThan(0.1);
    console.log(
      `[phase5-performance] lcp=${metrics.lcp.toFixed(2)}ms cls=${metrics.cls.toFixed(4)}`,
    );
  });

  test("multi-brand dashboard becomes usable within two seconds", async ({
    page,
  }) => {
    await installPhase5Api(page);
    await page.setViewportSize({ height: 1000, width: 1440 });
    const startedAt = performance.now();
    await page.goto("/app/brands");
    await expect(
      page.getByRole("heading", { exact: true, name: "Brands" }).first(),
    ).toBeVisible();
    const brandList = page.locator(".brand-management-list");
    await expect(
      brandList.getByText("QA Estate", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      brandList.getByText("QA Cellars", { exact: true }).first(),
    ).toBeVisible();
    const usableMs = performance.now() - startedAt;
    expect(usableMs).toBeLessThan(2_000);
    console.log(
      `[phase5-performance] multi-brand-dashboard=${usableMs.toFixed(2)}ms`,
    );
  });
});

test.describe("Phase 5 provider and brand workflows", () => {
  test("brand-scoped integration configuration sends consent, mappings, and write-only credentials", async ({
    page,
  }) => {
    const capture: CapturedRequest[] = [];
    await installPhase5Api(page, capture);
    await page.goto("/app/integrations");
    await page
      .getByRole("button", { name: "Configure Klaviyo" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Klaviyo connection" });
    await dialog.getByRole("checkbox", { name: "Authorize this provider" }).check();
    await dialog.getByLabel("Private API key").fill("pk_qa_write_only");
    await dialog.getByLabel("Default member list ID").fill("qa_members");
    await dialog
      .getByRole("checkbox", {
        name: "I confirm this winery authorizes data sharing",
      })
      .check();
    await dialog.getByRole("button", { name: "Save connection" }).click();

    await expect(dialog.getByText("Provider status: Configured.")).toBeVisible();
    await expect(dialog.getByLabel("Private API key")).toHaveValue("");
    const request = capture.find(
      (entry) =>
        entry.method === "POST" &&
        entry.path === "/api/integrations/klaviyo/connect",
    );
    expect(request?.brandId).toBe(brandId);
    expect(request?.body).toMatchObject({
      brandId,
      consentConfirmed: true,
      optedIn: true,
      syncConfig: {
        listId: "qa_members",
        memberEmailField: "email",
      },
      credentials: { apiKey: "pk_qa_write_only" },
    });
  });

  test("organization aggregate access is explicit and brand creation is additive", async ({
    page,
  }) => {
    const capture: CapturedRequest[] = [];
    await installPhase5Api(page, capture);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/app/brands");
    await expect(page.getByLabel("Active brand")).toHaveCSS("font-size", "16px");
    await page.getByLabel("Active brand").selectOption("all");
    await expect(page).toHaveURL(/\/app\/brands\?scope=all$/);
    await expect(
      page.getByRole("heading", { name: "All brands overview" }),
    ).toBeVisible();
    await expect(
      page
        .locator(".brand-management-list article")
        .filter({ hasText: "QA Estate" })
        .getByText("Portal Pending Validation"),
    ).toBeVisible();
    await expect(
      page
        .locator(".brand-management-list article")
        .filter({ hasText: "QA Cellars" })
        .getByText("Portal Unconfigured"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add brand" }).click();
    const dialog = page.getByRole("dialog", { name: "Create a brand" });
    await dialog.getByLabel("Brand name").fill("QA Mountain");
    await expect(dialog.getByLabel("Brand URL slug")).toHaveValue("qa-mountain");
    await dialog.getByRole("button", { name: "Create brand" }).click();

    const create = capture.find(
      (entry) => entry.method === "POST" && entry.path === "/api/brands",
    );
    expect(create?.body).toMatchObject({
      billingMode: "shared",
      name: "QA Mountain",
      slug: "qa-mountain",
    });
    expect(
      capture.some(
        (entry) =>
          entry.path === "/api/organization/overview" &&
          entry.brandId === null,
      ),
    ).toBe(true);
  });

  test("manager can work in a brand but cannot discover brand mutation controls", async ({
    page,
  }) => {
    await installPhase5Api(page, [], {
      ...staffSession,
      user: { ...staffSession.user, role: "manager" },
    });
    await page.goto("/app/brands");

    await expect(page.getByRole("button", { name: "Work in brand" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Add brand" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create brand" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  });

  test("all-brand Analytics stays on its route and refetches after selecting one brand", async ({
    page,
  }) => {
    const capture: CapturedRequest[] = [];
    await installPhase5Api(page, capture);
    await page.goto("/app/analytics?scope=all");
    await expect(
      page.getByRole("heading", { exact: true, name: "Analytics" }).first(),
    ).toBeVisible();
    await expect(page.getByLabel("Active brand")).toHaveValue("all");
    await expect
      .poll(
        () =>
          capture.some(
            (entry) =>
              entry.path === "/api/analytics/dashboard" &&
              entry.brandId === null &&
              new URLSearchParams(entry.search).get("scope") === "all",
          ),
      )
      .toBe(true);

    await page.getByLabel("Active brand").selectOption(secondBrandId);
    await expect(page).toHaveURL(/\/app\/analytics$/);
    await expect(page.getByLabel("Active brand")).toHaveValue(secondBrandId);
    await expect
      .poll(
        () =>
          capture.some(
            (entry) =>
              entry.path === "/api/analytics/dashboard" &&
              entry.brandId === secondBrandId &&
              !new URLSearchParams(entry.search).has("scope"),
          ),
      )
      .toBe(true);
  });

  test("QuickBooks reference IDs and exchange metadata persist through the exact PATCH contract", async ({
    page,
  }) => {
    const capture: CapturedRequest[] = [];
    await installPhase5Api(page, capture);
    await page.goto("/app/integrations");
    await page
      .getByRole("button", { name: "Configure QuickBooks Online" })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "QuickBooks Online connection",
    });
    await expect(dialog.getByLabel("Deposit account reference ID")).toHaveValue(
      "QBO-ACCOUNT-30",
    );
    await dialog
      .getByLabel("Default item reference ID")
      .fill("QBO-ITEM-UPDATED");
    await dialog
      .getByRole("checkbox", {
        name: "I confirm this winery authorizes data sharing",
      })
      .check();
    await dialog.getByRole("button", { name: "Save connection" }).click();
    const update = capture.find(
      (entry) =>
        entry.method === "PATCH" &&
        entry.path === "/api/integrations/quickbooks",
    );
    expect(update?.brandId).toBe(brandId);
    expect(update?.body).toEqual({
      consentConfirmed: true,
      credentials: {},
      optedIn: true,
      syncConfig: {
        currencyCode: "USD",
        defaultCustomerRef: "QBO-CUSTOMER-10",
        defaultItemRef: "QBO-ITEM-UPDATED",
        depositAccountRef: "QBO-ACCOUNT-30",
        exchangeRate: 1,
        syncFrequency: "daily",
        taxCodeRef: "QBO-TAX-40",
      },
    });
  });

  test("white-label controls block low contrast and expose DNS verification without production fixtures", async ({
    page,
  }) => {
    const capture: CapturedRequest[] = [];
    await installPhase5Api(page, capture);
    await page.goto("/app/white-label");
    await page.getByLabel("Primary color hex").fill("#777777");
    await expect(
      page.getByRole("alert").filter({
        hasText: "Both theme colors must support at least 4.5:1",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save brand experience" }),
    ).toBeDisabled();

    await page.getByLabel("Primary color hex").fill("#6b1e30");
    await page.getByLabel("Hostname").fill("members.qa-winery.example");
    await page.getByRole("button", { name: "Verify domain" }).click();
    await expect(page.getByText("_vinifera.club.qa-winery.example")).toBeVisible();
    expect(
      capture.find(
        (entry) =>
          entry.method === "PUT" &&
          entry.path === `/api/brands/${brandId}/domain`,
      )?.body,
    ).toEqual({ hostname: "members.qa-winery.example" });
  });

  test("sender verification persists the current draft before requesting DNS activation", async ({
    page,
  }) => {
    const capture: CapturedRequest[] = [];
    await installPhase5Api(page, capture);
    await page.goto("/app/white-label");
    await page
      .getByLabel("Sender address")
      .fill("members@qa-winery.example");
    await page
      .getByRole("button", { name: "Verify sender domain" })
      .click();
    await expect(page.getByText("resend-verification=qa-token")).toBeVisible();

    const patchIndex = capture.findIndex(
      (entry) =>
        entry.method === "PATCH" &&
        entry.path === `/api/brands/${brandId}` &&
        entry.body?.emailSenderAddress === "members@qa-winery.example",
    );
    const verifyIndex = capture.findIndex(
      (entry) =>
        entry.method === "POST" &&
        entry.path === `/api/brands/${brandId}/sender/verify`,
    );
    expect(patchIndex).toBeGreaterThan(-1);
    expect(verifyIndex).toBeGreaterThan(patchIndex);
  });
});

test.describe("Phase 5 verified-host member branding", () => {
  async function installPortalApi(
    page: Page,
    branding: unknown,
    brandingGate?: Promise<void>,
  ) {
    await page.route("https://cdn.qa-winery.example/logo.svg", (route) =>
      route.fulfill({
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#184c3b"/></svg>',
        contentType: "image/svg+xml",
      }),
    );
    await page.route("**/api/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/portal/branding") {
        await brandingGate;
        return json(route, branding);
      }
      if (pathname === "/api/auth/member/session") {
        return json(route, { authenticated: false });
      }
      return route.fulfill({ status: 501 });
    });
  }

  test("active verified-host branding renders only after resolution", async ({
    page,
  }) => {
    let releaseBranding = () => {};
    const brandingGate = new Promise<void>((resolve) => {
      releaseBranding = resolve;
    });
    await installPortalApi(
      page,
      {
        brand: {
          fontFamily: "Georgia",
          logoUrl: "https://cdn.qa-winery.example/logo.svg",
          name: "QA Estate",
          portalTitle: "QA Estate Wine Club",
          primaryColor: "#184c3b",
          secondaryColor: "#bb8730",
        },
        mode: "custom",
      },
      brandingGate,
    );
    await page.goto("/portal/login");
    await expect(page.getByText("Loading member portal…")).toBeVisible();
    await expect(page.locator(".member-brand-surface")).toHaveCount(0);
    releaseBranding();
    await expect(
      page.getByRole("link", { name: "QA Estate Wine Club home" }),
    ).toBeVisible();
    await expect(page).toHaveTitle("QA Estate Wine Club");
    await expect(page.locator(".brand__mark--custom img")).toHaveAttribute(
      "src",
      "https://cdn.qa-winery.example/logo.svg",
    );
    await expect(page.locator(".member-brand-surface")).toHaveCSS(
      "--member-primary",
      "#184c3b",
    );
    expect(
      await page.locator(".member-brand-surface").evaluate(
        (element) => getComputedStyle(element).fontFamily,
      ),
    ).toContain("Georgia");
    await page.getByRole("link", { name: "Winery staff sign in" }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page).toHaveTitle("Vinifera Club Management");
  });

  test("canonical response renders Vinifera defaults", async ({ page }) => {
    await installPortalApi(page, { brand: null, mode: "canonical" });
    await page.goto("/portal/login");
    await expect(
      page.getByRole("link", { name: "Vinifera home" }),
    ).toBeVisible();
    await expect(page.locator(".brand__mark--custom")).toHaveCount(0);
    await expect(page.locator(".member-brand-surface")).toHaveCSS(
      "--member-primary",
      "#6b1e30",
    );
  });

  test("malformed custom response fails closed to canonical branding", async ({
    page,
  }) => {
    await installPortalApi(page, {
      brand: {
        fontFamily: "url(https://unsafe.example/font)",
        logoUrl: "https://user:pass@unsafe.example/logo.svg",
        name: "<script>unsafe</script>",
        portalTitle: "Unsafe",
        primaryColor: "red; background:url(https://unsafe.example)",
        secondaryColor: "#ffffff",
      },
      mode: "custom",
    });
    await page.goto("/portal/login");
    await expect(
      page.getByRole("link", { name: "Vinifera home" }),
    ).toBeVisible();
    await expect(page.getByText("Unsafe", { exact: true })).toHaveCount(0);
    await expect(page.locator(".member-brand-surface")).toHaveCSS(
      "--member-primary",
      "#6b1e30",
    );
  });

  test("native callback path fails safely in a web browser", async ({ page }) => {
    await installPortalApi(page, { brand: null, mode: "canonical" });
    await page.goto("/portal/auth?code=not-a-web-pkce-code");
    await expect(page).toHaveURL(/\/portal\/login\?error=invalid_link$/);
    await expect(
      page.getByText(
        "That magic link is invalid or expired. Request a new link below.",
      ),
    ).toBeVisible();
  });
});
