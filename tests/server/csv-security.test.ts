import { describe, expect, it } from "vitest";
import { encodeCsvCell, encodeCsvRows } from "../../server/lib/csv";

describe("CSV spreadsheet safety", () => {
  it.each([
    ["formula", "=2+2"],
    ["leading space", "  @SUM(A1:A2)"],
    ["tab", "\t=2+2"],
    ["carriage return", "\r-2+2"],
    ["line feed", "\n+2+2"],
    ["non-breaking space", "\u00a0=2+2"],
    ["byte-order mark", "\uFEFF@SUM(A1:A2)"],
  ])("neutralizes a %s prefix", (_label, value) => {
    expect(encodeCsvCell(value)).toBe(`"'${value}"`);
  });

  it("preserves quotes and embedded line breaks inside an RFC 4180 cell", () => {
    expect(encodeCsvCell('safe "quoted"\nvalue')).toBe(
      '"safe ""quoted""\nvalue"',
    );
  });

  it("emits deterministic headers, a BOM, and CRLF-delimited rows", () => {
    expect(
      encodeCsvRows([
        { first: "A", second: "B" },
        { first: "C", third: "D" },
      ]),
    ).toBe(
      '\uFEFF"first","second","third"\r\n"A","B",""\r\n"C","","D"\r\n',
    );
  });
});
