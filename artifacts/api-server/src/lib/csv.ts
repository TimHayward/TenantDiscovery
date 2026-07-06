/**
 * RFC 4180-aware CSV parsing for Microsoft Graph usage reports.
 *
 * Graph report CSVs quote fields, and display names / UPNs routinely contain
 * commas, so a naive `split(",")` shifts columns and corrupts every downstream
 * metric. This parser handles quoted fields, embedded commas, escaped quotes
 * (`""`), and both LF and CRLF line endings.
 */

/** Parse CSV text into rows of raw string cells. */
export function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false; // whether the current row has any content/fields yet

  // Strip a leading UTF-8 BOM if present.
  let i = csv.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endField = () => {
    row.push(field);
    field = "";
    started = true;
  };
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
    started = false;
  };

  while (i < csv.length) {
    const ch = csv[i];

    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      started = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    started = true;
    i += 1;
  }

  // Flush a trailing field/row that wasn't terminated by a newline.
  if (started || field.length > 0) {
    endRow();
  }

  return rows;
}

/**
 * Parse CSV text into objects keyed by the header row. Header and cell values
 * are trimmed to match the whitespace-insensitive comparisons callers rely on.
 */
export function parseCsv(csv: string): Record<string, string>[] {
  const rows = parseCsvRows(csv);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? "").trim();
    });
    return obj;
  });
}
