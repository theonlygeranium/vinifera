import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const organizationId = "10000000-0000-4000-8000-000000000001";
const staffId = "20000000-0000-4000-8000-000000000001";
const memberId = "30000000-0000-4000-8000-000000000001";
const tierId = "40000000-0000-4000-8000-000000000001";
const lowerTierId = "40000000-0000-4000-8000-000000000002";
const shipmentId = "60000000-0000-4000-8000-000000000001";
const wineId = "80000000-0000-4000-8000-000000000001";

type EmailTriggerFixture =
  | "welcome"
  | "pre_shipment"
  | "payment_decline"
  | "shipped"
  | "birthday"
  | "re_engagement";

interface EmailTemplateFixture {
  body: string;
  daysBefore?: number;
  enabled: boolean;
  id: string;
  senderStatus: "active" | "activation_required";
  subject: string;
  triggerType: EmailTriggerFixture;
  updatedAt: string;
}

interface EmailLogFixture {
  createdAt: string;
  errorMessage: string | null;
  id: string;
  memberId: string | null;
  providerId: string | null;
  recipient: string;
  status: "sent" | "failed" | "bounced";
  templateId: string;
  templateName: string;
}

type CancelStepIdFixture = "pause" | "downgrade" | "swap" | "confirm";

interface CancelStepFixture {
  description: string;
  enabled: boolean;
  id: CancelStepIdFixture;
  order: number;
  position?: number;
  stepId: string;
  title: string;
}

