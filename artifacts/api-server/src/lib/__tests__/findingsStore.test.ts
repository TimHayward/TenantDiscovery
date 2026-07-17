import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Finding } from "../findings/types";

// Isolated on-disk libSQL database per test file (the client cannot open
// ":memory:" through METRIC_DB_PATH because the store resolves it to a file
// path, so a scratch file in tmpdir is the closest equivalent).
const dbPath = path.join(os.tmpdir(), `findings-store-test-${process.pid}-${Date.now()}.db`);
process.env.METRIC_DB_PATH = dbPath;

// Control the engine so regeneration produces exactly the findings each test
// prescribes, independent of collected snapshots and rule content.
vi.mock("../findings/engine.js", () => ({
  evaluateFindings: vi.fn(async () => currentFindings),
}));

import { evaluateFindings } from "../findings/engine.js";
import { getClient, set } from "../metricStore.js";
import {
  autoCloseResolved,
  ensureFindingsCurrent,
  getFindings,
  regenerateFindings,
  updateFindingState,
} from "../findings/store.js";

let currentFindings: Finding[] = [];

function finding(overrides: Partial<Finding> & { fingerprint: string }): Finding {
  return {
    ruleId: overrides.fingerprint.split(":")[0],
    category: "security",
    title: `Finding ${overrides.fingerprint}`,
    description: "test finding",
    severity: "high",
    checkStatus: "fail",
    evidenceStatus: "apiBacked",
    confidenceLabel: "high",
    ...overrides,
  };
}

beforeAll(async () => {
  await getClient();
});

afterAll(async () => {
  await fs.rm(dbPath, { force: true }).catch(() => undefined);
});

beforeEach(async () => {
  const client = await getClient();
  await client.execute("DELETE FROM findings");
  await client.execute("DELETE FROM finding_state");
  vi.mocked(evaluateFindings).mockClear();
});

