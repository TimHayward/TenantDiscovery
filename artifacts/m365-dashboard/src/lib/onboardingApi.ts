export interface OnboardingSetup {
  tenantId: string | null;
  clientId: string | null;
  clientSecret: string | null;
  hasClientSecret: boolean;
  setupComplete: boolean;
  setupCompletedAt: string | null;
  acknowledgedMissingPermissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingStatus {
  targetClientId: string | null;
  targetTenantId: string | null;
  targetAppDisplayName: string | null;
  requiredApplicationPermissions: string[];
  recommendedApplicationPermissions: string[];
  configuredApplicationPermissions: string[];
  missingRequiredPermissions: string[];
  missingRecommendedPermissions: string[];
  hasMissingRequiredPermissions: boolean;
  allRequiredPermissionsMissing: boolean;
  canContinueWithMissingPermissions: boolean;
  permissionCheckError: string | null;
  permissionCheckSucceeded: boolean;
  needsOnboarding: boolean;
  setup: OnboardingSetup;
}

export interface OnboardingSetupPatch {
  tenantId?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  setupComplete?: boolean;
  acknowledgedMissingPermissions?: string[] | null;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  return requestJson<OnboardingStatus>("/api/onboarding/status");
}

export async function patchOnboardingSetup(
  patch: OnboardingSetupPatch,
): Promise<OnboardingSetup> {
  return requestJson<OnboardingSetup>("/api/onboarding/setup", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
