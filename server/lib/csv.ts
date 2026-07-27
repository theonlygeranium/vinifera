const SPREADSHEET_FORMULA_PREFIX =
  /^[\u0000-\u0020\u007f\u00a0\ufeff]*[=+\-@]/u;
const LEADING_CONTROL_CHARACTER = /^[\u0000-\u001f\u007f]/u;

/**
 * Returns a cell that is safe to open in common spreadsheet applications.
 *
 * Quoting a CSV field does not prevent formula execution. Prefix suspicious
 * values with an apostrophe before RFC 4180 quoting so leading whitespace,
 * tabs, and line breaks cannot disguise a spreadsheet formula.
 */
export function encodeCsvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (
    SPREADSHEET_FORMULA_PREFIX.test(text) ||
    LEADING_CONTROL_CHARACTER.test(text)
  ) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

export function encodeCsvRows(
  rows: Array<Record<string, unknown>>,
  options: { byteOrderMark?: boolean } = {},
): string {
  const prefix = options.byteOrderMark === false ? "" : "\uFEFF";
  const headers = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row))),
  );
  if (!headers.length) return prefix;
  return `${prefix}${[
    headers.map(encodeCsvCell).join(","),
    ...rows.map((row) =>
      headers.map((header) => encodeCsvCell(row[header])).join(","),
    ),
  ].join("\r\n")}\r\n`;
}
