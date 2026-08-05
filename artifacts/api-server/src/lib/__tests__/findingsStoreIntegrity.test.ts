import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStoreFixture, makeFinding, type StoreFixture } from "../../__fixtures__/inMemoryStore.js";
import type { Finding } from "../findings/types.js";

let store: StoreFixture;

beforeEach(async () => {
  // A brand-new module graph per test, so the single-flight guard and the
  // snapshot signature never leak from one case into the next.
  store = await createStoreFixture();
});

/**
 * A finding the schema will reject. `findings.title` is NOT NULL, so this fails
 * on insert and is the least invasive way to make a regeneration blow up part of
 * the way through without touching the store itself.
 */
function unwritableFinding(fingerprint: string): Finding {
  return makeFinding(fingerprint, { title: null as unknown as string });
}

describe("regenerateFindings atomicity", () => {
  it("leaves the register untouched when a write fails part-way through", async () => {
    store.setFindings([
      makeFinding("rule.keep", { severity: "high" }),
      makeFinding("rule.drop"),
    ]);
    await store.findingsStore.regenerateFindings();

    const before = await store.findingsStore.getFindings();
    expect(before.map((f) => f.fingerprint).sort()).toEqual(["rule.drop", "rule.keep"]);

    // The second run raises rule.keep to critical, drops rule.drop, and adds a
    // row the schema rejects. The upserts and the prune share one transaction,
    // so none of the three may take effect.
    store.setFindings([
      makeFinding("rule.keep", { severity: "critical" }),
      unwritableFinding("rule.broken"),
    ]);
    await expect(store.findingsStore.regenerateFindings()).rejects.toThrow();

    const after = await store.findingsStore.getFindings();
    expect(after.map((f) => f.fingerprint).sort()).toEqual(["rule.drop", "rule.keep"]);
    expect(after.find((f) => f.fingerprint === "rule.keep")!.severity).toBe("high");
    expect(after.some((f) => f.fingerprint === "rule.broken")).toBe(false);
    expect(after.map((f) => f.lastSeen)).toEqual(before.map((f) => f.lastSeen));
  });

  it("does not advance the snapshot signature after a failed run, so the next read retries", async () => {
    await store.metricStore.set("m365-atomicity", { v: 1 });
    store.setFindings([unwritableFinding("rule.broken")]);
    await expect(store.findingsStore.ensureFindingsCurrent()).rejects.toThrow();
    const callsAfterFailure = store.evaluateCalls();

    // Nothing new was collected, but the failed run must not be remembered as
    // current: a stale signature would leave the register permanently empty.
    store.setFindings([makeFinding("rule.ok")]);
    await store.findingsStore.ensureFindingsCurrent();
    expect(store.evaluateCalls()).toBe(callsAfterFailure + 1);
    expect((await store.findingsStore.getFindings()).map((f) => f.fingerprint)).toEqual(["rule.ok"]);
  });

  it("clears the single-flight guard after a failure so a later call is not stuck on it", async () => {
    store.setFindings([unwritableFinding("rule.broken")]);
    await expect(store.findingsStore.regenerateFindings()).rejects.toThrow();

    store.setFindings([makeFinding("rule.ok")]);
    await expect(store.findingsStore.regenerateFindings()).resolves.toHaveLength(1);
  });
});

describe("ensureFindingsCurrent signature gating", () => {
  it("skips regeneration when the snapshots are unchanged and runs it when they are not", async () => {
    store.setFindings([makeFinding("rule.gate")]);

    await store.metricStore.set("m365-gate", { v: 1 });
    await store.findingsStore.ensureFindingsCurrent();
    const afterFirst = store.evaluateCalls();
    expect(afterFirst).toBe(1);

    // Same inputs: no work at all, however many times it is called.
    await store.findingsStore.ensureFindingsCurrent();
    await store.findingsStore.ensureFindingsCurrent();
    expect(store.evaluateCalls()).toBe(afterFirst);

    // A new key changes the row count in the signature.
    await store.metricStore.set("m365-gate-2", { v: 1 });
    await store.findingsStore.ensureFindingsCurrent();
    expect(store.evaluateCalls()).toBe(afterFirst + 1);

    // Re-collecting an existing key changes only the newest fetched_at, which
    // the signature also covers. fetched_at has second granularity, so move the
    // clock rather than waiting for it. Only Date is faked, so the libSQL
    // driver's own timers keep running.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.now() + 60_000));
      await store.metricStore.set("m365-gate", { v: 2 });
      await store.findingsStore.ensureFindingsCurrent();
    } finally {
      vi.useRealTimers();
    }
    expect(store.evaluateCalls()).toBe(afterFirst + 2);
  });

  it("ignores errored snapshots, which do not represent new data to assess", async () => {
    store.setFindings([makeFinding("rule.gate")]);
    await store.metricStore.set("m365-gate", { v: 1 });
    await store.findingsStore.ensureFindingsCurrent();
    const afterFirst = store.evaluateCalls();

    await store.metricStore.setError("m365-broken", "Graph returned 503");
    await store.findingsStore.ensureFindingsCurrent();
    expect(store.evaluateCalls()).toBe(afterFirst);
  });
});

