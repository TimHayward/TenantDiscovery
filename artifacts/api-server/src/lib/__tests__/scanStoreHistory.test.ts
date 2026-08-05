import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStoreFixture, makeFinding, type StoreFixture } from "../../__fixtures__/inMemoryStore.js";

let store: StoreFixture;
const previousLimit = process.env.SCAN_HISTORY_LIMIT;

beforeEach(async () => {
  store = await createStoreFixture();
});

afterEach(() => {
  if (previousLimit === undefined) delete process.env.SCAN_HISTORY_LIMIT;
  else process.env.SCAN_HISTORY_LIMIT = previousLimit;
});

describe("recordScan", () => {
  it("writes the run and every archive row belonging to it", async () => {
    await store.metricStore.set("m365-users", { total: 42 });
    await store.metricStore.set("m365-licenses", { skus: 3 });
    await store.metricStore.setError("m365-intune", "Graph returned 403");
    store.setFindings([
      makeFinding("rule.one", { severity: "critical" }),
      makeFinding("rule.two", { checkStatus: "pass", severity: "low" }),
    ]);

    const startedAt = Date.UTC(2026, 6, 13, 9, 0, 0);
    const id = await store.scanStore.recordScan("manual", startedAt);

    const runs = await store.client.execute("SELECT * FROM scan_runs");
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0].id).toBe(id);
    expect(runs.rows[0].status).toBe("completed");
    expect(runs.rows[0].triggered_by).toBe("manual");
    expect(runs.rows[0].started_at).toBe(Math.floor(startedAt / 1000));
    expect(runs.rows[0].completed_at).not.toBeNull();

    // Every snapshot is archived, errored ones included, with the error text.
    const snaps = await store.client.execute({
      sql: "SELECT key, data, status, error_msg FROM metric_snapshots_history WHERE scan_id = ? ORDER BY key",
      args: [id],
    });
    expect(snaps.rows.map((r) => r.key)).toEqual(["m365-intune", "m365-licenses", "m365-users"]);
    expect(snaps.rows[0].status).toBe("error");
    expect(snaps.rows[0].error_msg).toBe("Graph returned 403");
    expect(JSON.parse(snaps.rows[2].data as string)).toEqual({ total: 42 });

    // Every finding is archived, passes included, so drift can see a pass.
    const hist = await store.client.execute({
      sql: "SELECT fingerprint, severity, check_status FROM findings_history WHERE scan_id = ? ORDER BY fingerprint",
      args: [id],
    });
    expect(hist.rows.map((r) => r.fingerprint)).toEqual(["rule.one", "rule.two"]);
    expect(hist.rows[0].severity).toBe("critical");
    expect(hist.rows[1].check_status).toBe("pass");
  });

  it("marks the run failed and leaves no findings archive when regeneration throws", async () => {
    store.setFindings([makeFinding("rule.broken", { title: null as unknown as string })]);

    await expect(store.scanStore.recordScan("failing")).rejects.toThrow();

    const runs = await store.scanStore.listScans();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].completedAt).not.toBeNull();
    expect(runs[0].findingCount).toBe(0);
  });
});

describe("SCAN_HISTORY_LIMIT pruning", () => {
  it("removes the oldest scans and keeps the newest at the configured limit", async () => {
    process.env.SCAN_HISTORY_LIMIT = "3";
    await store.metricStore.set("m365-users", { total: 1 });
    store.setFindings([makeFinding("rule.kept")]);

    const base = Date.UTC(2026, 6, 13, 9, 0, 0);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push(await store.scanStore.recordScan(`scan-${i}`, base + i * 60_000));
    }

    const remaining = await store.scanStore.listScans();
    // Newest first, and exactly the last three survive.
    expect(remaining.map((s) => s.id)).toEqual([ids[4], ids[3], ids[2]]);

    // The pruned runs take their archives with them.
    for (const pruned of [ids[0], ids[1]]) {
      expect(await store.scanStore.getScan(pruned)).toBeNull();
      const orphans = await store.client.execute({
        sql: `SELECT (SELECT COUNT(*) FROM findings_history WHERE scan_id = ?1) AS findings,
                     (SELECT COUNT(*) FROM metric_snapshots_history WHERE scan_id = ?1) AS snapshots`,
        args: [pruned],
      });
      expect(Number(orphans.rows[0].findings)).toBe(0);
      expect(Number(orphans.rows[0].snapshots)).toBe(0);
    }

    // The newest scan still has its archive intact.
    const newest = await store.scanStore.getScan(ids[4]);
    expect(newest!.findings.map((f) => f.fingerprint)).toEqual(["rule.kept"]);
    expect(newest!.snapshotKeys).toEqual(["m365-users"]);
  });

  it("falls back to the default limit when the environment value is not a positive number", async () => {
    process.env.SCAN_HISTORY_LIMIT = "not-a-number";
    store.setFindings([makeFinding("rule.kept")]);

    const base = Date.UTC(2026, 6, 13, 9, 0, 0);
    for (let i = 0; i < 3; i += 1) {
      await store.scanStore.recordScan(`scan-${i}`, base + i * 60_000);
    }

    // Default limit is 50, so nothing is pruned at three scans.
    expect(await store.scanStore.listScans()).toHaveLength(3);
  });
});

