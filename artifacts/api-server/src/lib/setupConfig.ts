import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hardenFile } from "./fileHardening.js";

export const SECRET_REDACTED = "***REDACTED***";

/**
 * Shown alongside the token the one time it is returned in full. The token is
 * never read back out of the settings file over the API, so an operator who
 * loses it must clear `apiToken` from the settings file and re-save onboarding.
 */
export const API_TOKEN_NOTICE =
  "Copy this token now. It is stored only on the server and will not be shown again.";

export interface OnboardingSettings {
  tenantId: string | null;
  clientId: string | null;
  clientSecret: string | null;
  /**
   * Bearer token for the API, generated on the first onboarding save. Only
   * enforced when the server is bound to a non-loopback address; see
   * `middlewares/apiAuth`.
   */
  apiToken: string | null;
  setupComplete: boolean;
  setupCompletedAt: string | null;
  /**
   * Missing required permissions the operator has explicitly chosen to proceed
   * without. Onboarding stays suppressed only while the current missing set is a
   * subset of this list; any newly-missing permission re-triggers onboarding.
   */
  acknowledgedMissingPermissions: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * The result of a patch, carrying the plaintext API token on the one call that
 * generated it. Deliberately not part of `OnboardingSettings`: it is never
 * written to disk and never survives a reload, so the token can be surfaced
 * exactly once without a later read being able to return it.
 */
export interface PatchedOnboardingSettings extends OnboardingSettings {
  issuedApiToken?: string;
}

export interface RedactedOnboardingSettings
  extends Omit<OnboardingSettings, "clientSecret" | "apiToken"> {
  clientSecret: string | null;
  hasClientSecret: boolean;
  hasApiToken: boolean;
  /** Set only on the response that issued the token. */
  apiToken?: string;
  apiTokenNotice?: string;
}

export interface OnboardingSettingsPatch {
  tenantId?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  setupComplete?: boolean;
  acknowledgedMissingPermissions?: string[] | null;
}

function getDefaultSettings(): OnboardingSettings {
  const now = new Date().toISOString();
  return {
    tenantId: null,
    clientId: null,
    clientSecret: null,
    apiToken: null,
    setupComplete: false,
    setupCompletedAt: null,
    acknowledgedMissingPermissions: [],
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = normalizeString(entry);
    if (normalized) seen.add(normalized);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
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
      apiToken: normalizeString(parsed.apiToken) ?? defaults.apiToken,
      setupComplete: Boolean(parsed.setupComplete),
      setupCompletedAt: normalizeString(parsed.setupCompletedAt) ?? null,
      acknowledgedMissingPermissions: normalizeStringArray(parsed.acknowledgedMissingPermissions),
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

  // The temp file holds the client secret and the API token in cleartext, so it
  // is created owner-only rather than hardened after the fact: on POSIX the
  // mode applies at creation and rename carries it across, leaving no window in
  // which the secret sits on disk world-readable.
  const tempPath = `${settingsPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.rename(tempPath, settingsPath);

  // Windows ignores the mode above, and a file left over from an earlier run
  // keeps its original permissions, so restrict the final path either way.
  await hardenFile(settingsPath);
}

function generateApiToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function patchOnboardingSettings(
  patch: OnboardingSettingsPatch,
): Promise<PatchedOnboardingSettings> {
  const current = await loadOnboardingSettings();
  const now = new Date().toISOString();

  // Issued on the first save so that an operator who later switches the server
  // to a non-loopback bind already has a token, rather than having to reach an
  // endpoint that has just started demanding one.
  const issuedApiToken = current.apiToken ? undefined : generateApiToken();

  const setupComplete =
    patch.setupComplete === undefined ? current.setupComplete : Boolean(patch.setupComplete);

  const nextClientId =
    patch.clientId === undefined ? current.clientId : normalizeString(patch.clientId);
  const clientIdChanged = nextClientId !== current.clientId;

  // Acknowledgements are scoped to the configured app: an explicit patch wins,
  // otherwise pointing at a different client ID invalidates prior acknowledgements.
  const acknowledgedMissingPermissions =
    patch.acknowledgedMissingPermissions !== undefined
      ? normalizeStringArray(patch.acknowledgedMissingPermissions)
      : clientIdChanged
        ? []
        : current.acknowledgedMissingPermissions;

  const next: OnboardingSettings = {
    ...current,
    tenantId:
      patch.tenantId === undefined ? current.tenantId : normalizeString(patch.tenantId),
    clientId: nextClientId,
    clientSecret: mergeSecret(current.clientSecret, patch.clientSecret),
    apiToken: current.apiToken ?? issuedApiToken ?? null,
    setupComplete,
    setupCompletedAt: setupComplete
      ? current.setupCompletedAt ?? now
      : null,
    acknowledgedMissingPermissions,
    updatedAt: now,
  };

  await writeSecureSettingsFile(next);
  return issuedApiToken ? { ...next, issuedApiToken } : next;
}

/**
 * The token the API expects on a non-loopback binding. `API_AUTH_TOKEN` wins so
 * a container can be given one without a settings file having been seeded
 * first; otherwise it is the token generated during onboarding.
 */
export async function getApiAuthToken(): Promise<string | null> {
  const fromEnv = normalizeString(process.env.API_AUTH_TOKEN);
  if (fromEnv) return fromEnv;

  const settings = await loadOnboardingSettings();
  return settings.apiToken;
}

/**
 * Strip both secrets from a settings object before it leaves the API. The
 * stored token is reported only as a boolean; the plaintext appears solely on
 * the patch result that generated it.
 */
export function redactOnboardingSettings(
  settings: PatchedOnboardingSettings,
): RedactedOnboardingSettings {
  const { clientSecret, apiToken, issuedApiToken, ...rest } = settings;

  return {
    ...rest,
    clientSecret: clientSecret ? SECRET_REDACTED : null,
    hasClientSecret: Boolean(clientSecret),
    hasApiToken: Boolean(apiToken),
    ...(issuedApiToken ? { apiToken: issuedApiToken, apiTokenNotice: API_TOKEN_NOTICE } : {}),
  };
}
