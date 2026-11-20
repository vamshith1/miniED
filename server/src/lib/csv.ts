// Builds a CSV file (RFC 4180) that opens safely in Excel and Google Sheets.

// A cell starting with = + - @ (or a tab/CR) would run as a formula in a spreadsheet,
// so it gets a leading apostrophe. Plain numbers are left alone.
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header row plus data rows, CRLF line endings, with a BOM so Excel reads UTF-8 (₹, names) correctly. */
export function toCsv(header: string[], rows: unknown[][]) {
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** A filename-safe version of a name, e.g. for "Content-Disposition". */
export const fileSafe = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "report";
