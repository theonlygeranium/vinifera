import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";

const organizationId = "10000000-0000-4000-8000-000000000001";
const staffId = "20000000-0000-4000-8000-000000000001";
const memberId = "30000000-0000-4000-8000-000000000001";
const releaseId = "50000000-0000-4000-8000-000000000001";
const shipmentId = "60000000-0000-4000-8000-000000000001";

const widgetIds = [
  "revenue-by-tier",
  "member-growth",
  "member-cohorts",
  "ltv-by-tier",
  "shipment-operations",
  "engagement",
  "acquisition",
] as const;

const staffSession = {
  access: { graceEndsAt: null, state: "active", suspendedAt: null },
  authenticated: true,
  organization: {
    accessState: "active",
    id: organizationId,
    name: "QA Winery",
    planTier: "estate",
    stripeCustomerId: "cus_phase4_test",
    stripeSubscriptionId: "sub_phase4_test",
    subscriptionStatus: "active",
  },
  user: {
    email: "owner@example.com",
    fullName: "QA Owner",
    id: staffId,
    role: "owner",
  },
};

const analyticsDashboard = {
  generatedAt: "2026-07-26T16:00:00.000Z",
  range: {
    preset: "30d",
    from: "2026-06-27",
    to: "2026-07-26",
  },
  summary: {
    mrrCents: 3425000,
    arrCents: 41100000,
    arpmCents: 168300,
    revenueChurnCents: 425000,
    activeMembers: 286,
    memberGrowthRate: 0.083,
    averageLtvCents: 214500,
    fulfillmentRate: 0.961,
    averageShipmentValueCents: 18900,
    declineRate: 0.039,
    shippingCostRatio: 0.071,
    emailOpenRate: 0.592,
    emailClickRate: 0.214,
    portalLogins: 801,
    portalLoginsPerMember: 2.8,
    loyaltyPointsRedeemed: 50,
    loyaltyRedemptionRate: 0.174,
  },
  revenue: {
    byTier: [
      {
        tierId: "40000000-0000-4000-8000-000000000001",
        tierName: "Founders Circle",
        mrrCents: 1875000,
        arrCents: 22500000,
        memberCount: 142,
      },
      {
        tierId: "40000000-0000-4000-8000-000000000002",
        tierName: "Estate Reserve",
        mrrCents: 1550000,
        arrCents: 18600000,
        memberCount: 144,
      },
    ],
    trend: [
      {
        period: "May",
        mrrCents: 3190000,
        arrCents: 38280000,
        arpmCents: 159500,
        revenueChurnCents: 510000,
      },
      {
        period: "June",
        mrrCents: 3310000,
        arrCents: 39720000,
        arpmCents: 164000,
        revenueChurnCents: 460000,
      },
      {
        period: "July",
        mrrCents: 3425000,
        arrCents: 41100000,
        arpmCents: 168300,
        revenueChurnCents: 425000,
      },
    ],
  },
  members: {
    trend: [
      { period: "May", active: 261, newMembers: 18, cancelled: 7, netGrowth: 11 },
      { period: "June", active: 274, newMembers: 20, cancelled: 7, netGrowth: 13 },
      { period: "July", active: 286, newMembers: 19, cancelled: 7, netGrowth: 12 },
    ],
    cohorts: [
      { cohort: "May 2026", values: [1, 0.94, 0.89] },
      { cohort: "June 2026", values: [1, 0.91, null] },
      { cohort: "July 2026", values: [1, null, null] },
    ],
    ltvByTier: [
      {
        tierId: "40000000-0000-4000-8000-000000000001",
        tierName: "Founders Circle",
        ltvCents: 238400,
      },
      {
        tierId: "40000000-0000-4000-8000-000000000002",
        tierName: "Estate Reserve",
        ltvCents: 190900,
      },
    ],
    tenureDistribution: [
      { bucket: "0-3 months", members: 44 },
      { bucket: "3-6 months", members: 63 },
      { bucket: "6-12 months", members: 71 },
      { bucket: "1-2 years", members: 68 },
      { bucket: "2+ years", members: 40 },
    ],
  },
  shipments: {
    trend: [
      {
        period: "Spring",
        attempted: 274,
        charged: 261,
        declined: 13,
        fulfillmentRate: 0.953,
        averageValueCents: 18200,
        shippingCostCents: 321000,
        revenueCents: 4750200,
      },
      {
        period: "Summer",
        attempted: 286,
        charged: 275,
        declined: 11,
        fulfillmentRate: 0.961,
        averageValueCents: 18900,
        shippingCostCents: 349000,
        revenueCents: 5197500,
      },
    ],
    declineReasons: [
      { reason: "Insufficient funds", count: 7, rate: 0.636 },
      { reason: "Expired card", count: 4, rate: 0.364 },
    ],
  },
  engagement: {
    trend: [
      {
        period: "May",
        emailOpenRate: 0.54,
        emailClickRate: 0.18,
        portalLoginsPerMember: 2.2,
        loyaltyRedemptionRate: 0.14,
      },
      {
        period: "June",
        emailOpenRate: 0.57,
        emailClickRate: 0.2,
        portalLoginsPerMember: 2.5,
        loyaltyRedemptionRate: 0.16,
      },
      {
        period: "July",
        emailOpenRate: 0.592,
        emailClickRate: 0.214,
        portalLoginsPerMember: 2.8,
        loyaltyRedemptionRate: 0.174,
      },
    ],
    acquisition: [
      { source: "Tasting room", members: 84, conversionRate: 0.34, cacCents: 2100 },
      { source: "Referral", members: 61, conversionRate: 0.29, cacCents: 900 },
    ],
  },
  availableWidgets: widgetIds.map((id, index) => ({
    id,
    title: [
      "Revenue by club tier",
      "Member growth",
      "Cohort retention",
      "Lifetime value by tier",
      "Shipment health",
      "Member engagement",
      "Acquisition performance",
    ][index],
    category: "Analytics",
    defaultSize: id === "member-cohorts" ? "full" : "half",
  })),
  layout: {
    widgets: widgetIds.map((id, order) => ({
      id,
      enabled: true,
      order,
      size: id === "member-cohorts" ? "full" : "half",
    })),
  },
};

