import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Finding } from "../findings/types";

// Isolated on-disk libSQL database per test file (see findingsStore.test.ts).
const dbPath = path.join(os.tmpdir(), `scan-store-test-${process.pid}-${Date.now()}.db`);
process.env.METRIC_DB_PATH = dbPath;

vi.mock("../findings/engine.js", () => ({
  evaluateFindings: vi.fn(async () => currentFindings),
}));

import { getClient, set } from "../metricStore.js";
import { computeDrift, getScan, listScans, recordScan } from "../scanStore.js";

let currentFindings: Finding[] = [];

function finding(fingerprint: string, overrides: Partial<Finding> = {}): Finding {
  return {
    fingerprint,
    ruleId: fingerprint.split(":")[0],
    category: "security",
    title: `Finding ${fingerprint}`,
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
  // Something to archive into metric_snapshots_history.
  await set("m365-test-snapshot", { hello: "world" });
});

afterAll(async () => {
  await fs.rm(dbPath, { force: true }).catch(() => undefined);
});

describe("recordScan / listScans / getScan", () => {
  it("archives snapshots and findings under a completed scan run", async () => {
    currentFindings = [finding("rule.one"), finding("rule.two", { checkStatus: "pass" })];
    const id = await recordScan("test");

    const scans = await listScans();
    const run = scans.find((s) => s.id === id);
    expect(run).toBeDefined();
    expect(run!.status).toBe("completed");
    expect(run!.triggeredBy).toBe("test");
    expect(run!.findingCount).toBe(2);

    const detail = await getScan(id);
    expect(detail).not.toBeNull();
    expect(detail!.snapshotKeys).toContain("m365-test-snapshot");
    expect(detail!.findings.map((f) => f.fingerprint).sort()).toEqual(["rule.one", "rule.two"]);
  });

  it("returns null for an unknown scan id", async () => {
    expect(await getScan("does-not-exist")).toBeNull();
  });

  it("marks the run failed when regeneration throws", async () => {
    const { evaluateFindings } = await import("../findings/engine.js");
    vi.mocked(evaluateFindings).mockRejectedValueOnce(new Error("collector exploded"));

    await expect(recordScan("test-fail")).rejects.toThrow("collector exploded");
    const failed = (await listScans()).find((s) => s.triggeredBy === "test-fail");
    expect(failed?.status).toBe("failed");
  });
});

describe("computeDrift", () => {
  it("classifies added, resolved, and changed findings between two scans", async () => {
    currentFindings = [
      finding("drift.stays", { severity: "medium" }),
      finding("drift.resolves"),
      finding("drift.passes"),
    ];
    const fromId = await recordScan("drift-from", Date.now() - 60_000);

    currentFindings = [
      finding("drift.stays", { severity: "critical" }), // severity change
      finding("drift.passes", { checkStatus: "pass" }), // fail -> pass = resolved
      finding("drift.appears"), // new actionable = added
      // drift.resolves dropped entirely = resolved
    ];
    const toId = await recordScan("drift-to");

    const drift = await computeDrift(fromId, toId);
    expect(drift.fromScanId).toBe(fromId);
    expect(drift.toScanId).toBe(toId);
    expect(drift.added.map((e) => e.fingerprint)).toEqual(["drift.appears"]);
    expect(drift.resolved.map((e) => e.fingerprint).sort()).toEqual(["drift.passes", "drift.resolves"]);
    const changed = drift.changed.find((e) => e.fingerprint === "drift.stays");
    expect(changed?.previousSeverity).toBe("medium");
    expect(changed?.severity).toBe("critical");
  });

  it("defaults to the two most recent scans and handles missing history", async () => {
    const drift = await computeDrift();
    // Scans exist from earlier tests, so defaults resolve to real ids.
    expect(drift.toScanId).not.toBeNull();
    expect(drift.fromScanId).not.toBeNull();

    const empty = await computeDrift("missing-from", "missing-to");
    expect(empty.added).toEqual([]);
    expect(empty.resolved).toEqual([]);
    expect(empty.changed).toEqual([]);
  });
});

describe("pruneOldScans", () => {
  it("keeps only the most recent SCAN_HISTORY_LIMIT scans and deletes their archives", async () => {
    const prevLimit = process.env.SCAN_HISTORY_LIMIT;
    process.env.SCAN_HISTORY_LIMIT = "2";
    try {
      currentFindings = [finding("prune.rule")];
      // Newest scans in the file, so the limit-2 prune keeps the last two of these.
      const base = Date.now() + 10 * 60_000;
      const first = await recordScan("prune-1", base);
      await recordScan("prune-2", base + 60_000);
      await recordScan("prune-3", base + 120_000);

      const scans = await listScans();
      expect(scans).toHaveLength(2);
      expect(scans.map((s) => s.id)).not.toContain(first);

      // Archived rows for the pruned scan are gone too.
      const client = await getClient();
      const hist = await client.execute({
        sql: "SELECT COUNT(*) AS n FROM findings_history WHERE scan_id = ?",
        args: [first],
      });
      expect(Number(hist.rows[0].n)).toBe(0);
      const snaps = await client.execute({
        sql: "SELECT COUNT(*) AS n FROM metric_snapshots_history WHERE scan_id = ?",
        args: [first],
      });
      expect(Number(snaps.rows[0].n)).toBe(0);
    } finally {
      if (prevLimit === undefined) delete process.env.SCAN_HISTORY_LIMIT;
      else process.env.SCAN_HISTORY_LIMIT = prevLimit;
    }
  });
});
