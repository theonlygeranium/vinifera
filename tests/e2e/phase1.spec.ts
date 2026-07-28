import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const staffSession = {
  access: {
    graceEndsAt: null,
    state: "active",
    suspendedAt: null,
  },
  authenticated: true,
  organization: {
    accessState: "active",
    id: "10000000-0000-4000-8000-000000000001",
    name: "QA Winery",
    planTier: "vine",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: "not_started",
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
  organization: {
    id: staffSession.organization.id,
    name: staffSession.organization.name,
  },
  user: {
    email: "member@example.com",
    firstName: "Avery",
    id: "30000000-0000-4000-8000-000000000001",
    lastName: "Vine",
    status: "active",
  },
};

const emptyOrganizationOverview = {
  activeMembers: 0,
  brandCount: 0,
  brands: [],
  monthlyRecurringRevenueCents: 0,
  shipmentsThisPeriod: 0,
};

async function mockStaffWorkspace(
  page: Page,
  session: unknown = staffSession,
) {
  await page.route("**/api/auth/staff/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: session }),
    }),
  );
  await page.route("**/api/brands", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: { canViewAllBrands: false, items: [] },
      }),
    }),
  );
  await page.route("**/api/organization/overview", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: emptyOrganizationOverview }),
    }),
  );
}

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
}

async function assertA11y(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function assertConsoleHealth(page: Page, action: () => Promise<void>) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await action();
  expect(errors).toEqual([]);
}