const staffSession = {
  access: { graceEndsAt: null, state: "active", suspendedAt: null },
  authenticated: true,
  organization: {
    accessState: "active",
    id: organizationId,
    name: "QA Winery",
    planTier: "vine",
    stripeCustomerId: "cus_phase3_test",
    stripeSubscriptionId: "sub_phase3_test",
    subscriptionStatus: "active",
  },
  user: {
    email: "owner@example.com",
    fullName: "QA Owner",
    id: staffId,
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

const emailTemplates: EmailTemplateFixture[] = [
  {
    body: "Welcome {{member_first_name}} to {{winery_name}}.",
    enabled: true,
    id: "91000000-0000-4000-8000-000000000001",
    senderStatus: "active",
    subject: "Welcome to {{winery_name}}",
    triggerType: "welcome",
    updatedAt: "2026-07-25T12:00:00.000Z",
  },
  {
    body: "Your {{release_name}} allocation processes soon.",
    daysBefore: 3,
    enabled: true,
    id: "91000000-0000-4000-8000-000000000002",
    senderStatus: "active",
    subject: "Your next club shipment",
    triggerType: "pre_shipment",
    updatedAt: "2026-07-25T12:00:00.000Z",
  },
  {
    body: "Please update your payment method.",
    enabled: true,
    id: "91000000-0000-4000-8000-000000000003",
    senderStatus: "active",
    subject: "Payment update needed",
    triggerType: "payment_decline",
    updatedAt: "2026-07-25T12:00:00.000Z",
  },
  {
    body: "Your wine is on the way.",
    enabled: true,
    id: "91000000-0000-4000-8000-000000000004",
    senderStatus: "active",
    subject: "Your club shipment has shipped",
    triggerType: "shipped",
    updatedAt: "2026-07-25T12:00:00.000Z",
  },
  {
    body: "Happy birthday from the cellar.",
    enabled: true,
    id: "91000000-0000-4000-8000-000000000005",
    senderStatus: "active",
    subject: "A birthday toast",
    triggerType: "birthday",
    updatedAt: "2026-07-25T12:00:00.000Z",
  },
  {
    body: "We saved you a place at the table.",
    enabled: false,
    id: "91000000-0000-4000-8000-000000000006",
    senderStatus: "active",
    subject: "The cellar misses you",
    triggerType: "re_engagement",
    updatedAt: "2026-07-25T12:00:00.000Z",
  },
];

const emailLog: EmailLogFixture[] = [
  {
    createdAt: "2026-07-25T15:00:00.000Z",
    errorMessage: null,
    id: "92000000-0000-4000-8000-000000000001",
    memberId,
    providerId: "resend_test_delivery",
    recipient: "avery@example.com",
    status: "sent",
    templateId: emailTemplates[0]!.id,
    templateName: "Welcome email",
  },
];

const churnScores = [
  {
    calculatedAt: "2026-07-26T02:00:00.000Z",
    contributingFactors: [
      {
        detail: "The member visited the portal yesterday.",
        direction: "lowers",
        id: "portal-visit",
        label: "Recent portal visit",
        points: -8,
      },
    ],
    email: "avery@example.com",
    memberId,
    memberName: "Avery Vine",
    riskLevel: "low",
    score: 18,
    tierName: "Founders Circle",
  },
  {
    calculatedAt: "2026-07-26T02:00:00.000Z",
    contributingFactors: [
      {
        detail: "Two shipment charges declined in the last 90 days.",
        direction: "raises",
        id: "declines",
        label: "Missed payments",
        points: 42,
      },
      {
        detail: "No portal activity has been recorded for 73 days.",
        direction: "raises",
        id: "inactive",
        label: "Portal inactivity",
        points: 24,
      },
    ],
    email: "jordan@example.com",
    memberId: "30000000-0000-4000-8000-000000000002",
    memberName: "Jordan Cellar",
    riskLevel: "high",
    score: 82,
    tierName: "Estate Reserve",
  },
];

const cancelSteps: CancelStepFixture[] = [
  {
    description: "Pause one or three months without losing club benefits.",
    enabled: true,
    id: "pause",
    order: 1,
    stepId: "93000000-0000-4000-8000-000000000001",
    title: "Take a break",
  },
  {
    description: "Move to a lower-priced club tier.",
    enabled: true,
    id: "downgrade",
    order: 2,
    stepId: "93000000-0000-4000-8000-000000000002",
    title: "Switch to a lighter tier",
  },
  {
    description: "Choose another wine for the next shipment.",
    enabled: true,
    id: "swap",
    order: 3,
    stepId: "93000000-0000-4000-8000-000000000003",
    title: "Try a different wine",
  },
  {
    description: "Review the impact and confirm cancellation.",
    enabled: true,
    id: "confirm",
    order: 4,
    stepId: "93000000-0000-4000-8000-000000000004",
    title: "Confirm cancellation",
  },
];

const cancelAnalytics = {
  attempts: 12,
  cancelled: 4,
  recentOutcomes: [
    {
      createdAt: "2026-07-25T18:00:00.000Z",
      id: "94000000-0000-4000-8000-000000000001",
      memberId,
      memberName: "Avery Vine",
      outcome: "paused",
      step: "pause",
    },
  ],
  retained: 8,
  retentionRate: 66.7,
  steps: [
    { conversionRate: 41.7, intercepted: 5, reached: 12, step: "pause" },
    { conversionRate: 20, intercepted: 2, reached: 10, step: "downgrade" },
    { conversionRate: 12.5, intercepted: 1, reached: 8, step: "swap" },
    { conversionRate: 0, intercepted: 0, reached: 4, step: "confirm" },
  ],
};

const memberCancelFlow = {
  attemptId: "95000000-0000-4000-8000-000000000001",
  benefitsAtRisk: [
    "Priority allocation access",
    "Member event pricing",
    "Founders Circle loyalty multiplier",
  ],
  currentTier: { id: tierId, name: "Founders Circle", priceCents: 14900 },
  lowerTiers: [
    {
      bottleCount: 2,
      id: lowerTierId,
      name: "Founders Lite",
      priceCents: 9900,
    },
  ],
  loyaltyBalance: 950,
  nextShipmentId: shipmentId,
  steps: cancelSteps,
  swapOptions: [
    { id: wineId, name: "Estate Chardonnay", priceCents: 4200, quantity: 1 },
  ],
};

const baseLedger = [
  {
    createdAt: "2026-07-01T12:00:00.000Z",
    expiresAt: "2028-07-01T12:00:00.000Z",
    id: "96000000-0000-4000-8000-000000000001",
    points: 150,
    reason: "Summer release shipment",
    type: "shipment",
  },
  {
    createdAt: "2026-06-15T12:00:00.000Z",
    expiresAt: "2028-06-15T12:00:00.000Z",
    id: "96000000-0000-4000-8000-000000000002",
    points: 75,
    reason: "Member anniversary",
    type: "anniversary",
  },
];

const portalShipment = {
  address: {
    city: "Napa",
    country: "US",
    line1: "123 Vine Street",
    line2: null,
    postalCode: "94558",
    state: "CA",
  },
  carrier: null,
  chargeAmountCents: 14900,
  createdAt: "2026-07-20T12:00:00.000Z",
  displayContents: true,
  id: shipmentId,
  items: [{ id: wineId, name: "Estate Cabernet", quantity: 3 }],
  memberEmail: "avery@example.com",
  memberId,
  memberName: "Avery Vine",
  releaseId: "50000000-0000-4000-8000-000000000001",
  releaseName: "Fall 2026",
  status: "charged",
  tierName: "Founders Circle",
  trackingNumber: null,
};

type Capture = Array<{ body: unknown; method: string; path: string }>;

interface MockState {
  cancelConfig: {
    id: string;
    steps: CancelStepFixture[];
    updatedAt: string;
  };
  emailLog: EmailLogFixture[];
  emailTemplates: EmailTemplateFixture[];
  loyaltyAccount: {
    availablePoints: number;
    expiringPoints: number;
    ledger: Array<{
      createdAt: string;
      expiresAt: string | null;
      id: string;
      points: number;
      reason: string;
      type: string;
    }>;
    memberEmail: string;
    memberId: string;
    memberName: string;
    multiplier: number;
    nextExpirationAt: string;
    pendingPoints: number;
    redemptionRate: { discountCents: number; points: number };
    tierName: string;
  };
  metaPrivacy: {
    consentSource: string | null;
    consented: boolean | null;
    consentedAt: string | null;
    policyVersion: string | null;
    revokedAt: string | null;
    updatedAt: string | null;
  };
}

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    body: JSON.stringify({ data }),
    contentType: "application/json",
    status,
  });
}

