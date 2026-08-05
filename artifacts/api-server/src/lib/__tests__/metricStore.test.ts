import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStoreFixture, type StoreFixture } from "../../__fixtures__/inMemoryStore.js";

let store: StoreFixture;

beforeEach(async () => {
  store = await createStoreFixture();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Move the clock without faking the timers the libSQL driver relies on. */
function advanceSeconds(seconds: number): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.now() + seconds * 1000));
}

describe("TTL expiry", () => {
  it("serves a snapshot up to the last second before expiry and not on it", async () => {
    // expires_at is written as floor(now) + ttl and read back as
    // `expires_at > floor(now)`, so a 60s TTL is fresh for seconds 0..59 and
    // stale from second 60 — one second shorter than the nominal window.
    await store.metricStore.set("m365-ttl", { total: 7 }, 60);

    advanceSeconds(58);
    expect(await store.metricStore.getIfFresh("m365-ttl")).toEqual({ total: 7 });

    advanceSeconds(1);
    expect(await store.metricStore.getIfFresh("m365-ttl")).toEqual({ total: 7 });

    advanceSeconds(1);
    expect(await store.metricStore.getIfFresh("m365-ttl")).toBeNull();
  });

  it("still returns an expired snapshot through getLatest, which the findings engine relies on", async () => {
    await store.metricStore.set("m365-ttl", { total: 7 }, 60);
    advanceSeconds(3600);

    expect(await store.metricStore.getIfFresh("m365-ttl")).toBeNull();
    expect(await store.metricStore.getLatest("m365-ttl")).toEqual({ total: 7 });
  });

  it("expires everything immediately when the store is marked stale", async () => {
    await store.metricStore.set("m365-a", { v: 1 }, 3600);
    await store.metricStore.set("m365-b", { v: 2 }, 3600);

    await store.metricStore.markAllStale();

    expect(await store.metricStore.getIfFresh("m365-a")).toBeNull();
    expect(await store.metricStore.getIfFresh("m365-b")).toBeNull();
    // Stale, not gone: the data is still there for getLatest and for archiving.
    expect(await store.metricStore.getLatest("m365-b")).toEqual({ v: 2 });
  });

  it("gives an errored key a short retry window and hides it from both readers", async () => {
    await store.metricStore.setError("m365-error", "Graph returned 503");

    expect(await store.metricStore.getIfFresh("m365-error")).toBeNull();
    expect(await store.metricStore.getLatest("m365-error")).toBeNull();

    const entry = (await store.metricStore.getAllEntries()).find((e) => e.key === "m365-error");
    expect(entry?.status).toBe("error");
    expect(entry?.errorMsg).toBe("Graph returned 503");
    // 60 seconds, so a failing collector is retried soon rather than after the
    // full one-hour success TTL.
    expect(entry!.expiresAt.getTime() - entry!.fetchedAt.getTime()).toBe(60_000);
  });
});

describe("getOrFetch", () => {
  it("collects on a miss, serves the cache on a hit, and re-collects once the TTL lapses", async () => {
    const collect = vi.fn(async () => ({ total: 1 }));

    expect(await store.metricStore.getOrFetch("m365-fetch", collect, 60)).toEqual({ total: 1 });
    expect(await store.metricStore.getOrFetch("m365-fetch", collect, 60)).toEqual({ total: 1 });
    expect(collect).toHaveBeenCalledTimes(1);

    advanceSeconds(61);
    collect.mockResolvedValueOnce({ total: 2 });
    expect(await store.metricStore.getOrFetch("m365-fetch", collect, 60)).toEqual({ total: 2 });
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight collection between concurrent callers", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const collect = vi.fn(async () => {
      await gate;
      return { total: 1 };
    });

    const calls = [
      store.metricStore.getOrFetch("m365-inflight", collect),
      store.metricStore.getOrFetch("m365-inflight", collect),
      store.metricStore.getOrFetch("m365-inflight", collect),
    ];
    release!();
    expect(await Promise.all(calls)).toEqual([{ total: 1 }, { total: 1 }, { total: 1 }]);
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it("records the failure and rethrows when the collector throws", async () => {
    // Annotated so the always-throwing body does not infer Promise<never> and
    // reject the successful retry staged below.
    const collect = vi.fn(async (): Promise<{ total: number }> => {
      throw new Error("Graph returned 403");
    });

    await expect(store.metricStore.getOrFetch("m365-failing", collect)).rejects.toThrow(
      "Graph returned 403",
    );

    const entry = (await store.metricStore.getAllEntries()).find((e) => e.key === "m365-failing");
    expect(entry?.status).toBe("error");
    expect(entry?.errorMsg).toBe("Graph returned 403");

    // The in-flight entry is cleared, so the next call retries rather than
    // replaying the rejected promise forever.
    collect.mockResolvedValueOnce({ total: 1 });
    expect(await store.metricStore.getOrFetch("m365-failing", collect)).toEqual({ total: 1 });
  });
});

describe("round-trips", () => {
  it("preserves data-source and confidence metadata through a store and read", async () => {
    // Collector payloads carry per-field evidence metadata; it is persisted as
    // part of the JSON blob and must come back byte-identical.
    const payload = {
      secureScorePercent: 62,
      value: { secureScore: 310 },
      metadata: {
        secureScorePercent: {
          evidenceStatus: "apiBacked",
          confidenceLabel: "high",
          sourceLabel: "SecurityEvents.Read.All",
          notes: ["Derived from secure score current/max"],
        },
        legacyAuthSignInCount: {
          evidenceStatus: "notAssessed",
          confidenceLabel: "unknown",
          sourceLabel: null,
        },
      },
    };

    await store.metricStore.set("m365-security", payload);
    expect(await store.metricStore.getIfFresh("m365-security")).toEqual(payload);
    expect(await store.metricStore.getLatest("m365-security")).toEqual(payload);

    const entry = (await store.metricStore.getAllEntries()).find((e) => e.key === "m365-security");
    expect(JSON.parse(entry!.data)).toEqual(payload);
    expect(entry?.status).toBe("ok");
    expect(entry?.errorMsg).toBeNull();
  });

  it("overwrites an errored key on the next successful collection", async () => {
    await store.metricStore.setError("m365-flaky", "Graph returned 503");
    await store.metricStore.set("m365-flaky", { total: 3 });

    const entries = (await store.metricStore.getAllEntries()).filter((e) => e.key === "m365-flaky");
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("ok");
    expect(entries[0].errorMsg).toBeNull();
    expect(await store.metricStore.getIfFresh("m365-flaky")).toEqual({ total: 3 });
  });

  it("returns null rather than throwing when a stored payload is not valid JSON", async () => {
    await store.metricStore.set("m365-corrupt", { total: 1 });
    await store.client.execute({
      sql: "UPDATE metric_snapshots SET data = ? WHERE key = ?",
      args: ["{not json", "m365-corrupt"],
    });

    expect(await store.metricStore.getIfFresh("m365-corrupt")).toBeNull();
    expect(await store.metricStore.getLatest("m365-corrupt")).toBeNull();
  });
});
