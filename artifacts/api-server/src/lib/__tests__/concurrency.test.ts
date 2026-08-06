import { afterEach, describe, expect, it } from "vitest";
import {
  getHostConcurrencyLimit,
  resetHostLimiters,
  withHostLimit,
} from "../concurrency.js";

const GRAPH_URL = "https://graph.microsoft.com/v1.0/users";
const DEFENDER_URL = "https://api.security.microsoft.com/api/machines";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Records the greatest number of requests observed running at once, which is
 * what the ceiling is actually about. Asserting only on the final count would
 * pass against a limiter that did nothing at all.
 */
class InFlightRecorder {
  current = 0;
  max = 0;

  enter(): void {
    this.current += 1;
    this.max = Math.max(this.max, this.current);
  }

  leave(): void {
    this.current -= 1;
  }
}

function configure(limits: { graph?: string; defender?: string }): void {
  if (limits.graph === undefined) delete process.env.GRAPH_MAX_CONCURRENCY;
  else process.env.GRAPH_MAX_CONCURRENCY = limits.graph;
  if (limits.defender === undefined) delete process.env.DEFENDER_MAX_CONCURRENCY;
  else process.env.DEFENDER_MAX_CONCURRENCY = limits.defender;
  resetHostLimiters();
}

afterEach(() => {
  delete process.env.GRAPH_MAX_CONCURRENCY;
  delete process.env.DEFENDER_MAX_CONCURRENCY;
  resetHostLimiters();
});

describe("the configured ceiling", () => {
  it("holds a hundred concurrent requests to the observed maximum of eight", async () => {
    configure({ graph: "8" });
    const recorder = new InFlightRecorder();

    await Promise.all(
      Array.from({ length: 100 }, () =>
        withHostLimit(GRAPH_URL, async () => {
          recorder.enter();
          await sleep(2);
          recorder.leave();
        }),
      ),
    );

    // Exactly eight, not "at most eight": the limiter has to keep the host busy
    // as well as keep it bounded.
    expect(recorder.max).toBe(8);
    expect(recorder.current).toBe(0);
  });

  it("defaults to eight when nothing is configured", async () => {
    configure({});
    const recorder = new InFlightRecorder();

    await Promise.all(
      Array.from({ length: 40 }, () =>
        withHostLimit(GRAPH_URL, async () => {
          recorder.enter();
          await sleep(2);
          recorder.leave();
        }),
      ),
    );

    expect(recorder.max).toBe(8);
  });

  it("gives each host its own budget", async () => {
    configure({ graph: "2", defender: "3" });
    const graph = new InFlightRecorder();
    const defender = new InFlightRecorder();

    await Promise.all([
      ...Array.from({ length: 20 }, () =>
        withHostLimit(GRAPH_URL, async () => {
          graph.enter();
          await sleep(2);
          graph.leave();
        }),
      ),
      ...Array.from({ length: 20 }, () =>
        withHostLimit(DEFENDER_URL, async () => {
          defender.enter();
          await sleep(2);
          defender.leave();
        }),
      ),
    ]);

    expect(graph.max).toBe(2);
    expect(defender.max).toBe(3);
  });
});

describe("permit accounting", () => {
  it("releases the permit of a rejected request, so the batch still completes", async () => {
    configure({ graph: "4" });
    const recorder = new InFlightRecorder();
    let bodiesRun = 0;

    // Every other request throws. A limiter that leaked a permit on rejection
    // would run out of them after eight requests and this batch would never
    // settle, which is a worse failure than the throttling being avoided.
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_unused, index) =>
        withHostLimit(GRAPH_URL, async () => {
          recorder.enter();
          await sleep(2);
          recorder.leave();
          bodiesRun += 1;
          if (index % 2 === 0) throw new Error(`request ${index} failed`);
          return index;
        }),
      ),
    );

    expect(bodiesRun).toBe(20);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(10);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(recorder.max).toBe(4);
    expect(recorder.current).toBe(0);
  });

  it("returns every permit after a batch of rejections, not merely enough to make progress", async () => {
    configure({ graph: "4" });

    await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        withHostLimit(GRAPH_URL, async () => {
          await sleep(1);
          throw new Error("upstream refused");
        }),
      ),
    );

    // If any of the twelve permits had leaked, fewer than four requests could
    // overlap here.
    const recorder = new InFlightRecorder();
    await Promise.all(
      Array.from({ length: 8 }, () =>
        withHostLimit(GRAPH_URL, async () => {
          recorder.enter();
          await sleep(2);
          recorder.leave();
        }),
      ),
    );

    expect(recorder.max).toBe(4);
  });

  it("propagates the rejection rather than swallowing it", async () => {
    configure({ graph: "2" });

    await expect(
      withHostLimit(GRAPH_URL, async () => {
        throw new Error("upstream refused");
      }),
    ).rejects.toThrow("upstream refused");
  });
});

describe("reading the ceiling from the environment", () => {
  it("uses the dedicated variable for each known host", () => {
    configure({ graph: "12", defender: "3" });
    expect(getHostConcurrencyLimit("graph.microsoft.com")).toBe(12);
    expect(getHostConcurrencyLimit("api.security.microsoft.com")).toBe(3);
    expect(getHostConcurrencyLimit("api.securitycenter.microsoft.com")).toBe(3);
  });

  it("falls back to eight for a host with no dedicated variable", () => {
    configure({});
    expect(getHostConcurrencyLimit("outlook.office365.com")).toBe(8);
  });

  it("ignores a value that is not a number", () => {
    configure({ graph: "plenty" });
    expect(getHostConcurrencyLimit("graph.microsoft.com")).toBe(8);
  });

  it("clamps zero and negatives to one, because a ceiling of zero would deadlock", () => {
    configure({ graph: "0" });
    expect(getHostConcurrencyLimit("graph.microsoft.com")).toBe(1);
    configure({ graph: "-4" });
    expect(getHostConcurrencyLimit("graph.microsoft.com")).toBe(1);
  });

  it("floors a fractional value", () => {
    configure({ graph: "2.9" });
    expect(getHostConcurrencyLimit("graph.microsoft.com")).toBe(2);
  });

  it("serialises requests when set to one", async () => {
    configure({ graph: "1" });
    const recorder = new InFlightRecorder();

    await Promise.all(
      Array.from({ length: 6 }, () =>
        withHostLimit(GRAPH_URL, async () => {
          recorder.enter();
          await sleep(1);
          recorder.leave();
        }),
      ),
    );

    expect(recorder.max).toBe(1);
  });
});