function createMockState(): MockState {
  return {
    cancelConfig: {
      id: "97000000-0000-4000-8000-000000000001",
      steps: cancelSteps.map((step) => ({ ...step })),
      updatedAt: "2026-07-25T12:00:00.000Z",
    },
    emailLog: emailLog.map((entry) => ({ ...entry })),
    emailTemplates: emailTemplates.map((template) => ({ ...template })),
    loyaltyAccount: {
      availablePoints: 950,
      expiringPoints: 150,
      ledger: baseLedger.map((entry) => ({ ...entry })),
      memberEmail: "avery@example.com",
      memberId,
      memberName: "Avery Vine",
      multiplier: 1.25,
      nextExpirationAt: "2028-06-15T12:00:00.000Z",
      pendingPoints: 50,
      redemptionRate: { discountCents: 1000, points: 100 },
      tierName: "Founders Circle",
    },
    metaPrivacy: {
      consentSource: null,
      consented: null,
      consentedAt: null,
      policyVersion: null,
      revokedAt: null,
      updatedAt: null,
    },
  };
}

async function installMockApi(page: Page, capture: Capture = []) {
  const state = createMockState();
  let attempt = 0;

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
        body = request.postData();
      }
      capture.push({ body, method, path });
    }

    if (path === "/api/auth/staff/session") return json(route, staffSession);
    if (path === "/api/auth/member/session") return json(route, memberSession);
    if (path === "/api/portal/branding") {
      return json(route, { brand: null, mode: "canonical" });
    }
    if (path === "/api/brands" && method === "GET") {
      return json(route, {
        canViewAllBrands: false,
        items: [
          {
            billingMode: "shared",
            customDomain: null,
            description: null,
            domainStatus: "unconfigured",
            fontFamily: null,
            id: "30000000-0000-4000-8000-000000000001",
            isDefault: true,
            logoUrl: null,
            name: staffSession.organization.name,
            primaryColor: null,
          },
        ],
      });
    }

    if (path === "/api/email/templates" && method === "GET") {
      return json(route, state.emailTemplates);
    }
    if (path === "/api/email/log" && method === "GET") {
      return json(route, { items: state.emailLog, total: state.emailLog.length });
    }
    const emailAction = path.match(
      /^\/api\/email\/templates\/([^/]+)\/(preview|test)$/,
    );
    if (emailAction?.[2] === "preview" && method === "POST") {
      const previewBody = body as { body?: string; subject?: string };
      return json(route, {
        body: (previewBody.body ?? "")
          .replaceAll("{{member_first_name}}", "Avery")
          .replaceAll("{{release_name}}", "Fall 2026")
          .replaceAll("{{winery_name}}", "QA Winery"),
        subject: (previewBody.subject ?? "")
          .replaceAll("{{member_first_name}}", "Avery")
          .replaceAll("{{release_name}}", "Fall 2026")
          .replaceAll("{{winery_name}}", "QA Winery"),
      });
    }
    if (emailAction?.[2] === "test" && method === "POST") {
      const testBody = body as { email?: string; recipient?: string };
      const template = state.emailTemplates.find(
        (candidate) => candidate.id === emailAction[1],
      );
      state.emailLog = [
        {
          createdAt: "2026-07-26T15:00:00.000Z",
          errorMessage: null,
          id: "92000000-0000-4000-8000-000000000002",
          memberId: null,
          providerId: "resend_phase3_test",
          recipient: testBody.recipient ?? testBody.email ?? "",
          status: "sent",
          templateId: template?.id ?? emailAction[1]!,
          templateName:
            template?.triggerType === "pre_shipment"
              ? "Pre-shipment notice"
              : "Lifecycle email",
        },
        ...state.emailLog,
      ];
      return json(route, { accepted: true });
    }
    const emailTemplate = path.match(/^\/api\/email\/templates\/([^/]+)$/);
    if (emailTemplate && method === "PATCH") {
      const index = state.emailTemplates.findIndex(
        (candidate) => candidate.id === emailTemplate[1],
      );
      const patch = body as Record<string, unknown>;
      if (index >= 0) {
        state.emailTemplates[index] = {
          ...state.emailTemplates[index]!,
          ...patch,
          updatedAt: "2026-07-26T15:00:00.000Z",
        } as EmailTemplateFixture;
      }
      return json(route, state.emailTemplates[index]);
    }

    if (path === "/api/churn-scores" && method === "GET") {
      const riskLevel = url.searchParams.get("riskLevel");
      const search = url.searchParams.get("search")?.toLowerCase();
      const items = churnScores.filter(
        (score) =>
          (!riskLevel || score.riskLevel === riskLevel) &&
          (!search ||
            `${score.memberName} ${score.email}`
              .toLowerCase()
              .includes(search)),
      );
      return json(route, {
        calculatedAt: "2026-07-26T02:00:00.000Z",
        highCount: items.filter((score) => score.riskLevel === "high").length,
        items,
        lowCount: items.filter((score) => score.riskLevel === "low").length,
        mediumCount: items.filter((score) => score.riskLevel === "medium").length,
        scoredCount: items.length,
        total: items.length,
      });
    }
    if (path === "/api/churn-intelligence" && method === "GET") {
      const riskLevel = url.searchParams.get("riskLevel");
      const search = url.searchParams.get("search")?.toLowerCase();
      const items = churnScores
        .filter(
          (score) =>
            (!riskLevel || score.riskLevel === riskLevel) &&
            (!search ||
              `${score.memberName} ${score.email}`
                .toLowerCase()
                .includes(search)),
        )
        .map((score) => ({
          ...score,
          rulesScore: score.score,
          source: "rules",
          topFeatures: score.contributingFactors,
        }));
      return json(route, {
        fallbackReason:
          "The production ML gate is still pending, so explainable Phase 3 rules remain authoritative.",
        items,
        mode: "rules_fallback",
      });
    }
    if (/^\/api\/members\/[^/]+\/churn-score$/.test(path)) {
      return json(
        route,
        churnScores.find((score) => path.includes(score.memberId)) ??
          churnScores[0],
      );
    }

    if (path === "/api/cancel-flow/config" && method === "GET") {
      return json(route, state.cancelConfig);
    }
    if (path === "/api/cancel-flow/config" && method === "PATCH") {
      const patch = body as {
        steps?: Array<{
          enabled: boolean;
          id: CancelStepIdFixture;
          order: number;
          position?: number;
          stepId?: string;
        }>;
      };
      state.cancelConfig = {
        ...state.cancelConfig,
        steps: (patch.steps ?? []).map((incoming) => ({
          ...state.cancelConfig.steps.find((step) => step.id === incoming.id)!,
          ...incoming,
        })),
        updatedAt: "2026-07-26T15:00:00.000Z",
      };
      return json(route, state.cancelConfig);
    }
    if (path === "/api/cancel-flow/analytics" && method === "GET") {
      return json(route, cancelAnalytics);
    }
    if (path === "/api/member/cancel-flow" && method === "GET") {
      return json(route, memberCancelFlow);
    }
    if (path === "/api/member/cancel-flow" && method === "POST") {
      attempt += 1;
      return json(route, {
        ...memberCancelFlow,
        attemptId: `95000000-0000-4000-8000-${String(attempt).padStart(12, "0")}`,
      });
    }
    if (path === "/api/member/cancel-flow/events" && method === "POST") {
      const event = body as { outcome?: string };
      const messages: Record<string, string> = {
        cancelled: "Your membership cancellation has been confirmed.",
        downgraded: "Your club tier change is confirmed.",
        paused: "Your membership pause is confirmed.",
        swapped: "Your next shipment swap is confirmed.",
      };
      return json(route, { message: messages[event.outcome ?? ""] });
    }
    if (path === "/api/member/privacy/meta" && method === "GET") {
      return json(route, state.metaPrivacy);
    }
    if (path === "/api/member/privacy/meta" && method === "PUT") {
      const preference = body as {
        attribution?: unknown;
        consentSource: string;
        consented: boolean;
        policyVersion: string;
      };
      const updatedAt = "2026-07-26T15:00:00.000Z";
      state.metaPrivacy = {
        consentSource: preference.consentSource,
        consented: preference.consented,
        consentedAt: preference.consented ? updatedAt : null,
        policyVersion: preference.policyVersion,
        revokedAt:
          !preference.consented &&
          preference.consentSource === "member_portal_revoke"
            ? updatedAt
            : null,
        updatedAt,
      };
      return json(route, {
        attributionCaptured: Boolean(preference.attribution),
        attributionId: preference.attribution
          ? "99000000-0000-4000-8000-000000000001"
          : null,
        consented: preference.consented,
      });
    }

    if (path === "/api/loyalty/members" && method === "GET") {
      const item = {
        availablePoints: state.loyaltyAccount.availablePoints,
        memberEmail: state.loyaltyAccount.memberEmail,
        memberId,
        memberName: "Avery Vine",
        multiplier: state.loyaltyAccount.multiplier,
        tierName: state.loyaltyAccount.tierName,
      };
      return json(route, { items: [item], page: 1, pageSize: 1, total: 1 });
    }
    if (path === `/api/loyalty/members/${memberId}` && method === "GET") {
      return json(route, state.loyaltyAccount);
    }
    if (path === `/api/loyalty/members/${memberId}/adjust` && method === "POST") {
      const adjustment = body as { points: number; reason: string };
      state.loyaltyAccount.availablePoints += adjustment.points;
      state.loyaltyAccount.ledger = [
        {
          createdAt: "2026-07-26T15:00:00.000Z",
          expiresAt: "2028-07-26T15:00:00.000Z",
          id: "96000000-0000-4000-8000-000000000003",
          points: adjustment.points,
          reason: adjustment.reason,
          type: "adjustment",
        },
        ...state.loyaltyAccount.ledger,
      ];
      return json(route, { recorded: true });
    }
    if (path === `/api/loyalty/members/${memberId}/events` && method === "POST") {
      const attendance = body as { reason: string };
      state.loyaltyAccount.availablePoints += 63;
      state.loyaltyAccount.ledger = [
        {
          createdAt: "2026-07-26T15:00:00.000Z",
          expiresAt: "2028-07-26T15:00:00.000Z",
          id: "96000000-0000-4000-8000-000000000004",
          points: 63,
          reason: attendance.reason,
          type: "event",
        },
        ...state.loyaltyAccount.ledger,
      ];
      return json(route, { recorded: true });
    }
    if (path === "/api/member/loyalty" && method === "GET") {
      return json(route, state.loyaltyAccount);
    }
    if (path === "/api/member/loyalty/redeem" && method === "POST") {
      const redemption = body as { points: number };
      state.loyaltyAccount.availablePoints -= redemption.points;
      state.loyaltyAccount.ledger = [
        {
          createdAt: "2026-07-26T15:00:00.000Z",
          expiresAt: null,
          id: "96000000-0000-4000-8000-000000000005",
          points: -redemption.points,
          reason: "Fall 2026 shipment redemption",
          type: "redemption",
        },
        ...state.loyaltyAccount.ledger,
      ];
      return json(route, {
        message: "Your Vine Points redemption was applied.",
      });
    }
    if (path === "/api/member/shipments" && method === "GET") {
      return json(route, [portalShipment]);
    }

    return route.fulfill({
      body: JSON.stringify({
        error: {
          code: "UNMOCKED_PHASE3_ROUTE",
          message: `No Phase 3 mock exists for ${method} ${path}.`,
        },
      }),
      contentType: "application/json",
      status: 501,
    });
  });

  return state;
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
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            tag: element.tagName,
            text: element.textContent?.trim().slice(0, 60),
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
    .locator("button:visible, a[href]:visible")
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            height: Math.round(rect.height),
            name:
              element.getAttribute("aria-label") ||
              element.textContent?.trim() ||
              element.tagName,
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
    Object.defineProperty(window, "__viniferaPhase3Metrics", { value: metrics });
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
          __viniferaPhase3Metrics: { cls: number; lcp: number };
        }
      ).__viniferaPhase3Metrics,
  );
  expect(metrics.lcp).toBeLessThan(2_500);
  expect(metrics.cls).toBeLessThan(0.1);
}

