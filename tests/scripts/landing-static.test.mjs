import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const landingPage = readFileSync(
  new URL("../../index.html", import.meta.url),
  "utf8",
);
const marketingScript = readFileSync(
  new URL("../../public/marketing.js", import.meta.url),
  "utf8",
);
const workerSecurity = readFileSync(
  new URL("../../server/lib/security.ts", import.meta.url),
  "utf8",
);

function firstRule(selector) {
  return landingPage.match(new RegExp(`\\${selector}\\s*\\{[^}]*\\}`))?.[0];
}

describe("marketing landing page interaction targets", () => {
  test("desktop header links and buttons retain a 44px minimum height", () => {
    const navLinkRule = firstRule(".nav-link");
    const navButtonRule = firstRule(".btn-nav");

    expect(navLinkRule).toContain("min-height: 44px");
    expect(navLinkRule).toContain("display: inline-flex");
    expect(navButtonRule).toContain("min-height: 44px");
    expect(navButtonRule).toContain("display: inline-flex");
  });

  test("trial links fail safely until signup configuration is proven", () => {
    expect(landingPage.match(/<a\b[^>]*data-signup-cta/g)).toHaveLength(6);
    expect(landingPage.match(/href="#pricing" data-signup-cta/g)).toHaveLength(6);
    expect(landingPage).toContain('<script src="/marketing.js"></script>');
    expect(marketingScript).toContain(
      'fetch("/api/health/configuration"',
    );
    expect(marketingScript).toContain(
      "payload?.data?.app?.configured !== true",
    );
    expect(marketingScript).toContain(
      "payload?.data?.database?.configured !== true",
    );
    expect(marketingScript).toContain(
      "payload?.data?.email?.configured !== true",
    );
    expect(marketingScript).toContain(
      'anchor.setAttribute("href", "/app/signup")',
    );
    expect(marketingScript).toContain(
      '"(prefers-reduced-motion: reduce)"',
    );
    expect(marketingScript).toContain(
      'behavior: reducedMotion ? "auto" : "smooth"',
    );
    expect(marketingScript).toContain("if (!reducedMotion)");
  });

  test("Worker CSP permits only the pinned, integrity-checked icon dependency", () => {
    expect(landingPage).toContain(
      'src="https://unpkg.com/lucide@1.27.0/dist/umd/lucide.min.js"',
    );
    expect(landingPage).toContain(
      'integrity="sha384-iGjGimQxA1QCAbLRiSWPFc+KsjPW3kLS/2Cub+yRgYfd4EUEx/dxoJ0MKyEsbjop"',
    );
    expect(landingPage).toContain('crossorigin="anonymous"');
    expect(landingPage).not.toContain("lucide@latest");
    expect(workerSecurity).toContain(
      '"script-src \'self\' https://unpkg.com"',
    );
    expect(workerSecurity).toContain(
      '"style-src \'self\' \'unsafe-inline\'"',
    );
  });
});
