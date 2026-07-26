import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

// Phase 2 contains a strict subsecond roster gate. Video encoding distorts that
// timing; explicit visual screenshots remain part of this suite's evidence.
test.use({ video: "off" });

const organizationId = "10000000-0000-4000-8000-000000000001";
const memberId = "30000000-0000-4000-8000-000000000001";
const tierId = "40000000-0000-4000-8000-000000000001";
const releaseId = "50000000-0000-4000-8000-000000000001";
const shipmentId = "60000000-0000-4000-8000-000000000001";

const staffSession = {
  access: { graceEndsAt: null, state: "active", suspendedAt: null },
  authenticated: true,
  organization: {
    accessState: "active",
    id: organizationId,
    name: "QA Winery",
    planTier: "vine",
    stripeCustomerId: "cus_test",
    stripeSubscriptionId: "sub_test",
    subscriptionStatus: "active",
  },
  user: {
    email: "owner@example.com",
    fullName: "QA Owner",
    id: "20000000-0000-4000-8000-000000000001",
    role: "owner",
  },
};

const memberSession = {
  authenticated: true,
  organization: { id: organizationId, name: "QA Winery" },
  user: {
    email: "avery@example.com",
    firstName: "Avery",
    id: memberId,
    lastName: "Vine",
    status: "active",
  },
};

const tier = {
  billingInterval: "quarterly",
  bottleCount: 3,
  description: "Estate allocations and member events.",
  frequency: "quarterly",
  id: tierId,
  memberCount: 1,
  name: "Founders Circle",
  priceCents: 14900,
  upgradePathId: null,
};

const member = {
  address: {
    city: "Napa",
    country: "US",
    line1: "123 Vine Street",
    line2: null,
    postalCode: "94558",
    state: "CA",
  },
  churnRisk: "not_scored",
  communicationCount: 1,
  communications: [
    {
      detail: "Email",
      id: "71000000-0000-4000-8000-000000000001",
      kind: "communication",
      occurredAt: "2026-07-03T12:00:00.000Z",
      title: "Welcome to the club",
    },
  ],
  email: "avery@example.com",
  firstName: "Avery",
  id: memberId,
  joinedAt: "2026-01-15",
  lastName: "Vine",
  lifetimeValueCents: 44700,
  orderCount: 3,
  phone: "707-555-0100",
  status: "active",
  tier: { id: tierId, name: "Founders Circle" },
  activity: [
    {
      detail: "$151.00",
      id: "70000000-0000-4000-8000-000000000001",
      kind: "payment",
      occurredAt: "2026-07-04T12:00:00.000Z",
      title: "Payment succeeded",
    },
    {
      id: "70000000-0000-4000-8000-000000000002",
      kind: "status",
      occurredAt: "2026-07-02T12:00:00.000Z",
      title: "Membership paused",
    },
  ],
  historyMeta: {
    activityLimit: 20,
    activityTruncated: false,
    communicationLimit: 10,
    communicationsTruncated: false,
    orderLimit: 20,
    ordersTruncated: false,
  },
  orders: [
    {
      createdAt: "2026-07-01T12:00:00.000Z",
      discountAmountCents: 1000,
      id: "72000000-0000-4000-8000-000000000001",
      items: [{ name: "Estate Cabernet", quantity: 3 }],
      releaseName: "Summer 2026",
      status: "delivered",
      subtotalAmountCents: 13900,
      taxAmountCents: 1200,
      totalAmountCents: 15100,
    },
  ],
};

const release = {
  declinedChargeCount: 1,
  description: "Fall estate allocation.",
  embargoDate: "2026-09-01",
  grossAmountCents: 14900,
  id: releaseId,
  memberCount: 1,
  name: "Fall 2026",
  processingDate: "2026-09-15",
  status: "scheduled",
  successfulChargeCount: 0,
  tiers: [
    {
      bottleCount: 3,
      id: tierId,
      name: "Founders Circle",
      priceCents: 14900,
    },
  ],
  wines: [{ id: "80000000-0000-4000-8000-000000000001", name: "Estate Cabernet", quantity: 3 }],
};