const churnIntelligence = {
  mode: "ab_test",
  model: {
    version: "lr-2026-07-26.1",
    algorithm: "L2 regularized logistic regression",
    trainedAt: "2026-07-26T02:00:00.000Z",
    trainingDataSize: 874,
    metrics: {
      aucRoc: 0.842,
      accuracy: 0.804,
      precision: 0.781,
      recall: 0.768,
      f1: 0.774,
    },
  },
  abTest: {
    startedAt: "2026-07-01T00:00:00.000Z",
    endsAt: "2026-07-31T00:00:00.000Z",
    mlAccuracy: 0.804,
    rulesAccuracy: 0.746,
    sampleSize: 137,
  },
  drift: {
    status: "stable",
    score: 0.064,
    lastCheckedAt: "2026-07-26T02:10:00.000Z",
  },
  items: [
    {
      memberId,
      memberName: "Avery Vine",
      email: "avery@example.com",
      tierName: "Founders Circle",
      mlScore: 73,
      rulesScore: 61,
      confidenceBandLow: 68,
      confidenceBandHigh: 78,
      riskLevel: "high",
      source: "ml",
      calculatedAt: "2026-07-26T02:05:00.000Z",
      alert: {
        id: "d0000000-0000-4000-8000-000000000001",
        status: "open",
        createdAt: "2026-07-26T02:06:00.000Z",
      },
      topFeatures: [
        {
          id: "declines",
          label: "Recent payment declines",
          detail: "Two declines occurred in the last 90 days.",
          impact: 19,
          shapValue: 0.214,
          direction: "raises",
        },
        {
          id: "portal",
          label: "Portal inactivity",
          detail: "No portal login has been observed for 62 days.",
          impact: 14,
          shapValue: 0.171,
          direction: "raises",
        },
        {
          id: "tenure",
          label: "Long tenure",
          detail: "Three years of active membership lowers expected churn.",
          impact: -8,
          shapValue: -0.096,
          direction: "lowers",
        },
        {
          id: "engagement",
          label: "Email engagement",
          detail: "Open activity is below this member's historic baseline.",
          impact: 7,
          shapValue: 0.081,
          direction: "raises",
        },
        {
          id: "frequency",
          label: "Shipment cadence",
          detail: "One expected shipment was skipped.",
          impact: 5,
          shapValue: 0.053,
          direction: "raises",
        },
      ],
    },
  ],
};

