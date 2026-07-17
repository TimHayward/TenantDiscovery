// Cells starting with these characters are interpreted as formulas by Excel
// and similar spreadsheet tools when the CSV is opened — a crafted display
// name like `=HYPERLINK(...)` would otherwise execute on open.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Prefix a value with `'` if it would otherwise be interpreted as a spreadsheet formula. */
export function sanitizeCsvCell(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

/** Sanitize every string field of a row before it reaches a CSV export. */
export function sanitizeCsvRow<T extends object>(row: T): T {
  const out = { ...row } as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    const value = out[key];
    if (typeof value === "string") {
      out[key] = sanitizeCsvCell(value);
    }
  }
  return out as T;
}