const chargedShipment = {
  address: member.address,
  carrier: null,
  chargeAmountCents: 14900,
  createdAt: "2026-09-15T12:00:00.000Z",
  declineReason: null,
  displayContents: true,
  id: shipmentId,
  items: release.wines,
  memberEmail: member.email,
  memberId,
  memberName: "Avery Vine",
  releaseId,
  releaseName: release.name,
  retryCount: 0,
  status: "charged",
  tierName: tier.name,
  trackingNumber: null,
};

const declinedShipment = {
  ...chargedShipment,
  declineReason: "insufficient_funds",
  id: "60000000-0000-4000-8000-000000000002",
  nextRetryDate: "2026-09-16",
  retryCount: 1,
  status: "declined",
};

type Capture = Array<{ body: unknown; method: string; path: string }>;

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    body: JSON.stringify({ data }),
    contentType: "application/json",
    status,
  });
}

async function installMockApi(
  page: Page,
  capture: Capture = [],
  options: {
    memberDetail?: typeof member;
    members?: Array<typeof member>;
  } = {},
) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    let body: unknown;
    if (method !== "GET" && request.postData()) {
      try {
        body = request.postDataJSON();
      } catch {
        body = "multipart";
      }
      capture.push({ body, method, path });
    }

    if (path === "/api/auth/staff/session") return json(route, staffSession);
    if (path === "/api/auth/member/session") return json(route, memberSession);
    if (path === "/api/club-tiers" && method === "GET") return json(route, [tier]);
    if (path === "/api/club-tiers" && method === "POST") return json(route, tier, 201);
    if (path === "/api/members" && method === "GET") {
      const members = options.members ?? [member];
      return json(route, {
        items: members,
        page: 1,
        pageSize: members.length,
        total: members.length,
      });
    }
    if (path === "/api/members" && method === "POST") return json(route, member, 201);
    if (path === `/api/members/${memberId}`) {
      return method === "DELETE"
        ? json(route, { deleted: true })
        : json(route, options.memberDetail ?? member);
    }
    if (path === "/api/members/batch") return json(route, { updatedCount: 1 });
    if (path === "/api/releases" && method === "GET") return json(route, [release]);
    if (path === "/api/releases" && method === "POST") return json(route, release, 201);
    if (path === `/api/releases/${releaseId}`) return json(route, release);
    if (path === `/api/releases/${releaseId}/process`) {
      return json(route, { declinedChargeCount: 1, successfulChargeCount: 0 });
    }
    if (path === "/api/recovery") {
      return json(route, { items: [declinedShipment], total: 1 });
    }
    if (path === `/api/shipments/${declinedShipment.id}/retry`) {
      return json(route, { status: "pending" });
    }
    if (path === `/api/shipments/${shipmentId}/refund`) {
      return json(route, { status: "refunded" });
    }
    if (path === "/api/shipments" && url.searchParams.get("fulfillment") === "true") {
      return json(route, {
        items: [{ ...chargedShipment, status: "label_created" }],
        total: 1,
      });
    }
    if (path === "/api/shipments") {
      return json(route, { items: [chargedShipment], total: 1 });
    }
    if (path === "/api/shipments/labels") return json(route, { labelCount: 1 });
    if (path === `/api/shipments/${shipmentId}/pack`) {
      return json(route, { status: "packed" });
    }
    if (path === `/api/shipments/${shipmentId}/status`) {
      return json(route, { status: "shipped" });
    }
    if (path === "/api/member/shipments") {
      return json(route, [{ ...chargedShipment, displayContents: true }]);
    }
    if (path === "/api/member/profile/address") return json(route, { updated: true });
    if (path === "/api/members/import/preview") {
      return json(route, {
        columns: [
          "Customer First Name",
          "Customer Last Name",
          "Customer Email",
          "Customer Phone",
          "Club",
          "Signup Date",
          "Ship To Address",
          "Ship To Address 2",
          "Ship To City",
          "Ship To State Code",
          "Ship To Zip Code",
          "Ship To Country Code",
          "Status",
        ],
        rows: [
          {
            Club: "Founders Circle",
            "Customer Email": "avery@example.com",
            "Customer First Name": "Avery",
            "Customer Last Name": "Vine",
            "Customer Phone": "707-555-0101",
            "Ship To Address": "101 Vineyard Lane",
            "Ship To Address 2": "",
            "Ship To City": "Napa",
            "Ship To Country Code": "US",
            "Ship To State Code": "CA",
            "Ship To Zip Code": "94558",
            "Signup Date": "2026-01-05",
            Status: "Active",
          },
        ],
        source: "commerce7",
        suggestedMapping: {
          Club: "clubTier",
          "Customer Email": "email",
          "Customer First Name": "firstName",
          "Customer Last Name": "lastName",
          "Customer Phone": "phone",
          "Ship To Address": "line1",
          "Ship To Address 2": "line2",
          "Ship To City": "city",
          "Ship To Country Code": "country",
          "Ship To State Code": "state",
          "Ship To Zip Code": "postalCode",
          "Signup Date": "joinDate",
          Status: "status",
        },
        uploadToken: "one-time-test-token",
        validation: { errors: [], invalidCount: 0, validCount: 1 },
      });
    }
    if (path === "/api/members/import") {
      return json(route, { errors: [], importedCount: 1, skippedCount: 0 });
    }

    return json(route, {});
  });
}

