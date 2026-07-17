// Cells starting with these characters are interpreted as formulas by Excel
// and similar spreadsheet tools when the CSV is opened — a crafted display
// name like `=HYPERLINK(...)` would otherwise execute on open.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Prefix a value with `'` if it would otherwise be interpreted as a spreadsheet formula. */
export function sanitizeCsvCell(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

/** Serialize an array of records to CSV using the given ordered columns. */
export function toCsv(
  columns: Array<{ key: string; header: string }>,
  rows: Array<Record<string, unknown>>,
): string {
  const escape = (value: unknown): string => {
    if (value == null) return "";
    const s = sanitizeCsvCell(String(value));
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => escape(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => escape(row[c.key])).join(","));
  return [head, ...body].join("\r\n");
}
