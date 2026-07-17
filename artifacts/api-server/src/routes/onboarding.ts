import { Router } from "express";
import { permissionsManifest } from "@workspace/permissions-manifest";
import { PatchOnboardingSetupBody } from "@workspace/api-zod";
import { fetchGraphJson } from "../lib/collectionIssues.js";
import { validate } from "../middlewares/validate.js";
import { triggerAll } from "../lib/backgroundRefresh.js";
import {
  loadOnboardingSettings,
  patchOnboardingSettings,
  redactOnboardingSettings,
} from "../lib/setupConfig.js";

const router = Router();

const GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000";

interface GraphAppRole {
  id: string;
  value?: string;
  isEnabled?: boolean;
}

interface GraphServicePrincipalResponse {
  value?: Array<{
    appRoles?: GraphAppRole[];
  }>;
}

interface AppRequiredAccess {
  id: string;
  type: string;
}

interface AppRegistrationResponse {
  value?: Array<{
    appId: string;
    displayName?: string;
    requiredResourceAccess?: Array<{
      resourceAppId: string;
      resourceAccess?: AppRequiredAccess[];
    }>;
  }>;
}

/**
 * Decide whether the dashboard must route to onboarding.
 *
 * A transient Microsoft Graph failure during the permission check yields an
 * empty configured-permissions list, which makes the missing-permissions list
 * contain every required permission. We must therefore never gate an
 * established tenant on a check that did not actually succeed — otherwise a
 * single 429/timeout bounces the user out of the dashboard mid-session.
 *
 * When some (but not all) required permissions are missing, the operator may
 * acknowledge the gap and proceed with partial data. Onboarding then stays
 * suppressed only while the current missing set is a subset of what was
 * acknowledged: a newly-missing permission — whether a tenant-side regression
 * or a manifest requirement change — falls outside the acknowledged set and
 * re-triggers onboarding. A fully-unconsented app (every required permission
 * missing) always routes to onboarding and cannot be acknowledged through.
 */
export function computeNeedsOnboarding(args: {
  hasClientId: boolean;
  setupComplete: boolean;
  permissionCheckSucceeded: boolean;
  missingPermissions: string[];
  acknowledgedPermissions: string[];
  requiredCount: number;
}): boolean {
  if (!args.hasClientId) return true; // nothing configured yet
  if (!args.permissionCheckSucceeded) {
    // Initial setup gates until a successful check; an established tenant is
    // never bounced on a transient/failed check.
    return !args.setupComplete;
  }
  if (args.missingPermissions.length === 0) return false;
  // A fully-unconsented app has nothing useful to show — always onboard.
  if (args.requiredCount > 0 && args.missingPermissions.length >= args.requiredCount) {
    return true;
  }
  const acknowledged = new Set(args.acknowledgedPermissions);
  const allAcknowledged = args.missingPermissions.every((permission) =>
    acknowledged.has(permission),
  );
  return !allAcknowledged;
}

