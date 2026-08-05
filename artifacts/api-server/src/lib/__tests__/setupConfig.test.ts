import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  API_TOKEN_NOTICE,
  SECRET_REDACTED,
  getApiAuthToken,
  loadOnboardingSettings,
  patchOnboardingSettings,
  redactOnboardingSettings,
} from "../setupConfig";

const previousSettingsPath = process.env.ONBOARDING_SETTINGS_PATH;
const previousApiAuthToken = process.env.API_AUTH_TOKEN;

async function withTempSettingsPath(testFn: (settingsPath: string) => Promise<void>) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tenent-onboarding-test-"));
  const settingsPath = path.join(tempRoot, "onboarding-settings.json");
  process.env.ONBOARDING_SETTINGS_PATH = settingsPath;

  try {
    await testFn(settingsPath);
  } finally {
    process.env.ONBOARDING_SETTINGS_PATH = previousSettingsPath;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

afterEach(() => {
  process.env.ONBOARDING_SETTINGS_PATH = previousSettingsPath;
  process.env.API_AUTH_TOKEN = previousApiAuthToken;
});

describe("setupConfig", () => {
  it("returns defaults when settings file does not exist", async () => {
    await withTempSettingsPath(async () => {
      const settings = await loadOnboardingSettings();
      expect(settings.clientId).toBeNull();
      expect(settings.clientSecret).toBeNull();
      expect(settings.setupComplete).toBe(false);
    });
  });

  it("preserves existing secret when patch receives redaction sentinel", async () => {
    await withTempSettingsPath(async () => {
      await patchOnboardingSettings({
        clientId: "app-client-id",
        clientSecret: "top-secret-value",
        setupComplete: true,
      });

      const updated = await patchOnboardingSettings({
        clientSecret: SECRET_REDACTED,
      });

      expect(updated.clientSecret).toBe("top-secret-value");
      expect(updated.setupComplete).toBe(true);

      const redacted = redactOnboardingSettings(updated);
      expect(redacted.clientSecret).toBe(SECRET_REDACTED);
      expect(redacted.hasClientSecret).toBe(true);
    });
  });

  it("persists acknowledged missing permissions and resets them when the client id changes", async () => {
    await withTempSettingsPath(async () => {
      await patchOnboardingSettings({ clientId: "app-a" });

      const acknowledged = await patchOnboardingSettings({
        acknowledgedMissingPermissions: ["User.Read.All", "Group.Read.All"],
        setupComplete: true,
      });
      expect(acknowledged.acknowledgedMissingPermissions).toEqual([
        "Group.Read.All",
        "User.Read.All",
      ]);

      // Unrelated patch keeps the acknowledgements.
      const kept = await patchOnboardingSettings({ tenantId: "tenant-1" });
      expect(kept.acknowledgedMissingPermissions).toEqual([
        "Group.Read.All",
        "User.Read.All",
      ]);

      // Pointing at a different app invalidates prior acknowledgements.
      const switched = await patchOnboardingSettings({ clientId: "app-b" });
      expect(switched.acknowledgedMissingPermissions).toEqual([]);
    });
  });

  it("round-trips the secret through save and load after the permission change", async () => {
    await withTempSettingsPath(async (settingsPath) => {
      await patchOnboardingSettings({
        tenantId: "tenant-1",
        clientId: "app-client-id",
        clientSecret: "an-awkward secret/with+padding==",
        setupComplete: true,
      });

      const reloaded = await loadOnboardingSettings();
      expect(reloaded.clientSecret).toBe("an-awkward secret/with+padding==");
      expect(reloaded.tenantId).toBe("tenant-1");
      expect(reloaded.setupComplete).toBe(true);

      // Hardening applies to the file the API actually reads back, not to a
      // temp file left behind beside it.
      const onDisk = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
      expect(onDisk.clientSecret).toBe("an-awkward secret/with+padding==");
      await expect(fs.access(`${settingsPath}.tmp`)).rejects.toThrow();
    });
  });

  it("clears existing secret when patch receives an empty value", async () => {
    await withTempSettingsPath(async () => {
      await patchOnboardingSettings({
        clientSecret: "to-be-cleared",
      });

      const updated = await patchOnboardingSettings({
        clientSecret: "",
      });

      expect(updated.clientSecret).toBeNull();
      const redacted = redactOnboardingSettings(updated);
      expect(redacted.clientSecret).toBeNull();
      expect(redacted.hasClientSecret).toBe(false);
    });
  });
});

describe("the API token", () => {
  it("is generated on the first save and persisted", async () => {
    await withTempSettingsPath(async (settingsPath) => {
      const created = await patchOnboardingSettings({ clientId: "app-a" });

      expect(created.issuedApiToken).toBeTypeOf("string");
      expect(created.apiToken).toBe(created.issuedApiToken);

      // 32 random bytes in base64url: 43 characters, no padding, URL-safe.
      expect(created.apiToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const onDisk = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
      expect(onDisk.apiToken).toBe(created.apiToken);
    });
  });

  it("is stable across later saves and is issued only once", async () => {
    await withTempSettingsPath(async () => {
      const first = await patchOnboardingSettings({ clientId: "app-a" });
      const second = await patchOnboardingSettings({ tenantId: "tenant-1" });
      const third = await patchOnboardingSettings({ clientId: "app-b" });

      expect(second.apiToken).toBe(first.apiToken);
      expect(third.apiToken).toBe(first.apiToken);

      // Only the call that generated it may reveal it.
      expect(second.issuedApiToken).toBeUndefined();
      expect(third.issuedApiToken).toBeUndefined();
    });
  });

  it("differs between installations", async () => {
    const tokens = new Set<string>();
    for (let run = 0; run < 3; run += 1) {
      await withTempSettingsPath(async () => {
        const created = await patchOnboardingSettings({ clientId: "app-a" });
        tokens.add(created.apiToken!);
      });
    }
    expect(tokens.size).toBe(3);
  });

  it("survives a reload", async () => {
    await withTempSettingsPath(async () => {
      const created = await patchOnboardingSettings({ clientId: "app-a" });
      const reloaded = await loadOnboardingSettings();

      expect(reloaded.apiToken).toBe(created.apiToken);
    });
  });

  it("is shown once, with its notice, and never again", async () => {
    await withTempSettingsPath(async () => {
      const created = await patchOnboardingSettings({ clientId: "app-a" });
      const shown = redactOnboardingSettings(created);

      expect(shown.apiToken).toBe(created.issuedApiToken);
      expect(shown.apiTokenNotice).toBe(API_TOKEN_NOTICE);
      expect(shown.hasApiToken).toBe(true);

      // Every later read reports only that a token exists.
      const later = redactOnboardingSettings(await patchOnboardingSettings({ tenantId: "t" }));
      expect(later.apiToken).toBeUndefined();
      expect(later.apiTokenNotice).toBeUndefined();
      expect(later.hasApiToken).toBe(true);

      const read = redactOnboardingSettings(await loadOnboardingSettings());
      expect(read.apiToken).toBeUndefined();
      expect(JSON.stringify(read)).not.toContain(created.issuedApiToken!);
    });
  });

  it("keeps both secrets out of anything the API returns", async () => {
    await withTempSettingsPath(async () => {
      await patchOnboardingSettings({ clientId: "app-a", clientSecret: "top-secret-value" });

      const settings = await loadOnboardingSettings();
      const serialised = JSON.stringify(redactOnboardingSettings(settings));

      expect(serialised).not.toContain("top-secret-value");
      expect(serialised).not.toContain(settings.apiToken!);
      expect(serialised).toContain(SECRET_REDACTED);
    });
  });
});

describe("getApiAuthToken", () => {
  it("returns the stored token", async () => {
    await withTempSettingsPath(async () => {
      delete process.env.API_AUTH_TOKEN;
      const created = await patchOnboardingSettings({ clientId: "app-a" });

      await expect(getApiAuthToken()).resolves.toBe(created.apiToken);
    });
  });

  it("prefers API_AUTH_TOKEN, so a container need not be seeded first", async () => {
    await withTempSettingsPath(async () => {
      await patchOnboardingSettings({ clientId: "app-a" });
      process.env.API_AUTH_TOKEN = "  token-from-the-environment  ";

      await expect(getApiAuthToken()).resolves.toBe("token-from-the-environment");
    });
  });

  it("returns null when nothing is configured, so the caller fails closed", async () => {
    await withTempSettingsPath(async () => {
      delete process.env.API_AUTH_TOKEN;

      await expect(getApiAuthToken()).resolves.toBeNull();
    });
  });

  it("ignores an empty API_AUTH_TOKEN rather than treating it as a token", async () => {
    await withTempSettingsPath(async () => {
      process.env.API_AUTH_TOKEN = "   ";

      await expect(getApiAuthToken()).resolves.toBeNull();
    });
  });
});
