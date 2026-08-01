import { expect, request, test, type APIRequestContext } from "@playwright/test";

const origin = process.env.DEV_RUNTIME_ORIGIN ?? "";
const candidateSha = process.env.CANDIDATE_SHA ?? "";
const credentials = [
  {
    email: process.env.DEV_STAFF_A_EMAIL ?? "",
    password: process.env.DEV_STAFF_A_PASSWORD ?? "",
  },
  {
    email: process.env.DEV_STAFF_B_EMAIL ?? "",
    password: process.env.DEV_STAFF_B_PASSWORD ?? "",
  },
];

test.describe("hosted development runtime", () => {
  test.beforeAll(() => {
    if (!origin) {
      throw new Error("DEV_RUNTIME_ORIGIN is required for hosted development verification.");
    }
    if (!/^[0-9a-f]{40}$/.test(candidateSha)) {
      throw new Error("CANDIDATE_SHA must be an exact 40-character Git SHA.");
    }
    if (credentials.some(({ email, password }) => !email || !password)) {
      throw new Error("Both protected development QA staff credentials are required.");
    }
  });

  test("proves exact health, auth, tenant denial, and member boundary", async () => {
    const publicApi = await request.newContext({ baseURL: origin });
    const health = await publicApi.get("/api/health");
    expect(health.ok()).toBe(true);
    expect(await health.json()).toMatchObject({
      data: {
        environment: "development",
        revision: candidateSha,
        service: "vinifera-api",
        status: "ok",
      },
    });
    const configuration = await publicApi.get("/api/health/configuration");
    expect(configuration.ok()).toBe(true);
    const configurationData = (await configuration.json()).data;
    for (const capability of ["app", "database", "security"]) {
      expect(configurationData[capability]?.configured, capability).toBe(true);
    }
    const memberBoundary = await publicApi.get("/api/auth/member/session");
    expect(memberBoundary.ok()).toBe(true);
    expect(await memberBoundary.json()).toMatchObject({
      data: { authenticated: false },
    });

    const contexts: APIRequestContext[] = [];
    try {
      for (const credential of credentials) {
        const context = await request.newContext({ baseURL: origin });
        contexts.push(context);
        const login = await context.post("/api/auth/staff/login", {
          data: credential,
        });
        expect(login.ok()).toBe(true);
        const session = await context.get("/api/auth/staff/session");
        expect(await session.json()).toMatchObject({
          data: { authenticated: true },
        });
      }
      const members = await contexts[0]!.get("/api/members?limit=1");
      expect(members.ok()).toBe(true);
      const memberId = (await members.json()).data?.items?.[0]?.id;
      expect(memberId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      const crossTenant = await contexts[1]!.get(`/api/members/${memberId}`);
      expect([403, 404]).toContain(crossTenant.status());
    } finally {
      await Promise.all(contexts.map((context) => context.dispose()));
      await publicApi.dispose();
    }
  });

  for (const viewport of [
    { height: 900, name: "desktop", width: 1440 },
    { height: 812, name: "mobile", width: 375 },
  ]) {
    test(`renders the real application without critical console errors at ${viewport.name}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { height: viewport.height, width: viewport.width },
      });
      const page = await context.newPage();
      const critical: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") critical.push(message.text());
      });
      page.on("pageerror", (error) => critical.push(error.message));
      page.on("response", (response) => {
        if (response.status() >= 500) {
          critical.push(`HTTP ${response.status()} ${response.url()}`);
        }
      });
      const response = await page.goto(`${origin}/app/`, {
        waitUntil: "networkidle",
      });
      expect(response?.ok()).toBe(true);
      await expect(page.locator("main")).toBeVisible();
      expect(critical).toEqual([]);
      await context.close();
    });
  }
});
