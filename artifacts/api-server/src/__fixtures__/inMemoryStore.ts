import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import type { Client, Config } from "@libsql/client";
import type { Finding } from "../lib/findings/types.js";

type MetricStore = typeof import("../lib/metricStore.js");
type FindingsStore = typeof import("../lib/findings/store.js");
type ScanStore = typeof import("../lib/scanStore.js");
type ExportModel = typeof import("../lib/export/model.js");

/** Every table `initClient` creates, ordered so `reset` can empty them all. */
const TABLES = [
  "metric_snapshots",
  "metric_snapshots_history",
  "findings",
  "finding_state",
  "findings_history",
  "scan_runs",
] as const;

export interface StoreFixture {
  client: Client;
  metricStore: MetricStore;
  findingsStore: FindingsStore;
  scanStore: ScanStore;
  exportModel: ExportModel;
  /** Findings the stubbed engine returns on the next regeneration. */
  setFindings(findings: Finding[]): void;
  /** How many times the stubbed engine has been invoked. */
  evaluateCalls(): number;
  /** Empty every table, leaving the schema and module state in place. */
  reset(): Promise<void>;
}

/**
 * A store built on a fresh in-memory libSQL database.
 *
 * The stores resolve their database from `METRIC_DB_PATH` and hand the result to
 * `createClient` as a `file:` URL, so `:memory:` cannot be selected through the
 * environment. Instead `createClient` itself is redirected, which leaves every
 * line of `metricStore`, `findings/store` and `scanStore` running unmodified
 * against a real libSQL client that happens to be in memory.
 *
 * `vi.resetModules()` runs first, so each call yields its own module graph and
 * therefore its own client, single-flight guard and snapshot signature. Consumers
 * must use the modules returned here rather than importing the stores directly:
 * a static import resolves to a different, unmocked instance.
 */
export async function createStoreFixture(): Promise<StoreFixture> {
  let findings: Finding[] = [];
  const evaluateFindings = vi.fn(async () => findings);

  // The store still mkdirs the parent of the resolved path before opening the
  // (redirected) client, so keep that side effect inside the temp directory.
  process.env.METRIC_DB_PATH = path.join(os.tmpdir(), "tenent-discovery-tests", "never-created.db");

  vi.resetModules();

  vi.doMock("@libsql/client", async () => {
    const actual = await vi.importActual<typeof import("@libsql/client")>("@libsql/client");
    return {
      ...actual,
      createClient: (config: Config): Client => actual.createClient({ ...config, url: ":memory:" }),
    };
  });

  // Regeneration is driven by explicit findings rather than by collected
  // snapshots, so store behaviour can be asserted without staging rule inputs.
  vi.doMock("../lib/findings/engine.js", async () => ({
    ...(await vi.importActual<typeof import("../lib/findings/engine.js")>("../lib/findings/engine.js")),
    evaluateFindings,
  }));

  const metricStore = await import("../lib/metricStore.js");
  const findingsStore = await import("../lib/findings/store.js");
  const scanStore = await import("../lib/scanStore.js");
  const exportModel = await import("../lib/export/model.js");
  const client = await metricStore.getClient();

  return {
    client,
    metricStore,
    findingsStore,
    scanStore,
    exportModel,
    setFindings(next) {
      findings = next;
    },
    evaluateCalls: () => evaluateFindings.mock.calls.length,
    async reset() {
      for (const table of TABLES) {
        await client.execute(`DELETE FROM ${table}`);
      }
    },
  };
}

/** A complete Finding with plausible defaults, for tests that only care about a field or two. */
export function makeFinding(fingerprint: string, overrides: Partial<Finding> = {}): Finding {
  return {
    fingerprint,
    ruleId: fingerprint.split(":")[0],
    category: "security",
    title: `Finding ${fingerprint}`,
    description: "fixture finding",
    severity: "high",
    checkStatus: "fail",
    evidenceStatus: "apiBacked",
    confidenceLabel: "high",
    ...overrides,
  };
}
