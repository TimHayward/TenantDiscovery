import { Router } from "express";
import { permissionsManifest } from "@workspace/permissions-manifest";
import { fetchGraphJson } from "../lib/collectionIssues.js";
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

function getRequiredApplicationPermissions(): string[] {
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

function escapeGraphFilterLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

async function getConfiguredApplicationPermissions(
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

router.patch("/onboarding/setup", async (req, res) => {
  try {
    const body = req.body as {
      tenantId?: string | null;
      clientId?: string | null;
      clientSecret?: string | null;
      setupComplete?: boolean;
    };

    const updated = await patchOnboardingSettings({
      tenantId: body.tenantId,
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      setupComplete: body.setupComplete,
    });

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

    const hasMissingRequiredPermissions =
      missingRequiredPermissions.length > 0 || permissionCheckError !== null;

    return res.json({
      targetClientId,
      targetTenantId: settings.tenantId ?? process.env.AZURE_TENANT_ID ?? null,
      targetAppDisplayName: appDisplayName,
      requiredApplicationPermissions: requiredPermissions,
      configuredApplicationPermissions,
      missingRequiredPermissions,
      hasMissingRequiredPermissions,
      permissionCheckError,
      needsOnboarding: hasMissingRequiredPermissions,
      setup: redactOnboardingSettings(settings),
    });
  } catch (error) {
    req.log.error({ error }, "Failed to get onboarding status");
    return res.status(500).json({ error: "Failed to get onboarding status" });
  }
});

export default router;