async function assertA11y(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(async () => {
    const result = {
      bodyScrollWidth: document.body.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      diagnostics: [
        "html",
        "body",
        "#root",
        ".staff-app",
        ".staff-main",
        ".staff-content",
        ".operation-panel",
        ".data-table-wrap",
        ".data-table",
      ].map((selector) => {
        const element = document.querySelector(selector) as HTMLElement | null;
        const rect = element?.getBoundingClientRect();
        return {
          clientWidth: element?.clientWidth,
          overflowX: element ? getComputedStyle(element).overflowX : undefined,
          rectWidth: rect?.width,
          scrollWidth: element?.scrollWidth,
          selector,
        };
      }),
      outliers: Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            className: element.className?.toString().slice(0, 80),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            tag: element.tagName,
            text: element.textContent?.trim().slice(0, 60),
            width: Math.round(rect.width),
          };
        })
        .filter((entry) => entry.right > document.documentElement.clientWidth + 1)
        .slice(0, 20),
      scrollWidth: document.documentElement.scrollWidth,
      scrollX: 0,
    };
    window.scrollTo({ left: 999, top: window.scrollY });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    result.scrollX = window.scrollX;
    window.scrollTo({ left: 0, top: window.scrollY });
    return result;
  });
  expect(
    { bodyFitsViewport: metrics.bodyScrollWidth <= metrics.clientWidth, scrollX: metrics.scrollX },
    JSON.stringify(
      { diagnostics: metrics.diagnostics, outliers: metrics.outliers },
      null,
      2,
    ),
  ).toEqual({ bodyFitsViewport: true, scrollX: 0 });
}

async function assertMobileTouchTargets(page: Page) {
  const tooSmall = await page.locator("button:visible, a[href]:visible").evaluateAll((elements) =>
    elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          height: Math.round(rect.height),
          name: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName,
          width: Math.round(rect.width),
        };
      })
      .filter(({ height, width }) => height < 44 || width < 44),
  );
  expect(tooSmall).toEqual([]);
}

async function installWebVitalsProbe(page: Page) {
  await page.addInitScript(() => {
    const metrics = { cls: 0, lcp: 0 };
    Object.defineProperty(window, "__viniferaPhase2Metrics", { value: metrics });
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

async function assertWebVitals(page: Page) {
  await page.waitForTimeout(50);
  const metrics = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __viniferaPhase2Metrics: { cls: number; lcp: number };
        }
      ).__viniferaPhase2Metrics,
  );
  expect(metrics.lcp).toBeLessThan(2_500);
  expect(metrics.cls).toBeLessThan(0.1);
}