const benchmarkDashboard = {
  eligible: true,
  subscriptionTier: "estate",
  optedIn: true,
  minimumPeerCount: 10,
  peerGroup: {
    region: "Napa Valley",
    tierDistribution: "Mixed club",
    memberCountBand: "250-499 members",
  },
  period: "Q2 2026",
  generatedAt: "2026-07-01T12:00:00.000Z",
  metrics: [
    {
      id: "retention",
      label: "Member retention",
      unit: "percent",
      organizationValue: 0.912,
      peerMedian: 0.884,
      percentile: 72,
      peerP25: 0.841,
      peerP75: 0.921,
      sampleCountBand: "10-19",
    },
    {
      id: "shipment-value",
      label: "Average shipment value",
      unit: "cents",
      organizationValue: 18900,
      peerMedian: 17600,
      percentile: 67,
      peerP25: 15800,
      peerP75: 20400,
      sampleCountBand: "10-19",
    },
  ],
  quarterlyReport: {
    enabled: true,
    lastGeneratedAt: "2026-07-01T12:00:00.000Z",
    nextScheduledAt: "2026-10-01T12:00:00.000Z",
  },
};

const complianceDashboard = {
  provider: {
    name: "ShipCompliant",
    status: "active",
    lastRulesRefreshAt: "2026-07-26T15:30:00.000Z",
  },
  summary: {
    totalChecks: 2,
    compliant: 1,
    nonCompliant: 1,
    unknown: 0,
    taxEstimateCents: 2840,
  },
  items: [
    {
      id: "a0000000-0000-4000-8000-000000000001",
      shipmentId,
      shipmentStatus: "charged",
      memberId,
      memberName: "Avery Vine",
      releaseId,
      releaseName: "Fall 2026",
      state: "CA",
      status: "compliant",
      reason: "Destination and volume limits verified.",
      taxEstimateCents: 2840,
      responseId: "sc_check_001",
      checkedAt: "2026-07-26T15:30:00.000Z",
    },
    {
      id: "a0000000-0000-4000-8000-000000000002",
      shipmentId: "60000000-0000-4000-8000-000000000002",
      shipmentStatus: "label_created",
      memberId: "30000000-0000-4000-8000-000000000002",
      memberName: "Jordan Cellar",
      releaseId,
      releaseName: "Fall 2026",
      state: "UT",
      status: "non_compliant",
      reason: "The destination does not permit this direct shipment.",
      taxEstimateCents: null,
      responseId: "sc_check_002",
      checkedAt: "2026-07-26T15:31:00.000Z",
    },
  ],
  total: 2,
};

interface CapturedRequest {
  body?: unknown;
  method: string;
  path: string;
  search: string;
}

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    body: JSON.stringify({ data }),
    contentType: "application/json",
    status,
  });
}

