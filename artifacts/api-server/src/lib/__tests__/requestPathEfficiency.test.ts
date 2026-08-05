import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InStatement } from "@libsql/client";
import { createStoreFixture, makeFinding, type StoreFixture } from "../../__fixtures__/inMemoryStore.js";

let fixture: StoreFixture;

/** Every statement the store sent through `execute`, in order. */
let executed: Array<{ sql: string; args: unknown; rowCount: number }>;
/** Every batch the store sent, as the list of statements it carried. */
let batched: InStatement[][];

/**
 * Wraps the client so the statements the store issues can be inspected. The
 * stores resolve their client through `getClient()`, which caches one instance,
 * so patching the object the fixture exposes patches the one they use.
 */
function instrument(client: StoreFixture["client"]): void {
  // Spying on an already-spied method would wrap it a second time and count
  // every statement twice, so drop any previous instrumentation first.
  vi.restoreAllMocks();
  executed = [];
  batched = [];

  const realExecute = client.execute.bind(client);
  const realBatch = client.batch.bind(client);

  vi.spyOn(client, "execute").mockImplementation(async (stmt: Parameters<typeof realExecute>[0]) => {
    const result = await realExecute(stmt);
    const sql = typeof stmt === "string" ? stmt : stmt.sql;
    const args = typeof stmt === "string" ? undefined : stmt.args;
    executed.push({ sql, args, rowCount: result.rows.length });
    return result;
  });

  vi.spyOn(client, "batch").mockImplementation(
    async (stmts: Parameters<typeof realBatch>[0], mode?: Parameters<typeof realBatch>[1]) => {
      batched.push([...(stmts as InStatement[])]);
      return realBatch(stmts, mode);
    },
  );
}

function sqlOf(stmt: InStatement): string {
  return typeof stmt === "string" ? stmt : stmt.sql;
}

beforeEach(async () => {
  fixture = await createStoreFixture();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getFindings filters in SQL", () => {
  const REGISTER = [
    makeFinding("sec.a", { severity: "critical", category: "security" }),
    makeFinding("sec.b", { severity: "high", category: "security" }),
    makeFinding("id.c", { severity: "low", category: "identity" }),
    makeFinding("id.d", { severity: "low", category: "identity" }),
    makeFinding("app.e", { severity: "medium", category: "apps" }),
  ];

  beforeEach(async () => {
    fixture.setFindings(REGISTER);
    await fixture.findingsStore.regenerateFindings();
    instrument(fixture.client);
  });

  /**
   * The proof that the filter is in SQL rather than in JavaScript: the statement
   * returns exactly the rows the caller receives. Under the old implementation
   * the statement returned all five rows and the function returned one.
   */
  it("returns as many rows as the statement itself reported, for a severity filter", async () => {
    const rows = await fixture.findingsStore.getFindings({ severity: "low" });

    expect(rows).toHaveLength(2);
    const select = executed.find((e) => e.sql.includes("FROM findings f"));
    expect(select).toBeDefined();
    expect(select!.rowCount).toBe(rows.length);
    expect(select!.rowCount).toBe(2);
    // ...and the register really does hold more than the filter returned, so the
    // agreement above is not a vacuous match on an already-small table.
    const all = await fixture.client.execute("SELECT COUNT(*) AS n FROM findings");
    expect(Number(all.rows[0].n)).toBe(5);
  });

  it("puts severity in the WHERE clause as a bound parameter, not as a literal", async () => {
    await fixture.findingsStore.getFindings({ severity: "critical" });

    const select = executed.find((e) => e.sql.includes("FROM findings f"))!;
    expect(select.sql).toContain("f.severity = ?");
    expect(select.args).toEqual(["critical"]);
    // The value must never be interpolated into the statement text. Only the
    // WHERE clause is examined: the ORDER BY ranks severities by name, so the
    // word "critical" legitimately appears further down the statement.
    const where = select.sql.slice(select.sql.indexOf("WHERE"), select.sql.indexOf("ORDER BY"));
    expect(where).toContain("f.severity = ?");
    expect(where).not.toContain("critical");
  });

  it("filters status and category in SQL too, combining them with AND", async () => {
    await fixture.findingsStore.updateFindingState("sec.a", { status: "acknowledged" });
    instrument(fixture.client);

    const rows = await fixture.findingsStore.getFindings({
      status: "acknowledged",
      category: "security",
    });

    expect(rows.map((r) => r.fingerprint)).toEqual(["sec.a"]);
    const select = executed.find((e) => e.sql.includes("FROM findings f"))!;
    expect(select.sql).toContain("COALESCE(s.status, 'open') = ?");
    expect(select.sql).toContain("f.category = ?");
    expect(select.args).toEqual(["acknowledged", "security"]);
    expect(select.rowCount).toBe(rows.length);
  });

  /**
   * A finding with no `finding_state` row is open by definition. Comparing
   * `s.status` directly across the LEFT JOIN would return nothing here.
   */
  it("treats a never-triaged finding as open when filtering by status", async () => {
    const rows = await fixture.findingsStore.getFindings({ status: "open" });

    expect(rows).toHaveLength(REGISTER.length);
    expect(executed.find((e) => e.sql.includes("FROM findings f"))!.rowCount).toBe(REGISTER.length);
  });

  it("leaves the register unfiltered for an empty category, as it did before", async () => {
    const rows = await fixture.findingsStore.getFindings({ category: "" });

    expect(rows).toHaveLength(REGISTER.length);
    expect(executed.find((e) => e.sql.includes("FROM findings f"))!.sql).not.toContain("f.category = ?");
  });

  it("fetches a single finding by fingerprint without reading the register", async () => {
    const one = await fixture.findingsStore.getFinding("id.c");

    expect(one?.fingerprint).toBe("id.c");
    const select = executed.find((e) => e.sql.includes("FROM findings f"))!;
    expect(select.sql).toContain("f.fingerprint = ?");
    expect(select.args).toEqual(["id.c"]);
    expect(select.rowCount).toBe(1);
  });

  it("returns undefined, not an arbitrary row, for an empty fingerprint", async () => {
    await expect(fixture.findingsStore.getFinding("")).resolves.toBeUndefined();
  });
});