describe("regenerateFindings", () => {
  it("upserts findings, preserves first_seen across runs, and prunes dropped fingerprints", async () => {
    // Fake only Date so the libsql driver's internal timers keep working.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-07-13T10:00:00Z"));
      currentFindings = [finding({ fingerprint: "rule.a" }), finding({ fingerprint: "rule.b" })];
      await regenerateFindings();

      let rows = await getFindings();
      expect(rows.map((r) => r.fingerprint).sort()).toEqual(["rule.a", "rule.b"]);
      const firstSeenA = rows.find((r) => r.fingerprint === "rule.a")!.firstSeen;

      // Second run an hour later: rule.b disappears, rule.a changes severity.
      vi.setSystemTime(new Date("2026-07-13T11:00:00Z"));
      currentFindings = [finding({ fingerprint: "rule.a", severity: "critical" })];
      await regenerateFindings();

      rows = await getFindings();
      expect(rows.map((r) => r.fingerprint)).toEqual(["rule.a"]);
      const a = rows[0];
      expect(a.severity).toBe("critical");
      expect(a.firstSeen).toBe(firstSeenA); // preserved by the upsert
      expect(new Date(a.lastSeen).getTime()).toBeGreaterThan(new Date(firstSeenA).getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains finding_state rows for pruned findings so lifecycle re-binds on reappearance", async () => {
    currentFindings = [finding({ fingerprint: "rule.transient" })];
    await regenerateFindings();
    await updateFindingState("rule.transient", { status: "acknowledged", owner: "tim" });

    currentFindings = [];
    await regenerateFindings();
    expect(await getFindings()).toHaveLength(0);

    // Reappears: the earlier acknowledgement is still bound to the fingerprint.
    currentFindings = [finding({ fingerprint: "rule.transient" })];
    await regenerateFindings();
    const rows = await getFindings();
    expect(rows[0].status).toBe("acknowledged");
    expect(rows[0].owner).toBe("tim");
  });

  it("shares a single in-flight regeneration between concurrent callers", async () => {
    currentFindings = [finding({ fingerprint: "rule.a" })];
    await Promise.all([regenerateFindings(), regenerateFindings(), regenerateFindings()]);
    expect(vi.mocked(evaluateFindings)).toHaveBeenCalledTimes(1);
  });
});

describe("ensureFindingsCurrent", () => {
  it("regenerates only when the snapshot signature changes", async () => {
    currentFindings = [finding({ fingerprint: "rule.sig" })];

    // New snapshot: signature differs from whatever the last regeneration saw.
    await set(`m365-sig-test-${Date.now()}-1`, { v: 1 });
    await ensureFindingsCurrent();
    const callsAfterFirst = vi.mocked(evaluateFindings).mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // No new collection: the read path must skip regeneration.
    await ensureFindingsCurrent();
    await ensureFindingsCurrent();
    expect(vi.mocked(evaluateFindings)).toHaveBeenCalledTimes(callsAfterFirst);

    // Another collector run (new key changes the row count) re-triggers it.
    await set(`m365-sig-test-${Date.now()}-2`, { v: 2 });
    await ensureFindingsCurrent();
    expect(vi.mocked(evaluateFindings)).toHaveBeenCalledTimes(callsAfterFirst + 1);
  });
});

describe("updateFindingState", () => {
  beforeEach(async () => {
    currentFindings = [finding({ fingerprint: "rule.state" })];
    await regenerateFindings();
  });

  it("returns false for an unknown fingerprint", async () => {
    expect(await updateFindingState("rule.missing", { status: "acknowledged" })).toBe(false);
  });

  it("rejects an invalid status", async () => {
    expect(
      await updateFindingState("rule.state", { status: "nonsense" as never }),
    ).toBe(false);
  });

  it("merges partial updates without clearing untouched fields", async () => {
    await updateFindingState("rule.state", {
      status: "acknowledged",
      owner: "tim",
      notes: "looking into it",
      dueDate: "2026-08-01T00:00:00Z",
    });
    // A later PATCH touching only the owner must keep everything else.
    await updateFindingState("rule.state", { owner: "sam" });

    const row = (await getFindings())[0];
    expect(row.status).toBe("acknowledged");
    expect(row.owner).toBe("sam");
    expect(row.stateNotes).toBe("looking into it");
    expect(row.dueDate).toBe("2026-08-01T00:00:00.000Z");
  });

  it("clears a due date when explicitly set to null", async () => {
    await updateFindingState("rule.state", { dueDate: "2026-08-01T00:00:00Z" });
    await updateFindingState("rule.state", { dueDate: null });
    expect((await getFindings())[0].dueDate).toBeNull();
  });
});

describe("autoCloseResolved", () => {
  it("marks state rows absent from the active set as remediated, sparing suppressed ones", async () => {
    currentFindings = [
      finding({ fingerprint: "rule.active" }),
      finding({ fingerprint: "rule.gone" }),
      finding({ fingerprint: "rule.suppressed" }),
    ];
    await regenerateFindings();
    await updateFindingState("rule.active", { status: "acknowledged" });
    await updateFindingState("rule.gone", { status: "acknowledged" });
    await updateFindingState("rule.suppressed", { status: "suppressed" });

    await autoCloseResolved(["rule.active"]);

    const client = await getClient();
    const states = await client.execute("SELECT fingerprint, status FROM finding_state ORDER BY fingerprint");
    const byFp = Object.fromEntries(states.rows.map((r) => [r.fingerprint as string, r.status as string]));
    expect(byFp["rule.active"]).toBe("acknowledged");
    expect(byFp["rule.gone"]).toBe("remediated");
    expect(byFp["rule.suppressed"]).toBe("suppressed");
  });
});

describe("getFindings filters", () => {
  it("filters by severity, status, and category", async () => {
    currentFindings = [
      finding({ fingerprint: "rule.crit", severity: "critical", category: "identity" }),
      finding({ fingerprint: "rule.low", severity: "low", category: "licensing" }),
    ];
    await regenerateFindings();
    await updateFindingState("rule.low", { status: "acknowledged" });

    expect((await getFindings({ severity: "critical" })).map((r) => r.fingerprint)).toEqual(["rule.crit"]);
    expect((await getFindings({ status: "acknowledged" })).map((r) => r.fingerprint)).toEqual(["rule.low"]);
    expect((await getFindings({ category: "identity" })).map((r) => r.fingerprint)).toEqual(["rule.crit"]);
    expect(await getFindings({ severity: "critical", category: "licensing" })).toHaveLength(0);
  });

  it("orders by severity rank", async () => {
    currentFindings = [
      finding({ fingerprint: "rule.low", severity: "low" }),
      finding({ fingerprint: "rule.crit", severity: "critical" }),
      finding({ fingerprint: "rule.med", severity: "medium" }),
    ];
    await regenerateFindings();
    expect((await getFindings()).map((r) => r.severity)).toEqual(["critical", "medium", "low"]);
  });
});
