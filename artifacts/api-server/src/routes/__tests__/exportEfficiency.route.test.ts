import ExcelJS from "exceljs";
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

const REGISTER = [
  makeFinding("sec.mfa", { severity: "critical", category: "security", title: "MFA not enforced" }),
  makeFinding("sec.legacy", { severity: "high", category: "security", checkStatus: "warning" }),
  makeFinding("id.guest", { severity: "medium", category: "identity" }),
  makeFinding("id.stale", { severity: "low", category: "identity", checkStatus: "pass" }),
];

async function seedRegister(): Promise<void> {
  fixture.setFindings(REGISTER);
  await fixture.metricStore.set("m365-users", { total: 4 });
  await fixture.findingsStore.regenerateFindings();
}

/**
 * Evaluating the rule set is the expensive half of an export: it re-reads every
 * metric snapshot and runs every registered rule. One export request must
 * trigger it exactly once, however many sections of the report depend on it.
 */
describe("an export request evaluates the rule set once", () => {
  const EXPORTS = [
    "/api/m365/export/executive.pdf",
    "/api/m365/export/executive.html",
    "/api/m365/export/findings.xlsx",
    "/api/m365/export/evidence.xlsx",
  ];

  for (const path of EXPORTS) {
    it(`calls evaluateFindings exactly once for ${path}`, async () => {
      await seedRegister();

      const before = fixture.evaluateCalls();
      await request(fixture.app).get(path).responseType("blob").expect(200);

      expect(fixture.evaluateCalls() - before).toBe(1);
    });
  }

  it("does not evaluate at all for the CSV export, which needs no coverage table", async () => {
    await seedRegister();

    const before = fixture.evaluateCalls();
    await request(fixture.app).get("/api/m365/export/findings.csv").expect(200);

    expect(fixture.evaluateCalls() - before).toBe(0);
  });
});

describe("the two workbook routes", () => {
  async function workbookFrom(path: string): Promise<ExcelJS.Workbook> {
    const res = await request(fixture.app).get(path).responseType("blob").expect(200);
    expect(res.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const wb = new ExcelJS.Workbook();
    // supertest hands back a Node Buffer, which is what load wants at runtime;
    // exceljs declares the parameter against a non-generic Buffer, so the
    // assertion reconciles the two declarations rather than changing the value.
    await wb.xlsx.load(res.body as Parameters<typeof wb.xlsx.load>[0]);
    return wb;
  }

  it("both serve a workbook an existing client can open", async () => {
    await seedRegister();

    const findings = await workbookFrom("/api/m365/export/findings.xlsx");
    const evidence = await workbookFrom("/api/m365/export/evidence.xlsx");

    for (const wb of [findings, evidence]) {
      const names = wb.worksheets.map((s) => s.name);
      expect(names).toContain("Summary");
      expect(names).toContain("All Findings");
      // One sheet per category, plus the framework coverage sheet.
      expect(names).toContain("security");
      expect(names).toContain("identity");
      expect(names).toContain("Framework Coverage");

      const all = wb.getWorksheet("All Findings")!;
      expect(all.getRow(1).getCell(1).value).toBe("Severity");
      // Header row plus one row per finding.
      expect(all.rowCount).toBe(REGISTER.length + 1);
      // Sorted most severe first.
      expect(all.getRow(2).getCell(1).value).toBe("critical");
      expect(all.getRow(2).getCell(3).value).toBe("MFA not enforced");
    }
  });

  it("collapsing to one handler left the two URLs with the same content and distinct filenames", async () => {
    await seedRegister();

    const findings = await workbookFrom("/api/m365/export/findings.xlsx");
    const evidence = await workbookFrom("/api/m365/export/evidence.xlsx");

    expect(evidence.worksheets.map((s) => s.name)).toEqual(findings.worksheets.map((s) => s.name));

    const findingsRes = await request(fixture.app)
      .get("/api/m365/export/findings.xlsx")
      .responseType("blob");
    const evidenceRes = await request(fixture.app)
      .get("/api/m365/export/evidence.xlsx")
      .responseType("blob");

    expect(findingsRes.headers["content-disposition"]).toMatch(
      /^attachment; filename="findings-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );
    expect(evidenceRes.headers["content-disposition"]).toMatch(
      /^attachment; filename="evidence-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );
  });

  it("still reports its own failure message per route", async () => {
    await seedRegister();
    await fixture.client.execute("DROP TABLE findings");

    await request(fixture.app)
      .get("/api/m365/export/findings.xlsx")
      .expect(500)
      .expect({ error: "Failed to export findings workbook" });
    await request(fixture.app)
      .get("/api/m365/export/evidence.xlsx")
      .expect(500)
      .expect({ error: "Failed to export evidence workbook" });
  });
});

/**
 * PATCH used to read and sort the whole register to return the one row it had
 * just written. It now fetches that row by fingerprint, which must not change
 * the response by a single byte.
 */
describe("PATCH returns the same body as reading the whole register did", () => {
  it("serialises identically to the row the old full-register scan would have found", async () => {
    await seedRegister();

    const res = await request(fixture.app)
      .patch("/api/m365/findings/sec.mfa")
      .send({ status: "acknowledged", owner: "platform-team", notes: "tracked in CHG-4471" })
      .expect(200);

    // The previous implementation, reproduced exactly: read the register and
    // pick the fingerprint out of it.
    const fromRegister = (await fixture.findingsStore.getFindings()).find(
      (f) => f.fingerprint === "sec.mfa",
    );

    expect(res.body).toEqual(fromRegister);
    expect(JSON.stringify(res.body)).toBe(JSON.stringify(fromRegister));
  });

  it("carries the full row, not a partial one", async () => {
    await seedRegister();

    const res = await request(fixture.app)
      .patch("/api/m365/findings/id.guest")
      .send({ status: "suppressed", dueDate: "2026-01-31T00:00:00.000Z" })
      .expect(200);

    expect(res.body).toMatchObject({
      fingerprint: "id.guest",
      severity: "medium",
      category: "identity",
      status: "suppressed",
      dueDate: "2026-01-31T00:00:00.000Z",
    });
    // Compared after a JSON round trip: serialisation drops keys whose value is
    // undefined, such as an absent metricId, on both sides alike.
    const fromRegister = (await fixture.findingsStore.getFindings()).find(
      (f) => f.fingerprint === "id.guest",
    );
    expect(Object.keys(res.body as object)).toEqual(
      Object.keys(JSON.parse(JSON.stringify(fromRegister)) as object),
    );
  });
});