describe("recordScan archives in one batch", () => {
  async function seed(findingCount: number): Promise<void> {
    fixture.setFindings(
      Array.from({ length: findingCount }, (_, i) => makeFinding(`rule.${i}`)),
    );
    await fixture.metricStore.set("m365-users", { total: 1 });
    await fixture.metricStore.set("m365-security", { total: 2 });
  }

  it("issues a single batch carrying every history row, and no per-row execute", async () => {
    const findingCount = 25;
    await seed(findingCount);
    instrument(fixture.client);

    await fixture.scanStore.recordScan("efficiency-test");

    const archiveBatches = batched.filter((stmts) =>
      stmts.some((s) => sqlOf(s).includes("INSERT INTO findings_history")),
    );
    expect(archiveBatches).toHaveLength(1);

    // The one batch carries both snapshot and finding history rows.
    const archive = archiveBatches[0];
    const snapshotInserts = archive.filter((s) =>
      sqlOf(s).includes("INSERT INTO metric_snapshots_history"),
    );
    const findingInserts = archive.filter((s) => sqlOf(s).includes("INSERT INTO findings_history"));
    expect(findingInserts).toHaveLength(findingCount);
    expect(snapshotInserts).toHaveLength(2);
    expect(archive).toHaveLength(findingCount + 2);

    // Nothing was written a row at a time.
    expect(executed.filter((e) => e.sql.includes("INSERT INTO findings_history"))).toHaveLength(0);
    expect(
      executed.filter((e) => e.sql.includes("INSERT INTO metric_snapshots_history")),
    ).toHaveLength(0);
  });

  /**
   * The point of the batch is that cost stops scaling with the size of the
   * register: five findings and fifty must cost the same number of statements.
   */
  it("issues the same number of statements regardless of how many findings there are", async () => {
    await seed(5);
    instrument(fixture.client);
    await fixture.scanStore.recordScan("small");
    const smallExecutes = executed.length;
    const smallBatches = batched.length;

    await fixture.reset();
    await seed(50);
    instrument(fixture.client);
    await fixture.scanStore.recordScan("large");

    expect(executed.length).toBe(smallExecutes);
    expect(batched.length).toBe(smallBatches);
  });

  it("still archives the rows it batched", async () => {
    await seed(12);

    const scanId = await fixture.scanStore.recordScan("persistence-test");
    const scan = await fixture.scanStore.getScan(scanId);

    expect(scan?.findingCount).toBe(12);
    expect(scan?.snapshotKeys).toEqual(["m365-security", "m365-users"]);
  });
});
