import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const landingPage = readFileSync(
  new URL("../../index.html", import.meta.url),
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
});