async function installMockApi(
  page: Page,
  capture: CapturedRequest[] = [],
) {
  let reports = [
    {
      id: "b0000000-0000-4000-8000-000000000001",
      frequency: "weekly",
      recipientEmail: "owner@example.com",
      enabled: true,
      widgetIds: [...widgetIds],
      nextSendAt: "2026-07-27T15:00:00.000Z",
    },
  ];
  let benchmarks = structuredClone(benchmarkDashboard);
  let churn = structuredClone(churnIntelligence);

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    let body: unknown;
    if (method !== "GET" && request.postData()) {
      body = request.postDataJSON();
    }
    capture.push({
      body,
      method,
      path: url.pathname,
      search: url.search,
    });

    if (url.pathname === "/api/auth/staff/session") {
      return json(route, staffSession);
    }
    if (url.pathname === "/api/analytics/dashboard") {
      const range = url.searchParams.get("range") ?? "30d";
      return json(route, {
        ...analyticsDashboard,
        range: {
          preset: range,
          from:
            range === "custom"
              ? url.searchParams.get("from")
              : analyticsDashboard.range.from,
          to:
            range === "custom"
              ? url.searchParams.get("to")
              : analyticsDashboard.range.to,
        },
      });
    }
    if (url.pathname === "/api/analytics/export") {
      return route.fulfill({
        body: "Period,Value\r\nJuly,41100000\r\n",
        contentType: "text/csv",
        headers: {
          "Content-Disposition":
            "attachment; filename=vinifera-analytics.csv",
        },
        status: 200,
      });
    }
    if (url.pathname === "/api/analytics/layout" && method === "PATCH") {
      return json(route, body);
    }
    if (url.pathname === "/api/analytics/reports" && method === "GET") {
      return json(route, reports);
    }
    if (url.pathname === "/api/analytics/reports" && method === "POST") {
      const input = body as Record<string, unknown>;
      reports = [
        ...reports,
        {
          id: "b0000000-0000-4000-8000-000000000002",
          frequency: input.frequency as "weekly" | "monthly",
          recipientEmail: String(input.recipientEmail),
          enabled: true,
          widgetIds: [...widgetIds],
          nextSendAt: "2026-08-01T15:00:00.000Z",
        },
      ];
      return json(route, reports.at(-1));
    }
    if (
      /^\/api\/analytics\/reports\/[^/]+$/.test(url.pathname) &&
      method === "PATCH"
    ) {
      return json(route, body);
    }
    if (url.pathname === "/api/churn-intelligence") {
      const search = url.searchParams.get("search")?.toLowerCase();
      return json(route, {
        ...churn,
        items: churn.items.filter(
          (item) =>
            !search ||
            `${item.memberName} ${item.email}`.toLowerCase().includes(search),
        ),
      });
    }
    if (
      /^\/api\/churn-intelligence\/alerts\/[^/]+$/.test(url.pathname) &&
      method === "PATCH"
    ) {
      const alertId = url.pathname.split("/").at(-1);
      churn = {
        ...churn,
        items: churn.items.map((item) =>
          item.alert?.id === alertId
            ? {
                ...item,
                alert: {
                  ...item.alert,
                  status: "acknowledged" as const,
                  acknowledgedAt: "2026-07-26T16:05:00.000Z",
                  acknowledgedByName: "QA Owner",
                },
              }
            : item,
        ),
      };
      return json(route, churn.items[0]?.alert);
    }
    if (url.pathname === "/api/benchmarks" && method === "GET") {
      return json(route, benchmarks);
    }
    if (
      url.pathname === "/api/benchmarks/preferences" &&
      method === "PATCH"
    ) {
      benchmarks = {
        ...benchmarks,
        ...(body as {
          optedIn?: boolean;
          quarterlyReportEnabled?: boolean;
        }),
        quarterlyReport: {
          ...benchmarks.quarterlyReport,
          enabled:
            (
              body as {
                quarterlyReportEnabled?: boolean;
              }
            ).quarterlyReportEnabled ?? benchmarks.quarterlyReport.enabled,
        },
      };
      return json(route, benchmarks);
    }
    if (url.pathname === "/api/compliance/dashboard") {
      const status = url.searchParams.get("status");
      const items = complianceDashboard.items.filter(
        (item) => !status || item.status === status,
      );
      return json(route, {
        ...complianceDashboard,
        items,
        total: items.length,
      });
    }
    if (
      /^\/api\/compliance\/shipments\/[^/]+\/check$/.test(url.pathname) &&
      method === "POST"
    ) {
      return json(route, complianceDashboard.items[0]);
    }
    if (
      /^\/api\/compliance\/releases\/[^/]+\/check$/.test(url.pathname) &&
      method === "POST"
    ) {
      return json(route, {
        compliant: 1,
        nonCompliant: 1,
        total: 2,
        unknown: 0,
      });
    }

    return route.fulfill({
      body: JSON.stringify({
        error: {
          code: "UNMOCKED_PHASE4_ROUTE",
          message: `No Phase 4 mock exists for ${method} ${url.pathname}.`,
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
  const metrics = await page.evaluate(async () => {
    const result = {
      bodyScrollWidth: document.body.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      outliers: Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            className: element.className?.toString().slice(0, 80),
            right: Math.round(rect.right),
            tag: element.tagName,
          };
        })
        .filter((entry) => entry.right > document.documentElement.clientWidth + 1)
        .slice(0, 20),
      scrollX: 0,
    };
    window.scrollTo({ left: 999, top: window.scrollY });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    result.scrollX = window.scrollX;
    window.scrollTo({ left: 0, top: window.scrollY });
    return result;
  });
  expect(
    {
      bodyFitsViewport: metrics.bodyScrollWidth <= metrics.clientWidth,
      scrollX: metrics.scrollX,
    },
    JSON.stringify({ outliers: metrics.outliers }, null, 2),
  ).toEqual({ bodyFitsViewport: true, scrollX: 0 });
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
          const rect = target.getBoundingClientRect();
          return {
            height: Math.round(rect.height),
            name:
              element.getAttribute("aria-label") ||
              target.textContent?.trim() ||
              element.tagName,
            width: Math.round(rect.width),
          };
        })
        .filter(({ height, width }) => height < 44 || width < 44),
    );
  expect(tooSmall).toEqual([]);
}

