/** Serialize an array of records to CSV using the given ordered columns. */
export function toCsv(
  columns: Array<{ key: string; header: string }>,
  rows: Array<Record<string, unknown>>,
): string {
  const escape = (value: unknown): string => {
    if (value == null) return "";
    const s = String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => escape(c.header)).join(",");
  const body = rows.map((row) => columns.map((c) => escape(row[c.key])).join(","));
  return [head, ...body].join("\r\n");
}