test.describe("Phase 2 operational surfaces", () => {
  const routes = [
    { heading: "Members", path: "/app/members", session: "staff" },
    { heading: "Avery Vine", path: `/app/members/${memberId}`, session: "staff" },
    { heading: "Club Tiers", path: "/app/tiers", session: "staff" },
    { heading: "Release Schedule", path: "/app/releases", session: "staff" },
    { heading: "Fall 2026", path: `/app/releases/${releaseId}`, session: "staff" },
    { heading: "Payment Recovery", path: "/app/recovery", session: "staff" },
    { heading: "Shipments", path: "/app/shipments", session: "staff" },
    { heading: "Fulfillment", path: "/app/fulfillment", session: "staff" },
    { heading: "Import Members", path: "/app/import", session: "staff" },
    { heading: "Welcome, Avery", path: "/portal", session: "member" },
  ] as const;

  for (const viewport of [
    { name: "mobile", width: 375, height: 812 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 1000 },
  ]) {
    for (const route of routes) {
      test(`${route.path} passes accessibility and layout at ${viewport.name}`, async ({
        page,
      }) => {
        await installWebVitalsProbe(page);
        await installMockApi(page);
        await page.setViewportSize(viewport);
        await page.goto(route.path);
        await expect(
          page.getByRole("heading", { name: route.heading, exact: true }).first(),
        ).toBeVisible({ timeout: 15_000 });
        await assertA11y(page);
        await assertNoHorizontalOverflow(page);
        await assertWebVitals(page);
        if (viewport.name === "mobile") await assertMobileTouchTargets(page);
        const evidenceName =
          route.path === "/app/members" && viewport.name === "mobile"
            ? "members-mobile.png"
            : route.path === "/app/fulfillment" && viewport.name === "tablet"
              ? "fulfillment-tablet.png"
              : route.path === "/app/releases" && viewport.name === "desktop"
                ? "releases-desktop.png"
                : route.path === "/portal" && viewport.name === "mobile"
                  ? "member-portal-mobile.png"
                  : null;
        if (evidenceName) {
          await page.screenshot({
            fullPage: true,
            path: `docs/qa/phase-2/${evidenceName}`,
          });
        }
      });
    }
  }
});

test.describe("Phase 2 local performance budgets", () => {
  test("100-member roster renders in under one second", async ({ page }) => {
    const members = Array.from({ length: 100 }, (_, index) => ({
      ...member,
      email: `member-${index + 1}@example.com`,
      firstName: `Member ${index + 1}`,
      id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    }));
    await installMockApi(page, [], { members });
    await page.goto("/app");
    const startedAt = await page.evaluate(() => performance.now());
    await page.getByRole("link", { name: "Members", exact: true }).click();
    await expect(page.getByText("Member 100 Vine", { exact: true })).toBeVisible();
    const elapsedMs = await page.evaluate(
      (start) => performance.now() - start,
      startedAt,
    );
    console.log(
      `[phase2-performance] member-roster-100=${elapsedMs.toFixed(2)}ms`,
    );
    expect(elapsedMs).toBeLessThan(1_000);
  });
});