async function tabTo(
  page: Page,
  target: Locator,
  maximumPresses = 80,
) {
  const resolvedTarget = target.first();
  for (let press = 0; press < maximumPresses; press += 1) {
    await page.keyboard.press("Tab");
    if (
      await resolvedTarget.evaluate(
        (element) => element === document.activeElement,
      )
    ) {
      return;
    }
  }
  const focused = await page.evaluate(() => ({
    ariaLabel: document.activeElement?.getAttribute("aria-label"),
    tag: document.activeElement?.tagName,
    text: document.activeElement?.textContent?.trim().slice(0, 100),
  }));
  throw new Error(
    `Tab did not reach the requested Phase 4 control: ${JSON.stringify(focused)}`,
  );
}

async function installAnalyticsChartRenderProbe(page: Page) {
  await page.addInitScript(() => {
    const measurement = {
      allChartsVisibleAt: null as number | null,
      chartCount: 0,
      responseEnd: null as number | null,
      responseToVisibleMs: null as number | null,
    };
    Object.defineProperty(window, "__viniferaPhase4ChartMetrics", {
      value: measurement,
    });
    let framePending = false;
    const measureVisibleCharts = () => {
      if (framePending || measurement.responseToVisibleMs !== null) return;
      framePending = true;
      requestAnimationFrame(() => {
        framePending = false;
        const charts = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".analytics-line-chart, .analytics-bar-chart",
          ),
        );
        const allVisible =
          charts.length === 5 &&
          charts.every((element) => {
            const rectangle = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return (
              rectangle.width > 0 &&
              rectangle.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden"
            );
          });
        const dashboardResponse = performance
          .getEntriesByType("resource")
          .filter((entry) =>
            entry.name.includes("/api/analytics/dashboard"),
          )
          .at(-1) as PerformanceResourceTiming | undefined;
        if (!allVisible || !dashboardResponse?.responseEnd) return;
        measurement.chartCount = charts.length;
        measurement.responseEnd = dashboardResponse.responseEnd;
        measurement.allChartsVisibleAt = performance.now();
        measurement.responseToVisibleMs =
          measurement.allChartsVisibleAt - dashboardResponse.responseEnd;
        observer.disconnect();
      });
    };
    const observer = new MutationObserver(measureVisibleCharts);
    window.addEventListener(
      "DOMContentLoaded",
      () => {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
      },
      { once: true },
    );
  });
}