describe("reading a scan back", () => {
  it("returns what was written, with the summary-level fields the archive does not carry left blank", async () => {
    await store.metricStore.set("m365-users", { total: 42 });
    store.setFindings([
      makeFinding("rule.detail", {
        category: "identity",
        title: "Standing global administrator",
        severity: "critical",
        checkStatus: "fail",
        description: "carried on the live register only",
        remediation: "carried on the live register only",
      }),
    ]);
    const id = await store.scanStore.recordScan("read-back");
    await store.findingsStore.updateFindingState("rule.detail", { status: "acknowledged", owner: "tim" });

    const scan = await store.scanStore.getScan(id);
    expect(scan).not.toBeNull();
    expect(scan!.id).toBe(id);
    expect(scan!.triggeredBy).toBe("read-back");
    expect(scan!.findingCount).toBe(1);
    expect(scan!.snapshotKeys).toEqual(["m365-users"]);
    expect(scan!.findings).toEqual([
      {
        fingerprint: "rule.detail",
        ruleId: "rule.detail",
        category: "identity",
        title: "Standing global administrator",
        severity: "critical",
        checkStatus: "fail",
      },
    ]);

    // findings_history stores no description, lifecycle or timestamps, so an
    // archived export reads those columns back as empty strings rather than
    // borrowing the current live values.
    const rows = await store.exportModel.getFindingRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("critical");
    expect(rows[0].title).toBe("Standing global administrator");
    expect(rows[0]).toMatchObject({
      description: "",
      status: "",
      owner: "",
      dueDate: "",
      evidenceStatus: "",
      confidenceLabel: "",
      source: "",
      remediation: "",
      notes: "",
      firstSeen: "",
      lastSeen: "",
    });

    // The live register, by contrast, still carries all of it.
    const live = await store.exportModel.getFindingRows();
    expect(live[0].description).toBe("carried on the live register only");
    expect(live[0].status).toBe("acknowledged");
    expect(live[0].owner).toBe("tim");
  });

  it("returns null for an unknown scan id and an empty export for it", async () => {
    expect(await store.scanStore.getScan("no-such-scan")).toBeNull();
    expect(await store.exportModel.getFindingRows("no-such-scan")).toEqual([]);
  });
});

describe("drift between two scans", () => {
  it("matches computeDrift for the same pair, whether the ids are given or defaulted", async () => {
    await store.metricStore.set("m365-users", { total: 1 });

    store.setFindings([
      makeFinding("drift.unchanged"),
      makeFinding("drift.escalates", { severity: "medium" }),
      makeFinding("drift.disappears"),
      makeFinding("drift.fixed"),
    ]);
    const base = Date.UTC(2026, 6, 13, 9, 0, 0);
    const fromId = await store.scanStore.recordScan("drift-from", base);

    store.setFindings([
      makeFinding("drift.unchanged"),
      makeFinding("drift.escalates", { severity: "critical" }),
      makeFinding("drift.fixed", { checkStatus: "pass" }),
      makeFinding("drift.appears"),
    ]);
    const toId = await store.scanStore.recordScan("drift-to", base + 60_000);

    const drift = await store.scanStore.computeDrift(fromId, toId);
    expect(drift.fromScanId).toBe(fromId);
    expect(drift.toScanId).toBe(toId);
    expect(drift.added.map((e) => e.fingerprint)).toEqual(["drift.appears"]);
    expect(drift.resolved.map((e) => e.fingerprint).sort()).toEqual([
      "drift.disappears",
      "drift.fixed",
    ]);
    // A control that moves to pass counts as both resolved and changed: the
    // classifications are not mutually exclusive, and the dashboard shows the
    // three lists side by side rather than as a partition.
    expect(drift.changed.map((e) => e.fingerprint).sort()).toEqual([
      "drift.escalates",
      "drift.fixed",
    ]);
    const escalated = drift.changed.find((e) => e.fingerprint === "drift.escalates")!;
    expect(escalated.previousSeverity).toBe("medium");
    expect(escalated.severity).toBe("critical");
    expect(escalated.previousCheckStatus).toBe("fail");

    // The default pair is "the two most recent scans", which is this pair.
    expect(await store.scanStore.computeDrift()).toEqual(drift);
  });

  it("reports no drift when there is only one scan to compare against", async () => {
    store.setFindings([makeFinding("drift.only")]);
    await store.scanStore.recordScan("solo");

    const drift = await store.scanStore.computeDrift();
    expect(drift.fromScanId).toBeNull();
    expect(drift).toMatchObject({ added: [], resolved: [], changed: [] });
  });

  it("does not report a newly-passing control as added", async () => {
    const base = Date.UTC(2026, 6, 13, 9, 0, 0);
    store.setFindings([makeFinding("drift.seed")]);
    await store.scanStore.recordScan("drift-from", base);

    store.setFindings([
      makeFinding("drift.seed"),
      makeFinding("drift.newPass", { checkStatus: "pass" }),
    ]);
    await store.scanStore.recordScan("drift-to", base + 60_000);

    const drift = await store.scanStore.computeDrift();
    expect(drift.added).toEqual([]);
    expect(drift.resolved).toEqual([]);
  });
});
