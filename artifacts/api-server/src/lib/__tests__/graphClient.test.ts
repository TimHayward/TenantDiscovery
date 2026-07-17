import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getGraphClient, hashCredentials } from "../graphClient";

const previousSettingsPath = process.env.ONBOARDING_SETTINGS_PATH;
const previousTenantId = process.env.AZURE_TENANT_ID;
const previousClientId = process.env.AZURE_CLIENT_ID;
const previousClientSecret = process.env.AZURE_CLIENT_SECRET;

async function withIsolatedCredentials(
  credentials: { tenantId: string; clientId: string; clientSecret: string },
  testFn: () => Promise<void>,
) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tenant-graphclient-test-"));
  process.env.ONBOARDING_SETTINGS_PATH = path.join(tempRoot, "onboarding-settings.json");
  process.env.AZURE_TENANT_ID = credentials.tenantId;
  process.env.AZURE_CLIENT_ID = credentials.clientId;
  process.env.AZURE_CLIENT_SECRET = credentials.clientSecret;

  try {
    await testFn();
  } finally {
    process.env.ONBOARDING_SETTINGS_PATH = previousSettingsPath;
    process.env.AZURE_TENANT_ID = previousTenantId;
    process.env.AZURE_CLIENT_ID = previousClientId;
    process.env.AZURE_CLIENT_SECRET = previousClientSecret;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

afterEach(() => {
  process.env.ONBOARDING_SETTINGS_PATH = previousSettingsPath;
  process.env.AZURE_TENANT_ID = previousTenantId;
  process.env.AZURE_CLIENT_ID = previousClientId;
  process.env.AZURE_CLIENT_SECRET = previousClientSecret;
});

describe("hashCredentials", () => {
  it("produces a stable sha256 hex digest that never contains the raw secret", () => {
    const credentials = { tenantId: "tenant-a", clientId: "client-a", clientSecret: "super-secret-value" };
    const key = hashCredentials(credentials);

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("super-secret-value");
    expect(hashCredentials(credentials)).toBe(key);
  });

  it("produces a different digest when the secret changes", () => {
    const base = { tenantId: "tenant-a", clientId: "client-a", clientSecret: "secret-1" };
    const changed = { ...base, clientSecret: "secret-2" };

    expect(hashCredentials(base)).not.toBe(hashCredentials(changed));
  });
});

describe("getGraphClient caching", () => {
  it("reuses the cached client for unchanged credentials", async () => {
    await withIsolatedCredentials(
      { tenantId: "tenant-a", clientId: "client-a", clientSecret: "secret-1" },
      async () => {
        const first = await getGraphClient();
        const second = await getGraphClient();
        expect(second).toBe(first);
      },
    );
  });

  it("invalidates the cache when the secret changes", async () => {
    await withIsolatedCredentials(
      { tenantId: "tenant-a", clientId: "client-a", clientSecret: "secret-1" },
      async () => {
        const first = await getGraphClient();
        process.env.AZURE_CLIENT_SECRET = "secret-2";
        const second = await getGraphClient();
        expect(second).not.toBe(first);
      },
    );
  });
});
