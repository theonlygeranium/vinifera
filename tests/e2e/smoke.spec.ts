import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const organizationId = "10000000-0000-4000-8000-000000000001";
const brandId = "11000000-0000-4000-8000-000000000001";

function json(route: Route, data: unknown) {
  return route.fulfill({
    body: JSON.stringify({ data }),
    contentType: "application/json",
  });
}

async function installStaffSmokeApi(page: Page) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path === "/api/auth/staff/session") {
      return json(route, {
        access: { graceEndsAt: null, state: "active", suspendedAt: null },
        authenticated: true,
        organization: {
          accessState: "active",
          id: organizationId,
          name: "Smoke Winery",
          planTier: "vine",
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          subscriptionStatus: "not_started",
        },
        user: {
          email: "owner@example.com",
          fullName: "Smoke Owner",
          id: "20000000-0000-4000-8000-000000000001",
          role: "owner",
        },
      });
    }

    if (path === "/api/brands") {
      return json(route, {
        canViewAllBrands: false,
        items: [
          {
            billingMode: "shared",
            customDomain: null,
            description: null,
            domainStatus: "unconfigured",
            fontFamily: null,
            id: brandId,
            isDefault: true,
            logoUrl: null,
            name: "Smoke Winery",
            primaryColor: null,
            secondaryColor: null,
          },
        ],
      });
    }

    if (path === "/api/organization/overview") {
      return json(route, {
        activeMembers: 1,
        brandCount: 1,
        brands: [],
        monthlyRecurringRevenueCents: 14900,
        shipmentsThisPeriod: 0,
      });
    }

    if (path === "/api/club-tiers") {
      return json(route, []);
    }

    if (path === "/api/members") {
      return json(route, {
        items: [],
        page: 1,
        pageSize: 0,
        total: 0,
      });
    }

    return json(route, {});
  });
}

async function assertBasicAccessibility(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test.describe("development fast-lane browser smoke", () => {
  test("boots the staff application and follows primary navigation", async ({
    page,
  }) => {
    await installStaffSmokeApi(page);
    await page.goto("/app");

    await expect(
      page.getByRole("heading", { name: "Welcome to Smoke Winery" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Members", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/members$/);
    await expect(
      page.getByRole("heading", { name: "Members", exact: true }),
    ).toBeVisible();
    await assertBasicAccessibility(page);
  });

  test("boots the public surface and navigates to a primary section", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: /Your wine club deserves software that works as hard as/i,
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Open menu" }).click();
    await page
      .locator("#mobileMenu")
      .getByRole("link", { name: "Features", exact: true })
      .click();
    await expect(page).toHaveURL(/#features$/);
    await expect(page.locator("#features")).toBeVisible();
    await assertBasicAccessibility(page);
  });
});