test.describe("Phase 3 retention and communications surfaces", () => {
  const routes = [
    { heading: "Email templates", path: "/app/communications" },
    { heading: "AI Churn Watch", path: "/app/churn-watch" },
    { heading: "Cancel-flow retention", path: "/app/retention" },
    { heading: "Loyalty balances and ledger", path: "/app/loyalty" },
    { heading: "Welcome, Avery", path: "/portal" },
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
      });
    }
  }
});

test.describe("Phase 3 communications and explainable churn", () => {
  test("staff can edit, preview, test, and audit a lifecycle email", async ({
    page,
  }) => {
    const capture: Capture = [];
    await installMockApi(page, capture);
    await page.goto("/app/communications");
    await page.getByRole("button", { name: /Pre-shipment notice/ }).click();

    await page.getByLabel("Subject line").fill("Fall release for {{member_first_name}}");
    await page
      .getByLabel("Email body")
      .fill("Hello {{member_first_name}}, your {{release_name}} allocation is ready.");
    await page.getByLabel("Send before processing").fill("5");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Pre-shipment notice saved.")).toBeVisible();

    const saveRequest = capture.find(
      (request) =>
        request.method === "PATCH" &&
        request.path === `/api/email/templates/${emailTemplates[1]!.id}`,
    );
    expect(saveRequest?.body).toMatchObject({
      daysBefore: 5,
      enabled: true,
      subject: "Fall release for {{member_first_name}}",
    });

    await page.getByRole("button", { name: "Preview" }).click();
    const preview = page.getByRole("dialog", { name: "Email preview" });
    await expect(preview).toBeVisible();
    await expect(preview.getByText("Fall release for Avery")).toBeVisible();
    await expect(
      preview.getByText("Hello Avery, your Fall 2026 allocation is ready."),
    ).toBeVisible();
    await preview.getByRole("button", { name: "Close Email preview" }).click();

    await page.getByRole("button", { name: "Send test" }).click();
    const testDialog = page.getByRole("dialog", { name: "Send a test email" });
    await testDialog
      .getByLabel("Recipient email")
      .fill("qa-delivery@example.com");
    await testDialog.getByRole("button", { name: "Send test email" }).click();
    await expect(
      page.getByText("Test email accepted for qa-delivery@example.com."),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "qa-delivery@example.com", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("resend_phase3_test")).toBeVisible();
    expect(
      capture.find((request) => request.path.endsWith("/test"))?.body,
    ).toMatchObject({
      email: "qa-delivery@example.com",
      recipient: "qa-delivery@example.com",
    });
  });

  test("churn queue sorts highest risk first and exposes contributing factors", async ({
    page,
  }) => {
    await installMockApi(page);
    await page.goto("/app/churn-watch");

    const rows = page.locator(".churn-watch-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Jordan Cellar");
    await expect(rows.nth(0)).toContainText("High risk · 82%");
    await expect(rows.nth(1)).toContainText("Avery Vine");
    await expect(
      page.getByRole("heading", {
        name: "Rules engine is protecting score continuity",
      }),
    ).toBeVisible();

    await rows.nth(0).getByText("Why this score?", { exact: true }).click();
    await expect(rows.nth(0).getByText("Missed payments")).toBeVisible();
    await expect(rows.nth(0).getByText("Portal inactivity")).toBeVisible();

    await page.getByLabel("Filter by risk level").selectOption("high");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Jordan Cellar");
    await expect(rows.first()).toContainText("Rules 82");
    await expect(rows.first()).toContainText("Rules fallback");
  });
});

