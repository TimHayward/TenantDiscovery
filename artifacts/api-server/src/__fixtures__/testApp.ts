import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import type { Express } from "express";
import { createStoreFixture, type StoreFixture } from "./inMemoryStore.js";

import type { CollectionIssue } from "../lib/collectionIssues.js";

type CollectionIssues = typeof import("../lib/collectionIssues.js");

/** What a stubbed `fetchGraphJson` hands back to the caller. */
export interface GraphJsonResult {
  data: unknown;
  issue: CollectionIssue | null;
}

/** Environment the app reads at request time, restored by `dispose`. */
const OVERRIDDEN_ENV = [
  "ONBOARDING_SETTINGS_DIR",
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
] as const;

export interface AppFixture extends StoreFixture {
  app: Express;
  /** Directory the onboarding settings file is read from and written to. */
  settingsDir: string;
  /** Reply to the next Microsoft Graph call the onboarding route makes. */
  onGraphJson(handler: (url: string) => GraphJsonResult): void;
  dispose(): Promise<void>;
}

/**
 * The Express app from `src/app.ts`, wired to an in-memory store and a stubbed
 * Graph layer, so tests drive the real routing, validation, serialisation and
 * error handling.
 *
 * Graph is stubbed at `fetchGraphJson` — the seam every collector and the
 * onboarding permission check go through — rather than at `fetch`, so the
 * request path under test is the production one. Onboarding settings are
 * redirected to a temporary directory so the operator's real settings file is
 * never read or written.
 */
export async function createAppFixture(): Promise<AppFixture> {
  let graphHandler: (url: string) => GraphJsonResult = () => ({
    data: null,
    issue: {
      source: "test",
      category: "unknown",
      status: null,
      message: "No Graph response was staged for this test.",
      retryable: false,
      permissionRequired: false,
    },
  });

  vi.doMock("../lib/collectionIssues.js", async () => ({
    ...(await vi.importActual<CollectionIssues>("../lib/collectionIssues.js")),
    fetchGraphJson: vi.fn(async (url: string) => graphHandler(url)),
  }));

  const store = await createStoreFixture();

  const previousEnv = Object.fromEntries(
    OVERRIDDEN_ENV.map((key) => [key, process.env[key]]),
  ) as Record<(typeof OVERRIDDEN_ENV)[number], string | undefined>;

  const settingsDir = await fs.mkdtemp(path.join(os.tmpdir(), "tenent-discovery-onboarding-"));
  process.env.ONBOARDING_SETTINGS_DIR = settingsDir;
  // Ambient Azure credentials would otherwise decide what the onboarding
  // status route reports, making the result depend on the developer's shell.
  delete process.env.AZURE_TENANT_ID;
  delete process.env.AZURE_CLIENT_ID;
  delete process.env.AZURE_CLIENT_SECRET;

  const { default: app } = await import("../app.js");

  return {
    ...store,
    app,
    settingsDir,
    onGraphJson(handler) {
      graphHandler = handler;
    },
    async dispose() {
      for (const key of OVERRIDDEN_ENV) {
        const value = previousEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await fs.rm(settingsDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