test.describe("Phase 2 core club loop", () => {
  test.beforeEach(async ({ page }) => {
    await installMockApi(page);
  });

  test("staff can submit ten tier-assigned members through the UI", async ({
    page,
  }) => {
    const requests: Capture = [];
    await page.unrouteAll({ behavior: "wait" });
    await installMockApi(page, requests);
    await page.goto("/app/members");

    for (let index = 1; index <= 10; index += 1) {
      await page.getByRole("button", { name: "Add Member" }).click();
      const dialog = page.getByRole("dialog", { name: "Add member" });
      await dialog.getByLabel("First name").fill(`Member ${index}`);
      await dialog.getByLabel("Last name").fill("Architecture");
      await dialog
        .getByLabel("Email", { exact: true })
        .fill(`member-${index}@example.com`);
      await dialog.getByLabel("Club tier").selectOption(tierId);
      await dialog.getByLabel("Address line 1").fill(`${index} Winery Lane`);
      await dialog.getByLabel("City").fill("Napa");
      await dialog.getByLabel("State").fill("CA");
      await dialog.getByLabel("ZIP code").fill("94558");
      await dialog
        .getByRole("button", { name: "Add member", exact: true })
        .click();
      await expect(page.getByText("Member added to the live club roster.")).toBeVisible();
    }

    const memberCreates = requests.filter(
      (request) => request.method === "POST" && request.path === "/api/members",
    );
    expect(memberCreates).toHaveLength(10);
    expect(
      memberCreates.map((request) => {
        const body = request.body as { email?: string; tierId?: string };
        return { email: body.email, tierId: body.tierId };
      }),
    ).toEqual(
      Array.from({ length: 10 }, (_, index) => ({
        email: `member-${index + 1}@example.com`,
        tierId,
      })),
    );
  });

  test("dialogs trap focus, close on Escape, and restore the trigger", async ({
    page,
  }) => {
    await page.goto("/app/tiers");
    const trigger = page.getByRole("button", { name: "Create Tier" });
    await trigger.focus();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Create club tier" });
    const close = dialog.getByRole("button", { name: "Close Create club tier" });
    const submit = dialog.getByRole("button", {
      name: "Create tier",
      exact: true,
    });
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(submit).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("staff can create a tier, member, and scheduled release", async ({ page }) => {
    await page.goto("/app/tiers");
    await page.getByRole("button", { name: "Create Tier" }).click();
    await page.getByLabel("Tier name").fill("Library Circle");
    await page.getByLabel("Description").fill("Library allocations.");
    await page.getByLabel("Membership price").fill("199");
    await page.getByLabel("Billing interval").selectOption("quarterly");
    await page.getByLabel("Included bottles").fill("6");
    await page.getByLabel("Shipment frequency").selectOption("quarterly");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create tier", exact: true })
      .click();
    await expect(page.getByText("Club tier created.")).toBeVisible();

    await page.goto("/app/members");
    await page.getByRole("button", { name: "Add Member" }).click();
    await page.getByLabel("First name").fill("Jordan");
    await page.getByLabel("Last name").fill("Cellar");
    await page.getByLabel("Email", { exact: true }).fill("jordan@example.com");
    await page.getByLabel("Club tier").selectOption(tierId);
    await page.getByLabel("Address line 1").fill("10 Oak Avenue");
    await page.getByLabel("City").fill("Sonoma");
    await page.getByLabel("State").fill("CA");
    await page.getByLabel("ZIP code").fill("95476");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Add member", exact: true })
      .click();
    await expect(page.getByText("Member added to the live club roster.")).toBeVisible();

    await page.goto("/app/releases");
    await page.getByRole("button", { name: "Add Release" }).click();
    await page.getByLabel("Release name").fill("Winter 2026");
    await page.getByLabel("Processing date").fill("2026-12-10");
    await page.getByLabel("Contents visible after").fill("2026-12-01");
    await page.getByLabel("Founders Circle").check();
    await page.getByLabel("Charge amount").fill("149");
    await page.getByLabel("Wine 1").fill("2024 Estate Merlot");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create scheduled release", exact: true })
      .click();
    await expect(page.getByText("Release added to the live schedule.")).toBeVisible();
  });

  test("member detail exposes bounded order, payment, status, and communication history", async ({
    page,
  }) => {
    await page.goto(`/app/members/${memberId}`);

    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Summer 2026/ })).toContainText(
      "$151.00",
    );
    await expect(page.getByText("Payment succeeded")).toBeVisible();
    await expect(page.getByText("Membership paused")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Communications (1)" }),
    ).toBeVisible();
    await expect(page.getByText("Welcome to the club")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.unrouteAll({ behavior: "wait" });
    await installMockApi(page, [], {
      memberDetail: {
        ...member,
        activity: [],
        communicationCount: 0,
        communications: [],
        orders: [],
      },
    });
    await page.goto(`/app/members/${memberId}`);

    await expect(page.getByText("No orders recorded")).toBeVisible();
    await expect(page.getByText("No activity recorded")).toBeVisible();
    await expect(page.getByText("No communications recorded")).toBeVisible();
  });

  test("release billing, recovery, refund, labels, and pack scan are connected", async ({
    page,
  }) => {
    await page.goto(`/app/releases/${releaseId}`);
    await page.getByRole("button", { name: "Process release" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Run billing" }).click();
    await expect(page.getByText(/Billing run recorded/)).toBeVisible();

    await page.goto("/app/recovery");
    await page.getByRole("button", { name: "Retry now" }).click();
    await expect(page.getByText("Retry requested for Avery Vine.")).toBeVisible();

    await page.goto("/app/shipments");
    await page.getByRole("button", { name: "Refund" }).click();
    await page.getByRole("button", { name: "Confirm refund" }).click();
    await expect(page.getByText(/was refunded/)).toBeVisible();

    await page.goto("/app/fulfillment");
    await page.getByLabel("Select shipment for Avery Vine").check();
    await page.getByRole("button", { name: "Labels", exact: true }).click();
    await expect(page.getByText("1 shipping labels generated.")).toBeVisible();
    await page.getByRole("button", { name: "Scan pack" }).click();
    await page.getByLabel("Shipment or item barcode").fill(shipmentId);
    await page.getByRole("button", { name: "Confirm pack", exact: true }).click();
    await expect(page.getByText("Pack confirmed for Avery Vine.")).toBeVisible();
  });

  test("member can update address and Commerce7 import uses multipart preview", async ({
    page,
  }) => {
    await page.goto("/portal");
    await expect(
      page.getByRole("heading", { name: "Welcome, Avery", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Fall 2026", exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: /Shipping address/ }).click();
    await page.getByLabel("Address line 1").fill("500 Oak Road");
    await page.getByLabel("City").fill("Calistoga");
    await page.getByLabel("State").fill("CA");
    await page.getByLabel("ZIP code").fill("94515");
    await page.getByRole("button", { name: "Save address" }).click();
    await expect(page.getByText(/updated for future shipments/)).toBeVisible();

    await page.goto("/app/import");
    await page.getByLabel("Source format").selectOption("commerce7");
    await page.getByLabel("Choose a member CSV").setInputFiles(
      "tests/fixtures/commerce7-members.csv",
    );
    const previewRequest = page.waitForRequest("**/api/members/import/preview");
    await page.getByRole("button", { name: "Upload and preview" }).click();
    expect((await previewRequest).headers()["content-type"]).toContain("multipart/form-data");
    await expect(page.getByRole("heading", { name: "Map columns" })).toBeVisible();
    await page.getByRole("button", { name: /Import 1 valid member/ }).click();
    await expect(page.getByText("1 members imported into the live roster.")).toBeVisible();
  });

  test("Commerce7 optional fields submit the canonical CSV mapping contract", async ({
    page,
  }) => {
    const requests: Capture = [];
    await page.unrouteAll({ behavior: "wait" });
    await installMockApi(page, requests);
    await page.goto("/app/import");
    await page.getByLabel("Source format").selectOption("commerce7");
    await page
      .getByLabel("Choose a member CSV")
      .setInputFiles("tests/fixtures/commerce7-members.csv");
    await page.getByRole("button", { name: "Upload and preview" }).click();

    await expect(page.getByLabel("Club")).toHaveValue("clubTier");
    await expect(page.getByLabel("Signup Date")).toHaveValue("joinDate");
    await expect(page.getByLabel("Ship To Address", { exact: true })).toHaveValue(
      "line1",
    );
    await expect(page.getByLabel("Ship To Country Code")).toHaveValue("country");

    await page.getByRole("button", { name: /Import 1 valid member/ }).click();
    const importRequest = requests.find(
      (request) =>
        request.method === "POST" && request.path === "/api/members/import",
    );
    expect(importRequest?.body).toEqual({
      mapping: {
        Club: "clubTier",
        "Customer Email": "email",
        "Customer First Name": "firstName",
        "Customer Last Name": "lastName",
        "Customer Phone": "phone",
        "Ship To Address": "line1",
        "Ship To Address 2": "line2",
        "Ship To City": "city",
        "Ship To Country Code": "country",
        "Ship To State Code": "state",
        "Ship To Zip Code": "postalCode",
        "Signup Date": "joinDate",
        Status: "status",
      },
      uploadToken: "one-time-test-token",
    });
  });
});