test.describe("Phase 3 cancel-flow retention", () => {
  test("staff can reorder, disable, save, and inspect measured outcomes", async ({
    page,
  }) => {
    const capture: Capture = [];
    await installMockApi(page, capture);
    await page.goto("/app/retention");

    const settings = page.locator(".cancel-step-settings");
    await expect(settings.locator("li").nth(0)).toContainText("Take a break");
    await page.getByRole("button", { name: "Move Take a break later" }).click();
    await expect(settings.locator("li").nth(0)).toContainText(
      "Switch to a lighter tier",
    );
    await expect(settings.locator("li").nth(1)).toContainText("Take a break");

    const swapSetting = settings
      .locator("li")
      .filter({ hasText: "Try a different wine" });
    await swapSetting.locator("label.toggle-control").click();
    await expect(swapSetting.getByRole("checkbox")).not.toBeChecked();
    await page.getByRole("button", { name: "Save Flow" }).click();
    await expect(
      page.getByText("Cancel-flow order and availability saved."),
    ).toBeVisible();

    const request = capture.find(
      (candidate) =>
        candidate.method === "PATCH" &&
        candidate.path === "/api/cancel-flow/config",
    );
    expect(request?.body).toMatchObject({
      steps: [
        { id: "downgrade", order: 1 },
        { id: "pause", order: 2 },
        { enabled: false, id: "swap", order: 3 },
        { enabled: true, id: "confirm", order: 4 },
      ],
    });
    await expect(page.getByText("66.7%", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Recent member cancel-flow outcomes" }),
    ).toContainText("Avery Vine");
  });

  test("member sees every offer and can complete an accessible cancellation", async ({
    page,
  }) => {
    const capture: Capture = [];
    await installMockApi(page, capture);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/portal");
    await expect(page.getByRole("heading", { name: "Vine Points" })).toBeVisible();

    const cancelTrigger = page
      .locator(".portal-action-grid")
      .getByRole("button", { name: /Cancel membership/ });
    await cancelTrigger.focus();
    await expect(cancelTrigger).toBeFocused();

    const startedAt = await page.evaluate(() => performance.now());
    await cancelTrigger.click();
    const dialog = page.getByRole("dialog", { name: "Membership options" });
    await expect(dialog).toBeVisible();
    const openElapsed = await page.evaluate(
      (start) => performance.now() - start,
      startedAt,
    );
    expect(openElapsed).toBeLessThan(500);

    const closeButton = dialog.getByRole("button", {
      name: "Close Membership options",
    });
    await expect(closeButton).toBeFocused();
    await closeButton.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "Continue cancellation" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeButton).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(cancelTrigger).toBeFocused();

    async function openFlow() {
      await cancelTrigger.click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("Step 1 of 4")).toBeVisible();
    }

    await openFlow();
    await dialog.getByLabel("Pause for three months").check();
    await dialog.getByRole("button", { name: "Pause membership" }).click();
    await expect(page.getByText("Your membership pause is confirmed.")).toBeVisible();

    await openFlow();
    await dialog.getByRole("button", { name: "Continue cancellation" }).click();
    await expect(dialog.getByText("Step 2 of 4")).toBeVisible();
    await dialog.getByLabel("Founders Lite").check();
    await dialog.getByRole("button", { name: "Switch tier" }).click();
    await expect(page.getByText("Your club tier change is confirmed.")).toBeVisible();

    await openFlow();
    await dialog.getByRole("button", { name: "Continue cancellation" }).click();
    await dialog.getByRole("button", { name: "Continue cancellation" }).click();
    await expect(dialog.getByText("Step 3 of 4")).toBeVisible();
    await dialog.getByLabel("Estate Chardonnay").check();
    await dialog
      .getByRole("button", { name: "Swap next shipment" })
      .click();
    await expect(page.getByText("Your next shipment swap is confirmed.")).toBeVisible();

    await openFlow();
    await dialog.getByRole("button", { name: "Continue cancellation" }).click();
    await dialog.getByRole("button", { name: "Continue cancellation" }).click();
    await dialog.getByRole("button", { name: "Continue cancellation" }).click();
    await expect(dialog.getByText("Step 4 of 4")).toBeVisible();
    await expect(dialog.getByText("950 loyalty points")).toBeVisible();
    await dialog
      .getByLabel(/I understand this ends my active membership/)
      .check();
    await dialog.getByRole("button", { name: "Cancel membership" }).click();
    await expect(
      page.getByText("Your membership cancellation has been confirmed."),
    ).toBeVisible();
    await expect(cancelTrigger).toBeFocused();

    const events = capture
      .filter((request) => request.path === "/api/member/cancel-flow/events")
      .map((request) => request.body as Record<string, unknown>);
    expect(events.map((event) => event.outcome)).toEqual([
      "paused",
      "continued",
      "downgraded",
      "continued",
      "continued",
      "swapped",
      "continued",
      "continued",
      "continued",
      "cancelled",
    ]);
    expect(events.find((event) => event.outcome === "paused")).toMatchObject({
      details: { months: 3 },
      step: "pause",
    });
    expect(events.find((event) => event.outcome === "downgraded")).toMatchObject({
      offerId: lowerTierId,
      step: "downgrade",
    });
    expect(events.find((event) => event.outcome === "swapped")).toMatchObject({
      offerId: wineId,
      step: "swap",
    });
    expect(events.at(-1)).toMatchObject({
      action: "cancelled",
      outcome: "cancelled",
      step: "confirm",
    });
  });
});

