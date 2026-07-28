import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("keyboard focus indicator source contracts", () => {
  it("covers every interactive landing-page control with a three-pixel outline", async () => {
    const source = await readFile(
      new URL("../../index.html", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(
      /:where\(a, button, input, select, textarea, summary, \[tabindex\]\):focus-visible\s*\{[^}]*outline:\s*3px solid/s,
    );
  });

  it("covers focusable application regions with a three-pixel outline", async () => {
    const source = await readFile(
      new URL("../../src/client/styles.css", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(
      /\[tabindex\]:focus-visible\s*\{[^}]*outline:\s*3px solid/s,
    );
    expect(source).toMatch(
      /\[tabindex\]:focus-visible\s*\{[^}]*box-shadow:\s*0 0 0 5px var\(--text\) !important/s,
    );
  });
});