async function installWebVitalsProbe(page: Page) {
  await page.addInitScript(() => {
    const metrics = { cls: 0, lcp: 0 };
    Object.defineProperty(window, "__viniferaPhase4Metrics", {
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

async function assertWebVitals(page: Page) {
  await page.waitForTimeout(50);
  const metrics = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __viniferaPhase4Metrics: { cls: number; lcp: number };
        }
      ).__viniferaPhase4Metrics,
  );
  expect(metrics.lcp).toBeLessThan(2_500);
  expect(metrics.cls).toBeLessThan(0.1);
}

test.describe("Phase 4 analytics and intelligence surfaces", () => {
  const routes = [
    { heading: "Analytics", path: "/app/analytics" },
    { heading: "AI Churn Watch", path: "/app/churn-watch" },
    { heading: "Peer Benchmarks", path: "/app/benchmarks" },
    { heading: "Compliance", path: "/app/compliance" },
  ] as const;

  for (const viewport of [
    { name: "mobile", width: 375, height: 812 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 1000 },
  ]) {
    for (const route of routes) {
      test(`${route.path} passes accessibility, layout, and performance at ${viewport.name}`, async ({
        page,
      }) => {
        const browserErrors: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error" || message.type() === "warning") {
            browserErrors.push(message.text());
          }
        });
        page.on("pageerror", (error) => browserErrors.push(error.message));

        await installWebVitalsProbe(page);
        await installMockApi(page);
        await page.setViewportSize(viewport);
        await page.goto(route.path);
        await expect(
          page.getByRole("heading", { name: route.heading, exact: true }).first(),
        ).toBeVisible();
        await assertA11y(page);
        await assertNoHorizontalOverflow(page);
        await assertWebVitals(page);
        if (viewport.name === "mobile") await assertMobileTouchTargets(page);
        await expect(page.locator("vite-error-overlay")).toHaveCount(0);
        expect(browserErrors).toEqual([]);

        const evidenceName =
          route.path === "/app/analytics" && viewport.name === "mobile"
            ? "analytics-375.png"
            : route.path === "/app/analytics" && viewport.name === "desktop"
              ? "analytics-1440.png"
            : route.path === "/app/churn-watch" && viewport.name === "tablet"
              ? "churn-intelligence-768.png"
              : route.path === "/app/benchmarks" && viewport.name === "mobile"
                ? "benchmarks-375.png"
                : route.path === "/app/compliance" && viewport.name === "mobile"
                  ? "compliance-375.png"
                  : null;
        if (
          evidenceName &&
          process.env.UPDATE_PHASE4_QA_EVIDENCE === "1"
        ) {
          await page.screenshot({
            fullPage: true,
            path: `docs/qa/phase-4/${evidenceName}`,
          });
        }
      });
    }
  }
});