test.describe("Phase 3 loyalty program", () => {
  test("staff can audit a member and record adjustments and attendance", async ({
    page,
  }) => {
    const capture: Capture = [];
    await installMockApi(page, capture);
    await page.goto("/app/loyalty");
    await expect(
      page.getByRole("table", { name: "Loyalty points ledger for Avery Vine" }),
    ).toContainText("Summer release shipment");

    await page.getByRole("button", { name: "Adjust Points" }).click();
    const adjustmentDialog = page.getByRole("dialog", {
      name: "Adjust loyalty points",
    });
    await adjustmentDialog.getByLabel("Points adjustment").fill("125");
    await adjustmentDialog.getByLabel("Reason").fill("Service recovery award");
    await adjustmentDialog
      .getByRole("button", { name: "Record adjustment" })
      .click();
    await expect(
      page.getByText("Loyalty adjustment recorded in the member ledger."),
    ).toBeVisible();
    await expect(page.getByText("Service recovery award")).toBeVisible();

    await page.getByRole("button", { name: "Record Attendance" }).click();
    const attendanceDialog = page.getByRole("dialog", {
      name: "Record event attendance",
    });
    await attendanceDialog
      .getByLabel("Event name or reason")
      .fill("Summer release tasting");
    await attendanceDialog
      .getByLabel("Attendance date (optional)")
      .fill("2026-07-20");
    await attendanceDialog
      .getByRole("button", { name: "Record event attendance", exact: true })
      .click();
    await expect(
      page.getByText("Event attendance recorded in the member loyalty ledger."),
    ).toBeVisible();
    await expect(page.getByText("Summer release tasting")).toBeVisible();

    const adjustment = capture.find((request) =>
      request.path.endsWith("/adjust"),
    );
    expect(adjustment?.body).toEqual({
      points: 125,
      reason: "Service recovery award",
    });
    const attendance = capture.find((request) =>
      request.path.endsWith("/events"),
    );
    expect(attendance?.body).toMatchObject({
      eventType: "event_attendance",
      occurredAt: "2026-07-20T12:00:00.000Z",
      reason: "Summer release tasting",
    });
    expect(
      (attendance?.body as { eventId?: string }).eventId,
    ).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test("member can inspect the ledger and redeem points for a shipment", async ({
    page,
  }) => {
    const capture: Capture = [];
    await installMockApi(page, capture);
    await page.goto("/portal");

    await expect(
      page.getByRole("table", { name: "Your complete loyalty points ledger" }),
    ).toContainText("Summer release shipment");
    await expect(
      page.locator(".portal-loyalty__balance strong"),
    ).toHaveText("950");

    await page.getByRole("button", { name: "Redeem points" }).click();
    const dialog = page.getByRole("dialog", { name: "Redeem Vine Points" });
    await dialog.getByLabel("Points to redeem").fill("200");
    await dialog.getByRole("button", { name: "Apply redemption" }).click();
    await expect(
      page.getByText("Your Vine Points redemption was applied."),
    ).toBeVisible();
    await expect(page.locator(".portal-loyalty__balance strong")).toHaveText(
      "750",
    );
    await expect(page.getByText("Fall 2026 shipment redemption")).toBeVisible();

    const redemption = capture.find(
      (request) => request.path === "/api/member/loyalty/redeem",
    );
    expect(redemption?.body).toMatchObject({
      points: 200,
      shipmentId,
    });
    expect(
      (redemption?.body as { idempotencyKey?: string }).idempotencyKey,
    ).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test("member can explicitly allow and revoke Meta attribution", async ({
    page,
  }) => {
    const capture: Capture = [];
    await installMockApi(page, capture);
    await page.goto("/portal");

    await expect(page.getByText("Current choice:")).toContainText(
      "No choice recorded",
    );
    await page.getByRole("button", { name: "Allow attribution" }).click();
    await expect(page.getByText("Current choice:")).toContainText("Allowed");
    await expect(
      page.getByText("Meta attribution is allowed for your member activity."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Revoke consent" }).click();
    await expect(page.getByText("Current choice:")).toContainText("Revoked");
    await expect(
      page.getByText(
        "Meta attribution consent was revoked and stored identifiers were redacted.",
      ),
    ).toBeVisible();

    const preferences = capture.filter(
      (request) =>
        request.method === "PUT" &&
        request.path === "/api/member/privacy/meta",
    );
    expect(preferences).toHaveLength(2);
    expect(preferences[0]?.body).toMatchObject({
      consentSource: "member_portal_accept",
      consented: true,
      policyVersion: "2026-07",
    });
    expect(preferences[1]?.body).toMatchObject({
      consentSource: "member_portal_revoke",
      consented: false,
      policyVersion: "2026-07",
    });
  });
});