test.describe("Phase 1 public authentication surfaces", () => {
  for (const surface of [
    {
      headingFragment: "Your wine club deserves software that works as hard as",
      name: "marketing",
      path: "/",
    },
    {
      headingFragment: "Vinifera: The Full Picture",
      name: "investor-guide",
      path: "/guide/",
    },
  ]) {
    test(`${surface.name} static baseline remains accessible on mobile`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(surface.path);
      await expect(page.locator("h1")).toContainText(surface.headingFragment);
      await assertA11y(page);
      await assertNoHorizontalOverflow(page);
    });
  }

  test("marketing pricing matches every canonical subscription tier", async ({
    page,
  }) => {
    await page.goto("/");
    const pricing = page.locator("#pricing");

    for (const tier of [
      { name: "Vine", price: "$149/mo", entitlement: "Up to 250 members" },
      { name: "Cellar", price: "$349/mo", entitlement: "Up to 1,000 members" },
      { name: "Estate", price: "$749/mo", entitlement: "Unlimited members" },
      { name: "Reserve", price: "$1,500+/mo", entitlement: "Multi-brand estates" },
    ]) {
      const card = pricing.locator(".pricing-card").filter({
        has: page.getByText(tier.name, { exact: true }),
      });
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(tier.price);
      await expect(card).toContainText(tier.entitlement);
    }
  });

  for (const viewport of [
    { name: "mobile", width: 375, height: 812 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 1000 },
  ]) {
    for (const route of [
      { name: "staff-login", path: "/app/login", heading: "Welcome back" },
      {
        name: "staff-signup",
        path: "/app/signup",
        heading: "Create your winery workspace",
      },
      {
        name: "member-login",
        path: "/portal/login",
        heading: "Your wine club, one click away",
      },
    ]) {
      test(`${route.name} passes axe and layout at ${viewport.name}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize(viewport);
        await assertConsoleHealth(page, async () => {
          await page.goto(route.path);
          await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
        });
        await assertA11y(page);
        await assertNoHorizontalOverflow(page);
        if (
          route.name === "staff-login" ||
          route.name === "staff-signup"
        ) {
          await page.screenshot({
            fullPage: true,
            path: testInfo.outputPath(`${route.name}-${viewport.name}.png`),
          });
        }
      });
    }
  }

  test("staff login controls are labeled, keyboard reachable, and interactive", async ({
    page,
  }) => {
    await page.goto("/app/login");
    const email = page.getByLabel("Email address", { exact: true });
    const password = page.getByLabel("Password", { exact: true });
    const toggle = page.getByRole("button", { name: "Show password" });

    await email.fill("qa@example.com");
    await password.fill("LocalOnly1234");
    await email.focus();
    await expect(email).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(password).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).press("Enter");
    await expect(password).toHaveAttribute("type", "password");
  });

  test("staff signup submits organization, owner, and plan to the API", async ({
    page,
  }) => {
    let signupBody: Record<string, unknown> | undefined;
    await mockStaffWorkspace(page);
    await page.route("**/api/auth/staff/signup", async (route) => {
      signupBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            billingActivationRequired: true,
            billingCustomerState: "ready",
            principal: staffSession,
          },
        }),
      });
    });

    await page.goto("/app/signup");
    await page.getByLabel("Winery or organization name").fill("QA Winery");
    await page.getByLabel("Your name").fill("QA Owner");
    await page.getByLabel("Work email").fill("owner@example.com");
    await page.getByLabel("Password", { exact: true }).fill("Production1234");
    await page.getByLabel("Confirm password", { exact: true }).fill("Production1234");
    await page.locator('input[name="planTier"][value="cellar"]').check();
    await page.getByRole("button", { name: "Continue to secure checkout" }).click();
    await expect(page.getByRole("heading", { name: "Welcome to QA Winery" })).toBeVisible();
    await expect(
      page.getByText(
        "Your secure workspace and Stripe Customer are ready. Remaining billing connections can be activated later.",
      ),
    ).toBeVisible();
    expect(signupBody).toMatchObject({
      email: "owner@example.com",
      fullName: "QA Owner",
      organizationName: "QA Winery",
      planTier: "cellar",
    });
  });

  test("staff signup reports Customer reconciliation without discarding the workspace", async ({
    page,
  }) => {
    await mockStaffWorkspace(page);
    await page.route("**/api/auth/staff/signup", (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            billingActivationRequired: true,
            billingCustomerState: "reconciliation_required",
            principal: staffSession,
          },
        }),
      }),
    );
    await page.goto("/app/signup");
    await page.getByLabel("Winery or organization name").fill("QA Winery");
    await page.getByLabel("Your name").fill("QA Owner");
    await page.getByLabel("Work email").fill("owner@example.com");
    await page.getByLabel("Password", { exact: true }).fill("Production1234");
    await page.getByLabel("Confirm password", { exact: true }).fill("Production1234");
    await page.getByRole("button", { name: "Continue to secure checkout" }).click();
    await expect(page.getByRole("heading", { name: "Welcome to QA Winery" })).toBeVisible();
    await expect(
      page.getByText(
        "Your secure workspace is ready. Stripe Customer setup needs a safe retry from Subscription before checkout.",
      ),
    ).toBeVisible();
  });

  test("confirmed-email signup renders a real completion state", async ({ page }) => {
    await page.route("**/api/auth/staff/session", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: { activated: true, authenticated: false },
        }),
      }),
    );
    await page.route("**/api/auth/staff/signup", (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            billingActivationRequired: true,
            billingCustomerState: "deferred",
            principal: null,
          },
        }),
      }),
    );
    await page.goto("/app/signup");
    await page.getByLabel("Winery or organization name").fill("QA Winery");
    await page.getByLabel("Your name").fill("QA Owner");
    await page.getByLabel("Work email").fill("owner@example.com");
    await page.getByLabel("Password", { exact: true }).fill("Production1234");
    await page.getByLabel("Confirm password", { exact: true }).fill("Production1234");
    await page.getByRole("button", { name: "Continue to secure checkout" }).click();
    await expect(
      page.getByRole("heading", { name: "Confirm your staff email" }),
    ).toBeVisible();
    await expect(page.getByText("owner@example.com")).toBeVisible();
  });

  test("session-backed password reset works without a query token", async ({ page }) => {
    let resetBody: Record<string, unknown> | undefined;
    await mockStaffWorkspace(page);
    await page.route("**/api/auth/staff/reset-password", async (route) => {
      resetBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: { updated: true } }),
      });
    });

    await page.goto("/app/reset-password");
    await page.getByLabel("New password", { exact: true }).fill("NewPassword1234");
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill("NewPassword1234");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByRole("heading", { name: "Welcome to QA Winery" })).toBeVisible();
    expect(resetBody).toEqual({ password: "NewPassword1234" });
  });

  test("session-backed staff invitation works without a query token", async ({ page }) => {
    let inviteBody: Record<string, unknown> | undefined;
    await mockStaffWorkspace(page);
    await page.route("**/api/auth/staff/accept-invite", async (route) => {
      inviteBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: staffSession }),
      });
    });

    await page.goto("/app/invite");
    await page.getByLabel("Your name").fill("Invited Manager");
    await page.getByLabel("New password", { exact: true }).fill("InvitePassword1234");
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill("InvitePassword1234");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page.getByRole("heading", { name: "Welcome to QA Winery" })).toBeVisible();
    expect(inviteBody).toEqual({
      fullName: "Invited Manager",
      password: "InvitePassword1234",
    });
  });

  test("member magic-link request keeps account existence private", async ({ page }) => {
    await page.route("**/api/auth/member/session", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: { authenticated: false } }),
      }),
    );
    await page.route("**/api/auth/member/magic-link", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            message: "If this membership exists, a secure sign-in link is on its way.",
          },
        }),
      }),
    );
    await page.goto("/portal/login");
    await page.getByLabel("Member email").fill("member@example.com");
    await page.getByRole("button", { name: "Email me a magic link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText("The link expires in 15 minutes.")).toBeVisible();
  });
});

test.describe("Phase 1 authenticated shells", () => {
  test("protected staff and member routes redirect to their isolated login surfaces", async ({
    page,
  }) => {
    await page.route("**/api/auth/staff/session", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: { authenticated: false } }),
      }),
    );
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app\/login$/);

    await page.route("**/api/auth/member/session", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: { authenticated: false } }),
      }),
    );
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/portal\/login$/);
  });

  test("staff empty dashboard matches the prototype shell and mobile drawer works", async ({
    page,
  }, testInfo) => {
    await mockStaffWorkspace(page);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Welcome to QA Winery" })).toBeVisible();
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open menu" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await assertA11y(page);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("staff-dashboard-mobile.png"),
    });

    await page.setViewportSize({ width: 812, height: 375 });
    await expect(page.getByRole("heading", { name: "Welcome to QA Winery" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("restricted staff can recover billing but cannot use the workspace", async ({
    page,
  }) => {
    const restrictedSession = {
      ...staffSession,
      access: {
        graceEndsAt: "2026-07-25T00:00:00.000Z",
        state: "restricted",
        suspendedAt: null,
      },
      organization: {
        ...staffSession.organization,
        accessState: "restricted",
        subscriptionStatus: "past_due",
      },
    };
    await mockStaffWorkspace(page, restrictedSession);

    await page.goto("/app");
    await expect(
      page.getByRole("heading", { name: "Subscription access: Restricted" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Update billing" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Welcome to QA Winery" }),
    ).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Members" })).not.toBeVisible();
    await assertA11y(page);
  });

  test("owner can send a role-scoped staff invitation on mobile", async ({
    page,
  }, testInfo) => {
    let invitationBody: Record<string, unknown> | undefined;
    await page.route("**/api/auth/staff/session", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: staffSession }),
      }),
    );
    await page.route("**/api/brands", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: { canViewAllBrands: false, items: [] },
        }),
      }),
    );
    await page.route("**/api/staff/invitations", async (route) => {
      invitationBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: { expiresAt: "2026-07-27T00:00:00.000Z" },
        }),
      });
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/app/team");
    await expect(
      page.getByRole("heading", { name: "Invite your winery team" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("link", { name: "Team" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.keyboard.press("Escape");
    await page.getByLabel("Work email").fill("INVITED@EXAMPLE.COM");
    await page.getByLabel("Role").selectOption("manager");
    await page.getByRole("button", { name: "Send invitation" }).click();

    expect(invitationBody).toEqual({
      email: "invited@example.com",
      role: "manager",
    });
    await expect(
      page.getByText(
        "Invitation sent to invited@example.com. The secure link expires in 24 hours.",
      ),
    ).toBeVisible();
    await expect(page.getByLabel("Work email")).toHaveValue("");
    const touchTargets = await page
      .locator("#team-invite-email, #team-invite-role, button[type='submit']")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { height: bounds.height, width: bounds.width };
        }),
      );
    expect(touchTargets).toHaveLength(3);
    expect(
      touchTargets.filter(({ height, width }) => height < 44 || width < 44),
    ).toEqual([]);
    await assertA11y(page);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("team-invitation-mobile.png"),
    });
  });

  test("admin can send a role-scoped staff invitation", async ({ page }) => {
    const adminSession = {
      ...staffSession,
      user: {
        ...staffSession.user,
        email: "admin@example.com",
        role: "admin",
      },
    };
    let invitationBody: Record<string, unknown> | undefined;
    await page.route("**/api/auth/staff/session", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: adminSession }),
      }),
    );
    await page.route("**/api/brands", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: { canViewAllBrands: false, items: [] },
        }),
      }),
    );
    await page.route("**/api/staff/invitations", async (route) => {
      invitationBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: { expiresAt: "2026-07-27T00:00:00.000Z" },
        }),
      });
    });

    await page.goto("/app/team");
    await page.getByLabel("Work email").fill("new-admin@example.com");
    await page.getByLabel("Role").selectOption("admin");
    const sendButton = page.getByRole("button", { name: "Send invitation" });
    await sendButton.focus();
    await expect(sendButton).toBeFocused();
    await sendButton.press("Enter");
    expect(invitationBody).toEqual({
      email: "new-admin@example.com",
      role: "admin",
    });
    await assertA11y(page);
  });

  for (const role of ["manager", "staff"] as const) {
    test(`${role} cannot discover or use staff invitation controls`, async ({ page }) => {
      const restrictedRoleSession = {
        ...staffSession,
        user: {
          ...staffSession.user,
          email: `${role}@example.com`,
          role,
        },
      };
      let invitationRequested = false;
      await page.route("**/api/auth/staff/session", (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ data: restrictedRoleSession }),
        }),
      );
      await page.route("**/api/brands", (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            data: { canViewAllBrands: false, items: [] },
          }),
        }),
      );
      await page.route("**/api/staff/invitations", (route) => {
        invitationRequested = true;
        return route.fulfill({ status: 403 });
      });

      await page.goto("/app/team");
      await expect(
        page.getByRole("heading", { name: "Team administration is restricted" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Team" })).not.toBeVisible();
      await expect(page.getByLabel("Work email")).not.toBeVisible();
      expect(invitationRequested).toBe(false);
      await assertA11y(page);
    });
  }

  test("member session renders only the real empty portal shell", async ({ page }) => {
    await page.route("**/api/auth/member/session", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: memberSession }),
      }),
    );
    await page.route("**/api/member/shipments", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      }),
    );
    await page.goto("/portal");
    await expect(page.getByRole("heading", { name: "Welcome, Avery" })).toBeVisible();
    await expect(page.getByText("No upcoming shipment")).toBeVisible();
    await expect(page.getByText("No shipment history")).toBeVisible();
    await assertA11y(page);
  });
});

test.describe("Phase 1 security and performance gates", () => {
  test("Worker responses carry restrictive security headers", async ({ request }) => {
    const response = await request.get("/app/login");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
  });

  test("client stores no credentials or API keys in browser storage", async ({ page }) => {
    await page.goto("/app/login");
    const storage = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
      source: document.documentElement.innerHTML,
    }));
    expect(storage.local).toEqual([]);
    expect(storage.session).toEqual([]);
    expect(storage.source).not.toMatch(/(?:sk|rk)_(?:test|live)_/);
    expect(storage.source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  test("login stays within LCP, CLS, and initial JavaScript budgets", async ({ page }) => {
    await page.addInitScript(() => {
      const metrics = { cls: 0, lcp: 0 };
      Object.defineProperty(window, "__viniferaMetrics", { value: metrics });
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
    await page.goto("/app/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.waitForTimeout(100);
    const result = await page.evaluate(() => {
      const metrics = (
        window as typeof window & {
          __viniferaMetrics: { cls: number; lcp: number };
        }
      ).__viniferaMetrics;
      const scripts = performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.endsWith(".js")) as PerformanceResourceTiming[];
      return {
        ...metrics,
        javascriptTransferBytes: scripts.reduce(
          (total, entry) => total + entry.transferSize,
          0,
        ),
        synchronousScripts: Array.from(document.scripts).filter(
          (script) => !script.async && !script.defer && script.type !== "module",
        ).length,
      };
    });
    expect(result.lcp).toBeGreaterThan(0);
    expect(result.lcp).toBeLessThan(2_500);
    expect(result.cls).toBeLessThan(0.1);
    expect(result.javascriptTransferBytes).toBeLessThan(200 * 1024);
    expect(result.synchronousScripts).toBe(0);
  });

  test("all effective mobile touch targets meet 44 by 44 pixels", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/app/signup");
    const undersized = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          "a,button,input,select,textarea,[role='button']",
        ),
      );
      return candidates
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.visibility !== "hidden" && style.display !== "none";
        })
        .map((element) => {
          const target =
            element instanceof HTMLInputElement &&
            ["checkbox", "radio"].includes(element.type) &&
            element.closest("label")
              ? (element.closest("label") as HTMLElement)
              : element;
          const rect = target.getBoundingClientRect();
          return {
            height: rect.height,
            label:
              target.getAttribute("aria-label") ||
              target.textContent?.trim().slice(0, 80) ||
              target.tagName,
            width: rect.width,
          };
        })
        .filter((target) => target.height > 0 && (target.height < 44 || target.width < 44));
    });
    expect(undersized).toEqual([]);
  });
});