test.describe("Phase 4 functional workflows", () => {
  test("analytics key controls support keyboard-only traversal and activation", async ({
    page,
  }) => {
    const capture: CapturedRequest[] = [];
    await installMockApi(page, capture);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/app/analytics");

    const widgetsButton = page.getByRole("button", { name: "Widgets" });
    await tabTo(page, widgetsButton);
    await expect(widgetsButton).toBeFocused();
    await page.keyboard.press("Enter");

    const settings = page.getByRole("dialog", {
      name: "Configure analytics",
    });
    await expect(settings).toBeVisible();
    const closeSettings = settings.getByRole("button", {
      name: "Close Configure analytics",
    });
    const saveSettings = settings.getByRole("button", {
      name: "Save dashboard",
    });
    await expect(closeSettings).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(saveSettings).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeSettings).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect(widgetsButton).toBeFocused();

    const range = page.getByLabel("Date range");
    await tabTo(page, range);
    await expect(range).toBeFocused();
    await range.pressSequentially("Last 90 days", { delay: 20 });
    await range.press("Enter");
    await expect(range).toHaveValue("90d");
    await page.keyboard.press("Tab");
    const apply = page.getByRole("button", { name: "Apply" });
    await expect(apply).toBeFocused();
    await page.keyboard.press("Enter");
    await expect
      .poll(() =>
        capture.some(
          (request) =>
            request.path === "/api/analytics/dashboard" &&
            request.search.includes("range=90d"),
        ),
      )
      .toBe(true);

    const firstTableDisclosure = page
      .getByText("View chart as a data table", { exact: true })
      .first();
    await tabTo(page, firstTableDisclosure);
    await expect(firstTableDisclosure).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("table", { name: "Revenue by club tier" }),
    ).toBeVisible();
  });

  test("analytics charts render within 500ms of the dashboard response", async ({
    page,
  }) => {
    await installAnalyticsChartRenderProbe(page);
    await installMockApi(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/app/analytics");

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __viniferaPhase4ChartMetrics: {
                  responseToVisibleMs: number | null;
                };
              }
            ).__viniferaPhase4ChartMetrics.responseToVisibleMs,
        ),
      )
      .not.toBeNull();
    const charts = page.locator(
      ".analytics-line-chart, .analytics-bar-chart",
    );
    await expect(charts).toHaveCount(5);
    for (let index = 0; index < 5; index += 1) {
      await expect(charts.nth(index)).toBeVisible();
    }
    const measurement = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __viniferaPhase4ChartMetrics: {
              allChartsVisibleAt: number | null;
              chartCount: number;
              responseEnd: number | null;
              responseToVisibleMs: number | null;
            };
          }
        ).__viniferaPhase4ChartMetrics,
    );
    expect(measurement.responseEnd).not.toBeNull();
    expect(measurement.allChartsVisibleAt).not.toBeNull();
    expect(measurement.chartCount).toBe(5);
    expect(measurement.responseToVisibleMs).not.toBeNull();
    expect(measurement.responseToVisibleMs!).toBeLessThan(500);
    console.log(
      `[phase4-performance] analytics charts=${measurement.chartCount} response-to-visible=${measurement.responseToVisibleMs!.toFixed(2)}ms`,
    );
  });

  test("analytics filters, accessible tables, export, layouts, and schedules use the canonical contract", async ({
    page,
  }) => {
    const capture: CapturedRequest[] = [];
    await installMockApi(page, capture);
    await page.goto("/app/analytics");

    await expect(page.getByText("$411K", { exact: true })).toBeVisible();
    await expect(
      page.getByText("$34,250.00", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("$1,683.00", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("$4,250.00", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Member tenure distribution" }),
    ).toBeVisible();
    await expect(page.getByText("Insufficient funds")).toBeVisible();
    await expect(page.getByText("801 total logins")).toBeVisible();
    await expect(page.getByText("50 points redeemed")).toBeVisible();
    await expect(
      page.locator("dt").filter({ hasText: "Email click rate" }),
    ).toBeVisible();
    await page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: "Revenue by club tier" }) })
      .getByText("View chart as a data table")
      .click();
    await expect(
      page.getByRole("table", { name: "Revenue by club tier" }),
    ).toContainText("Founders Circle");
    await expect(
      page.getByRole("table", { name: "Revenue by club tier" }),
    ).toContainText("MRR");
    await page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: "Member growth" }) })
      .getByText("View chart as a data table")
      .click();
    await expect(
      page.getByRole("table", { name: "Member growth" }),
    ).toContainText("July");

    await page.getByLabel("Date range").selectOption("custom");
    await page.getByLabel("From", { exact: true }).fill("2026-04-01");
    await page.getByLabel("To", { exact: true }).fill("2026-06-30");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect
      .poll(() =>
        capture.some(
          (request) =>
            request.path === "/api/analytics/dashboard" &&
            request.search.includes("range=custom") &&
            request.search.includes("from=2026-04-01") &&
            request.search.includes("to=2026-06-30"),
        ),
      )
      .toBe(true);

    const download = page.waitForEvent("download");
    await page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: "Revenue by club tier" }) })
      .getByRole("button", { name: "CSV" })
      .click();
    expect((await download).suggestedFilename()).toBe("vinifera-analytics.csv");
    expect(
      capture.some(
        (request) =>
          request.path === "/api/analytics/export" &&
          request.search.includes("widgetId=revenue-by-tier"),
      ),
    ).toBe(true);

    await page.getByRole("button", { name: "Widgets" }).click();
    const settings = page.getByRole("dialog", {
      name: "Configure analytics",
    });
    await settings
      .locator("label.toggle-control")
      .filter({ hasText: "Member engagement" })
      .click();
    await expect(
      settings.getByRole("checkbox", { name: "Member engagement" }),
    ).not.toBeChecked();
    await settings
      .getByRole("button", { name: "Move Member growth earlier" })
      .click();
    await settings.getByRole("button", { name: "Save dashboard" }).click();
    const layoutRequest = capture.find(
      (request) =>
        request.method === "PATCH" &&
        request.path === "/api/analytics/layout",
    );
    expect(layoutRequest?.body).toMatchObject({
      widgets: expect.arrayContaining([
        expect.objectContaining({
          enabled: false,
          id: "engagement",
          size: "half",
        }),
      ]),
    });

    await page.getByRole("button", { name: "Reports" }).click();
    const reports = page.getByRole("dialog", { name: "Scheduled reports" });
    await reports.getByLabel("Frequency").selectOption("monthly");
    await reports
      .getByLabel("Recipient email")
      .fill("owner@example.com");
    await reports.getByRole("button", { name: "Schedule report" }).click();
    await expect(reports.getByText("owner@example.com").first()).toBeVisible();
    const reportRequest = capture.find(
      (request) =>
        request.method === "POST" &&
        request.path === "/api/analytics/reports",
    );
    expect(reportRequest?.body).toEqual({
      enabled: true,
      frequency: "monthly",
      recipientEmail: "owner@example.com",
      widgetIds: [...widgetIds],
    });
  });

  test("churn intelligence compares the model and rules with five explainable factors", async ({
    page,
  }) => {
    const capture: CapturedRequest[] = [];
    await installMockApi(page, capture);
    await page.goto("/app/churn-watch");

    await expect(
      page.getByRole("heading", {
        name: "ML and rules A/B validation is active",
      }),
    ).toBeVisible();
    await expect(page.getByText("80.4%", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Rules 61")).toBeVisible();
    await expect(page.getByText("ML 73")).toBeVisible();
    await expect(page.getByText(/68–78% score band/)).toBeVisible();
    await expect(page.getByText("High-risk alert needs review")).toBeVisible();
    await page.getByRole("button", { name: "Acknowledge" }).click();
    await expect(page.getByText("High-risk alert acknowledged.")).toBeVisible();
    await expect(
      page.getByText("High-risk alert acknowledged", { exact: true }),
    ).toBeVisible();
    expect(
      capture.find(
        (request) =>
          request.method === "PATCH" &&
          request.path ===
            "/api/churn-intelligence/alerts/d0000000-0000-4000-8000-000000000001",
      )?.body,
    ).toEqual({ status: "acknowledged" });
    await page.getByText("Why this score?").click();
    await expect(page.locator(".intelligence-factor-list li")).toHaveCount(5);
    await expect(page.getByText("Recent payment declines")).toBeVisible();

    await page.getByLabel("Search scored members").fill("missing");
    await expect(page.getByText("No members match this risk view")).toBeVisible();
    expect(
      capture.some(
        (request) =>
          request.path === "/api/churn-intelligence" &&
          request.search.includes("search=missing"),
      ),
    ).toBe(true);
  });

  test("estate benchmarking preserves cohort privacy and persists opt-out", async ({
    page,
  }) => {
    const capture: CapturedRequest[] = [];
    await installMockApi(page, capture);
    await page.goto("/app/benchmarks");

    await expect(page.getByText("10-19 wineries").first()).toBeVisible();
    await expect(page.getByText("72th percentile")).toBeVisible();
    await expect(page.getByText("QA Winery")).toHaveCount(0);
    await page.getByRole("button", { name: "Leave benchmark pool" }).click();
    await expect(
      page.getByRole("heading", { name: "Join the anonymous benchmark pool" }),
    ).toBeVisible();
    expect(
      capture.find(
        (request) =>
          request.method === "PATCH" &&
          request.path === "/api/benchmarks/preferences",
      )?.body,
    ).toMatchObject({
      optedIn: false,
      quarterlyReportEnabled: true,
    });
  });

  test("compliance shows tax, blocks destinations visibly, and rechecks shipment and release", async ({
    page,
  }) => {
    const capture: CapturedRequest[] = [];
    await installMockApi(page, capture);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/app/compliance");

    await expect(
      page.getByRole("heading", {
        name: "ShipCompliant checks are active",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/after a successful charge, immediately before label generation/i),
    ).toBeVisible();
    await expect(page.getByText("$28.40", { exact: true }).first()).toBeVisible();
    await expect(
      page.locator(".provider-response").first(),
    ).toContainText("sc_check_001");
    await expect(
      page
        .getByRole("table", { name: "Shipment compliance decisions and tax estimates" })
        .getByText("Non-compliant", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The destination does not permit this direct shipment."),
    ).toBeVisible();
    await expect(
      page.getByText("Decision", { exact: true }).first(),
    ).toBeVisible();
    const complianceRegionFits = await page
      .locator(".compliance-table")
      .evaluate(
        (element) =>
          element.scrollWidth <= element.clientWidth + 1,
      );
    expect(complianceRegionFits).toBe(true);
    await expect(
      page.getByText("Unavailable after Label Created"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Recheck" })).toHaveCount(1);

    await page.getByRole("button", { name: "Recheck" }).first().click();
    await expect(
      page.getByText("Post-charge compliance check completed."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Check release" }).click();
    await expect(
      page.getByText("Release post-charge compliance checks completed."),
    ).toBeVisible();
    expect(
      capture.some(
        (request) =>
          request.method === "POST" &&
          request.path === `/api/compliance/shipments/${shipmentId}/check`,
      ),
    ).toBe(true);
    expect(
      capture.some(
        (request) =>
          request.method === "POST" &&
          request.path === `/api/compliance/releases/${releaseId}/check`,
      ),
    ).toBe(true);
  });
});
