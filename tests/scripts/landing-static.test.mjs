import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
const pagesHeaders = readFileSync(
  new URL("../../public/_headers", import.meta.url),
  "utf8",
);
const investorGuide = readFileSync(
  new URL("../../guide", import.meta.url),
  "utf8",
);
const prototypeApp = readFileSync(
  new URL("../../app", import.meta.url),
  "utf8",
);
const lucideBundle = readFileSync(
  new URL("../../public/lucide.min.js", import.meta.url),
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
    expect(marketingScript).toContain("decodeURIComponent(href.slice(1))");
    expect(marketingScript).toContain(
      "document.getElementById(decodeURIComponent(href.slice(1)))",
    );
    expect(marketingScript).toContain('history.pushState(null, "", href)');
    expect(marketingScript).not.toContain("document.querySelector(href)");
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

  test("serves the pinned Lucide bundle from the first-party origin", () => {
    for (const document of [landingPage, investorGuide, prototypeApp]) {
      expect(document).toContain('src="/lucide.min.js"');
      expect(document).not.toContain("unpkg.com/lucide");
    }
    expect(
      createHash("sha384").update(lucideBundle).digest("hex"),
    ).toBe(
      "8868c68a643103540201b2d189258f15cf8ab233d6de42d2ff60ae6fec918187dde04504c7f771a09d0c2b212c6e3a29",
    );
    expect(workerSecurity).toContain('"script-src \'self\'"');
    expect(workerSecurity).not.toContain("unpkg.com");
    expect(pagesHeaders).not.toContain("unpkg.com");
    expect(workerSecurity).toContain(
      '"style-src \'self\' \'unsafe-inline\'"',
    );
  });
});
