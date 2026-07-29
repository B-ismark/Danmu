// CSV writing that a spreadsheet will open correctly and will not execute.
//
// The furniture-list export used to build its own rows with an `esc()` that only
// doubled quotes. That is correct CSV *quoting* and does nothing about *formula*
// injection: Excel, Google Sheets and LibreOffice all evaluate a cell whose first
// character is `=`, and treat `+`, `-`, `@`, a tab or a carriage return the same
// way. Furniture names are user-editable and are also populated from AI photo
// labels, so the content is not a fixed vocabulary — and the export is explicitly
// a shareable artifact (the sibling feature calls it "a printable move-day
// handout"), so the file leaves the machine that wrote it.
//
// It also emitted no BOM and joined with bare `\n`, so a room called "Chambre à
// coucher" arrived mojibaked in Excel on Windows.

/** Characters that make a spreadsheet treat a cell as a formula rather than text. */
const FORMULA_LEAD = new Set(['=', '+', '-', '@', '\t', '\r']);

/** One CSV cell: neutralised against formula injection, then quoted.
 *
 *  The leading apostrophe is the conventional escape — spreadsheets strip it and
 *  show the literal text. It is added only when the value would otherwise be
 *  interpreted, so ordinary names are untouched. */
export function csvCell(value: string | number): string {
  const s = String(value ?? '');
  const safe = s.length > 0 && FORMULA_LEAD.has(s[0]) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Rows of already-typed values → a CSV document. CRLF line endings, per RFC
 *  4180 and what Excel expects. */
export function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** A downloadable CSV blob: UTF-8 with a byte-order mark, so Excel on Windows
 *  does not fall back to the system ANSI codepage. */
export function csvBlob(rows: Array<Array<string | number>>): Blob {
  return new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' });
}