describe("auto-close", () => {
  it("closes a finding that disappears between runs without deleting its history", async () => {
    store.setFindings([makeFinding("rule.transient"), makeFinding("rule.persistent")]);
    await store.metricStore.set("m365-autoclose", { v: 1 });
    const firstScan = await store.scanStore.recordScan("run-one");

    await store.findingsStore.updateFindingState("rule.transient", {
      status: "acknowledged",
      owner: "tim",
      notes: "raised with the tenant admin",
    });

    store.setFindings([makeFinding("rule.persistent")]);
    const secondScan = await store.scanStore.recordScan("run-two");

    // Closed, not deleted: the lifecycle row survives with its owner and notes.
    const state = await store.client.execute({
      sql: "SELECT status, owner, notes FROM finding_state WHERE fingerprint = ?",
      args: ["rule.transient"],
    });
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].status).toBe("remediated");
    expect(state.rows[0].owner).toBe("tim");
    expect(state.rows[0].notes).toBe("raised with the tenant admin");

    // The live register no longer carries it, but both scans still do.
    const live = await store.findingsStore.getFindings();
    expect(live.map((f) => f.fingerprint)).toEqual(["rule.persistent"]);
    const first = await store.scanStore.getScan(firstScan);
    expect(first!.findings.map((f) => f.fingerprint).sort()).toEqual([
      "rule.persistent",
      "rule.transient",
    ]);
    const second = await store.scanStore.getScan(secondScan);
    expect(second!.findings.map((f) => f.fingerprint)).toEqual(["rule.persistent"]);
  });

  it("leaves a suppressed finding suppressed rather than reopening it as remediated", async () => {
    store.setFindings([makeFinding("rule.noise")]);
    await store.findingsStore.regenerateFindings();
    await store.findingsStore.updateFindingState("rule.noise", { status: "suppressed" });

    await store.findingsStore.autoCloseResolved(["rule.other"]);

    const state = await store.client.execute({
      sql: "SELECT status FROM finding_state WHERE fingerprint = ?",
      args: ["rule.noise"],
    });
    expect(state.rows[0].status).toBe("suppressed");
  });

  it("closes nothing when the active set is empty, since that means no data rather than all clear", async () => {
    store.setFindings([makeFinding("rule.open")]);
    await store.findingsStore.regenerateFindings();
    await store.findingsStore.updateFindingState("rule.open", { status: "acknowledged" });

    await store.findingsStore.autoCloseResolved([]);

    const state = await store.client.execute({
      sql: "SELECT status FROM finding_state WHERE fingerprint = ?",
      args: ["rule.open"],
    });
    expect(state.rows[0].status).toBe("acknowledged");
  });
});

describe("manual lifecycle state across regeneration", () => {
  it("keeps owner, notes, due date and status when the finding is regenerated", async () => {
    store.setFindings([makeFinding("rule.owned")]);
    await store.findingsStore.regenerateFindings();
    await store.findingsStore.updateFindingState("rule.owned", {
      status: "acknowledged",
      owner: "tim",
      notes: "accepted until the migration completes",
      dueDate: "2026-09-30T00:00:00Z",
    });

    // Same fingerprint, different rule output: an upsert, not a rewrite.
    store.setFindings([makeFinding("rule.owned", { severity: "critical", description: "worse now" })]);
    await store.findingsStore.regenerateFindings();

    const row = (await store.findingsStore.getFindings())[0];
    expect(row.severity).toBe("critical");
    expect(row.description).toBe("worse now");
    expect(row.status).toBe("acknowledged");
    expect(row.owner).toBe("tim");
    expect(row.stateNotes).toBe("accepted until the migration completes");
    expect(row.dueDate).toBe("2026-09-30T00:00:00.000Z");
  });
});

describe("evidence round-trip", () => {
  it("returns structured evidence as it was written", async () => {
    const evidence = { skuId: "sku-1", available: 12, labels: ["ünïcode", "🚀"] };
    store.setFindings([makeFinding("rule.evidence", { evidence })]);
    await store.findingsStore.regenerateFindings();
    expect((await store.findingsStore.getFindings())[0].evidence).toEqual(evidence);
  });

  it("degrades to undefined rather than throwing when stored evidence is not valid JSON", async () => {
    store.setFindings([makeFinding("rule.evidence")]);
    await store.findingsStore.regenerateFindings();
    await store.client.execute({
      sql: "UPDATE findings SET evidence = ? WHERE fingerprint = ?",
      args: ["{not json", "rule.evidence"],
    });
    expect((await store.findingsStore.getFindings())[0].evidence).toBeUndefined();
  });
});
