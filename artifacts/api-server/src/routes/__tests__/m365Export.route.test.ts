import zlib from "node:zlib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createAppFixture, type AppFixture } from "../../__fixtures__/testApp.js";
import { makeFinding } from "../../__fixtures__/inMemoryStore.js";

let fixture: AppFixture;

beforeEach(async () => {
  fixture = await createAppFixture();
});

afterAll(async () => {
  await fixture.dispose();
});

/**
 * Display names that are not representable in WinAnsi. pdf-lib's standard fonts
 * encode to WinAnsi and throw on anything outside it, which is how a tenant with
 * a CJK or emoji display name used to crash the executive PDF export.
 */
const UNICODE_TITLES = [
  "李雷 (Sales) 🚀 holds standing global administrator",
  "Zoë Müller — guest invite older than 90 days",
  "Ελένη Παπαδοπούλου has no MFA method registered",
];

async function seedUnicodeRegister(): Promise<void> {
  fixture.setFindings(
    UNICODE_TITLES.map((title, index) =>
      makeFinding(`identity.unicode.${index}`, {
        title,
        description: `${title} — description carrying the same glyphs`,
        category: "identity",
        severity: index === 0 ? "critical" : "medium",
        remediation: "Remove the standing assignment and use PIM activation instead ✔",
      }),
    ),
  );
  await fixture.metricStore.set("m365-users", { total: 3 });
  await fixture.findingsStore.regenerateFindings();
}

const DATE_STAMP = /^attachment; filename="(findings|executive)-\d{4}-\d{2}-\d{2}\.(csv|pdf)"$/;

/**
 * The drawn text of a PDF, as WinAnsi bytes. pdf-lib flate-compresses its
 * content streams and writes the strings as hex literals, so nothing is legible
 * in the raw response: inflate every stream that will inflate, then decode the
 * hex literals back to text.
 */
function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const parts: string[] = [];
  // "endstream" also ends in "stream", so anchor on the opening keyword only.
  const marker = /(?<!end)stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) continue;
    try {
      parts.push(zlib.inflateSync(pdf.subarray(start, end)).toString("latin1"));
    } catch {
      // Not a flate stream; nothing to read here.
    }
  }
  return parts
    .join("\n")
    .replace(/<([0-9A-Fa-f]+)>/g, (_, hex: string) => Buffer.from(hex, "hex").toString("latin1"));
}

describe("GET /api/m365/export/executive.pdf", () => {
  it("returns a PDF for a register carrying non-WinAnsi display names", async () => {
    await seedUnicodeRegister();

    const res = await request(fixture.app)
      .get("/api/m365/export/executive.pdf")
      .responseType("blob")
      .expect(200);

    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(DATE_STAMP);

    const body = res.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(body.subarray(-6).toString("ascii")).toContain("%%EOF");
    expect(body.byteLength).toBeGreaterThan(1_000);
    expect(Number(res.headers["content-length"])).toBe(body.byteLength);

    // The standard-font PDF is compact, so a byte count alone would not
    // distinguish a real report from a blank one served as a success.
    const drawn = extractPdfText(body);
    expect(drawn).toContain("Total findings: 3");
    expect(drawn).toContain("guest invite older than 90 days");
    // Code points outside WinAnsi are substituted, not thrown on: this is the
    // regression from the crash on CJK and emoji display names.
    expect(drawn).toContain("?? (Sales) ?");
    expect(drawn).not.toContain("Zo? M?ller");
  });

  it("exports an archived scan when scanId is given", async () => {
    await seedUnicodeRegister();
    const scanId = await fixture.scanStore.recordScan("export-test");

    const res = await request(fixture.app)
      .get(`/api/m365/export/executive.pdf?scanId=${scanId}`)
      .responseType("blob")
      .expect(200);

    expect((res.body as Buffer).subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect((res.body as Buffer).byteLength).toBeGreaterThan(1_000);
  });

  it("returns 500 with a fixed message, and no stack, when the model cannot be built", async () => {
    await seedUnicodeRegister();
    await fixture.client.execute("DROP TABLE findings");

    const res = await request(fixture.app).get("/api/m365/export/executive.pdf").expect(500);

    expect(res.body).toEqual({ error: "Failed to export executive PDF" });
    expect(JSON.stringify(res.body)).not.toMatch(/[\\/]src[\\/]|node_modules/);
  });
});

describe("GET /api/m365/export/findings.csv", () => {
  it("returns UTF-8 CSV carrying the same non-WinAnsi names intact", async () => {
    await seedUnicodeRegister();

    const res = await request(fixture.app).get("/api/m365/export/findings.csv").expect(200);

    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toMatch(DATE_STAMP);

    const lines = res.text.trim().split("\n");
    expect(lines[0]).toContain("Severity,Category,Finding,Description");
    expect(lines).toHaveLength(1 + UNICODE_TITLES.length);
    for (const title of UNICODE_TITLES) {
      expect(res.text).toContain(title);
    }
    expect(res.text.length).toBeGreaterThan(500);
  });

  it("returns only the header row when the archived scan does not exist", async () => {
    await seedUnicodeRegister();

    const res = await request(fixture.app)
      .get("/api/m365/export/findings.csv?scanId=no-such-scan")
      .expect(200);

    expect(res.text.trim().split("\n")).toHaveLength(1);
  });
});
