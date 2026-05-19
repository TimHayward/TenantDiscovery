import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const SECRET_REDACTED = "***REDACTED***";

export interface OnboardingSettings {
  tenantId: string | null;
  clientId: string | null;
  clientSecret: string | null;
  setupComplete: boolean;
  setupCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RedactedOnboardingSettings
  extends Omit<OnboardingSettings, "clientSecret"> {
  clientSecret: string | null;
  hasClientSecret: boolean;
}

export interface OnboardingSettingsPatch {
  tenantId?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  setupComplete?: boolean;
}

function getDefaultSettings(): OnboardingSettings {
  const now = new Date().toISOString();
  return {
    tenantId: null,
    clientId: null,
    clientSecret: null,
    setupComplete: false,
    setupCompletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getDefaultSettingsPath(): string {
  const winAppData = process.env.APPDATA;
  if (process.platform === "win32" && winAppData) {
    return path.join(winAppData, "TenentDiscovery", "onboarding-settings.json");
  }
  return path.join(os.homedir(), ".config", "tenent-discovery", "onboarding-settings.json");
}

export function getSettingsPath(): string {
  const overridePath = process.env.ONBOARDING_SETTINGS_PATH?.trim();
  if (overridePath) return path.resolve(overridePath);

  const overrideDir = process.env.ONBOARDING_SETTINGS_DIR?.trim();
  if (overrideDir) {
    return path.resolve(overrideDir, "onboarding-settings.json");
  }

  return getDefaultSettingsPath();
}

export async function loadOnboardingSettings(): Promise<OnboardingSettings> {
  const settingsPath = getSettingsPath();
  try {
    const raw = await fs.readFile(settingsPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<OnboardingSettings>;
    const defaults = getDefaultSettings();

    return {
      tenantId: normalizeString(parsed.tenantId) ?? defaults.tenantId,
      clientId: normalizeString(parsed.clientId) ?? defaults.clientId,
      clientSecret: normalizeString(parsed.clientSecret) ?? defaults.clientSecret,
      setupComplete: Boolean(parsed.setupComplete),
      setupCompletedAt: normalizeString(parsed.setupCompletedAt) ?? null,
      createdAt: normalizeString(parsed.createdAt) ?? defaults.createdAt,
      updatedAt: normalizeString(parsed.updatedAt) ?? defaults.updatedAt,
    };
  } catch (error) {
    const ioError = error as NodeJS.ErrnoException;
    if (ioError.code === "ENOENT") {
      return getDefaultSettings();
    }
    throw error;
  }
}

function mergeSecret(current: string | null, incoming: unknown): string | null {
  if (incoming === undefined) return current;
  if (incoming === SECRET_REDACTED) return current;
  return normalizeString(incoming);
}

async function writeSecureSettingsFile(settings: OnboardingSettings): Promise<void> {
  const settingsPath = getSettingsPath();
  const dir = path.dirname(settingsPath);
  await fs.mkdir(dir, { recursive: true });

  const tempPath = `${settingsPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
  await fs.rename(tempPath, settingsPath);

  // Windows ACLs are managed differently; chmod is best-effort on non-Windows.
  if (process.platform !== "win32") {
    await fs.chmod(settingsPath, 0o600);
  }
}

export async function patchOnboardingSettings(
  patch: OnboardingSettingsPatch,
): Promise<OnboardingSettings> {
  const current = await loadOnboardingSettings();
  const now = new Date().toISOString();

  const setupComplete =
    patch.setupComplete === undefined ? current.setupComplete : Boolean(patch.setupComplete);

  const next: OnboardingSettings = {
    ...current,
    tenantId:
      patch.tenantId === undefined ? current.tenantId : normalizeString(patch.tenantId),
    clientId:
      patch.clientId === undefined ? current.clientId : normalizeString(patch.clientId),
    clientSecret: mergeSecret(current.clientSecret, patch.clientSecret),
    setupComplete,
    setupCompletedAt: setupComplete
      ? current.setupCompletedAt ?? now
      : null,
    updatedAt: now,
  };

  await writeSecureSettingsFile(next);
  return next;
}

export function redactOnboardingSettings(
  settings: OnboardingSettings,
): RedactedOnboardingSettings {
  return {
    ...settings,
    clientSecret: settings.clientSecret ? SECRET_REDACTED : null,
    hasClientSecret: Boolean(settings.clientSecret),
  };
}