export function getRequiredApplicationPermissions(): string[] {
  return permissionsManifest.permissions
    .filter(
      (permission) =>
        permission.tier === "required" &&
        permission.provider === "microsoft-graph" &&
        permission.accessKind === "application",
    )
    .map((permission) => permission.name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Recommended (optional-tier) Graph application permissions. Their absence does
 * not block the dashboard, but it empties the sections that depend on them — so
 * we surface them as gaps without gating onboarding on them. Defender/Exchange
 * external scopes are excluded by the accessKind filter and are checked
 * separately, never as Graph app roles.
 */
export function getRecommendedApplicationPermissions(): string[] {
  return permissionsManifest.permissions
    .filter(
      (permission) =>
        permission.tier === "optional" &&
        permission.provider === "microsoft-graph" &&
        permission.accessKind === "application",
    )
    .map((permission) => permission.name)
    .sort((a, b) => a.localeCompare(b));
}

function escapeGraphFilterLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export async function getConfiguredApplicationPermissions(
  clientId: string,
): Promise<{ permissions: string[]; appDisplayName: string | null; permissionCheckError: string | null }> {
  const graphSpResponse = await fetchGraphJson<GraphServicePrincipalResponse>(
    "https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId%20eq%20%2700000003-0000-0000-c000-000000000000%27&$select=appRoles",
    "onboarding:graph-service-principal",
  );

  if (graphSpResponse.issue || !graphSpResponse.data?.value?.length) {
    return {
      permissions: [],
      appDisplayName: null,
      permissionCheckError:
        graphSpResponse.issue?.message ?? "Unable to read Graph app role metadata.",
    };
  }

  const roleIdToName = new Map<string, string>();
  for (const role of graphSpResponse.data.value[0].appRoles ?? []) {
    if (role.isEnabled !== false && role.id && role.value) {
      roleIdToName.set(role.id, role.value);
    }
  }

  const escapedClientId = escapeGraphFilterLiteral(clientId);
  const appResponse = await fetchGraphJson<AppRegistrationResponse>(
    `https://graph.microsoft.com/v1.0/applications?$filter=appId%20eq%20'${escapedClientId}'&$select=appId,displayName,requiredResourceAccess`,
    "onboarding:application-registration",
  );

  if (appResponse.issue) {
    return {
      permissions: [],
      appDisplayName: null,
      permissionCheckError: appResponse.issue.message,
    };
  }

  const app = appResponse.data?.value?.[0];
  if (!app) {
    return {
      permissions: [],
      appDisplayName: null,
      permissionCheckError: "Target application registration was not found in Microsoft Graph.",
    };
  }

  const configuredPermissions = new Set<string>();
  const graphAccess =
    app.requiredResourceAccess?.find((resource) => resource.resourceAppId === GRAPH_APP_ID)
      ?.resourceAccess ?? [];

  for (const access of graphAccess) {
    if (access.type !== "Role") continue;
    const name = roleIdToName.get(access.id);
    if (name) configuredPermissions.add(name);
  }

  return {
    permissions: Array.from(configuredPermissions).sort((a, b) => a.localeCompare(b)),
    appDisplayName: app.displayName ?? null,
    permissionCheckError: null,
  };
}

router.get("/onboarding/setup", async (req, res) => {
  try {
    const settings = await loadOnboardingSettings();
    return res.json(redactOnboardingSettings(settings));
  } catch (error) {
    req.log.error({ error }, "Failed to read onboarding settings");
    return res.status(500).json({ error: "Failed to read onboarding settings" });
  }
});

router.patch("/onboarding/setup", validate({ body: PatchOnboardingSetupBody }), async (req, res) => {
  try {
    const body = req.valid!.body as {
      tenantId?: string | null;
      clientId?: string | null;
      clientSecret?: string | null;
      setupComplete?: boolean;
      acknowledgedMissingPermissions?: string[] | null;
    };

    const updated = await patchOnboardingSettings({
      tenantId: body.tenantId,
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      setupComplete: body.setupComplete,
      acknowledgedMissingPermissions: body.acknowledgedMissingPermissions,
    });

    // Credentials (or the setupComplete gate) may have just gone from
    // unusable to usable — without this, every metric stays cached under its
    // pre-setup "credentials not configured" snapshot for up to the 1h TTL.
    if (
      body.tenantId !== undefined ||
      body.clientId !== undefined ||
      body.clientSecret !== undefined ||
      body.setupComplete !== undefined
    ) {
      triggerAll("onboarding").catch((err) => {
        req.log.warn({ err }, "Post-onboarding refresh failed");
      });
    }

    return res.json(redactOnboardingSettings(updated));
  } catch (error) {
    req.log.error({ error }, "Failed to update onboarding settings");
    return res.status(500).json({ error: "Failed to update onboarding settings" });
  }
});

router.get("/onboarding/status", async (req, res) => {
  try {
    const settings = await loadOnboardingSettings();
    const requiredPermissions = getRequiredApplicationPermissions();
    const recommendedPermissions = getRecommendedApplicationPermissions();

    const targetClientId = settings.clientId ?? process.env.AZURE_CLIENT_ID ?? null;

    let configuredApplicationPermissions: string[] = [];
    let appDisplayName: string | null = null;
    let permissionCheckError: string | null = null;

    if (!targetClientId) {
      permissionCheckError =
        "No client ID is configured. Save a client ID in onboarding settings or set AZURE_CLIENT_ID.";
    } else {
      const configuredPermissionsResult = await getConfiguredApplicationPermissions(targetClientId);
      configuredApplicationPermissions = configuredPermissionsResult.permissions;
      appDisplayName = configuredPermissionsResult.appDisplayName;
      permissionCheckError = configuredPermissionsResult.permissionCheckError;
    }

    const configuredSet = new Set(configuredApplicationPermissions);
    const missingRequiredPermissions = requiredPermissions.filter(
      (permission) => !configuredSet.has(permission),
    );
    // Surfaced as informational gaps only — these never gate onboarding.
    const missingRecommendedPermissions = recommendedPermissions.filter(
      (permission) => !configuredSet.has(permission),
    );

    const permissionCheckSucceeded = permissionCheckError === null;
    const hasMissingRequiredPermissions = missingRequiredPermissions.length > 0;

    const allRequiredPermissionsMissing =
      requiredPermissions.length > 0 &&
      missingRequiredPermissions.length >= requiredPermissions.length;

    // The operator may proceed with partial data only when some — but not all —
    // required permissions are present, and the check actually succeeded.
    const canContinueWithMissingPermissions =
      permissionCheckSucceeded &&
      hasMissingRequiredPermissions &&
      !allRequiredPermissionsMissing;

    const needsOnboarding = computeNeedsOnboarding({
      hasClientId: Boolean(targetClientId),
      setupComplete: settings.setupComplete,
      permissionCheckSucceeded,
      missingPermissions: missingRequiredPermissions,
      acknowledgedPermissions: settings.acknowledgedMissingPermissions,
      requiredCount: requiredPermissions.length,
    });

    return res.json({
      targetClientId,
      targetTenantId: settings.tenantId ?? process.env.AZURE_TENANT_ID ?? null,
      targetAppDisplayName: appDisplayName,
      requiredApplicationPermissions: requiredPermissions,
      recommendedApplicationPermissions: recommendedPermissions,
      configuredApplicationPermissions,
      missingRequiredPermissions,
      missingRecommendedPermissions,
      hasMissingRequiredPermissions,
      allRequiredPermissionsMissing,
      canContinueWithMissingPermissions,
      permissionCheckError,
      permissionCheckSucceeded,
      needsOnboarding,
      setup: redactOnboardingSettings(settings),
    });
  } catch (error) {
    req.log.error({ error }, "Failed to get onboarding status");
    return res.status(500).json({ error: "Failed to get onboarding status" });
  }
});

export default router;
