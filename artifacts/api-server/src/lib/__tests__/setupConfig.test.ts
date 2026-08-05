import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SECRET_REDACTED,
  loadOnboardingSettings,
  patchOnboardingSettings,
  redactOnboardingSettings,
} from "../setupConfig";

const previousSettingsPath = process.env.ONBOARDING_SETTINGS_PATH;

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
