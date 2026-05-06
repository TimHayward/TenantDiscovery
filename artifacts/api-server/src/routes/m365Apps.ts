import { Router } from "express";
import { getCached } from "../lib/graphClient.js";
import { withMetadata } from "../lib/metadata.js";

const router = Router();

async function getToken(): Promise<string> {
  const { ClientSecretCredential } = await import("@azure/identity");
  const cred = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID!,
    process.env.AZURE_CLIENT_ID!,
    process.env.AZURE_CLIENT_SECRET!,
    { tokenCachePersistenceOptions: { enabled: false } }
  );
  const token = await cred.getToken("https://graph.microsoft.com/.default");
  return token!.token;
}

async function gfetch(
  url: string,
  token: string,
  extraHeaders?: Record<string, string>
): Promise<{ data: any; ok: boolean; status: number }> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, ...extraHeaders },
  });
  if (!resp.ok) return { data: null, ok: false, status: resp.status };
  return { data: await resp.json(), ok: true, status: resp.status };
}

async function gfetchAllPages(firstUrl: string, token: string): Promise<{ items: any[]; denied: boolean }> {
  const items: any[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const { data, ok, status } = await gfetch(url, token);
    if (!ok) return { items: [], denied: status === 401 || status === 403 };
    if (!data?.value) break;
    items.push(...(data.value as any[]));
    url = (data["@odata.nextLink"] as string) ?? null;
  }
  return { items, denied: false };
}

// High-risk Microsoft Graph permission scopes
const HIGH_RISK_SCOPES = new Set([
  "Directory.ReadWrite.All",
  "Directory.Read.All",
  "User.ReadWrite.All",
  "User.ManageIdentities.All",
  "Group.ReadWrite.All",
  "Mail.ReadWrite",
  "Mail.ReadWrite.Shared",
  "MailboxSettings.ReadWrite",
  "Files.ReadWrite.All",
  "Calendars.ReadWrite",
  "RoleManagement.ReadWrite.Directory",
  "RoleManagement.Read.Directory",
  "Application.ReadWrite.All",
  "Application.ReadWrite.OwnedBy",
  "Policy.ReadWrite.All",
  "Policy.ReadWrite.ConditionalAccess",
  "PrivilegedAccess.ReadWrite.AzureAD",
  "PrivilegedAccess.Read.AzureAD",
  "Sites.FullControl.All",
  "Sites.Manage.All",
  "Sites.ReadWrite.All",
  "Exchange.ManageAsApp",
  "AuditLog.Read.All",
  "Organization.ReadWrite.All",
  "DeviceManagementConfiguration.ReadWrite.All",
]);

const RESOURCE_NAMES: Record<string, string> = {
  "00000003-0000-0000-c000-000000000000": "Microsoft Graph",
  "00000002-0000-0000-c000-000000000000": "Azure AD Graph (Legacy)",
  "00000002-0000-0ff1-ce00-000000000000": "Exchange Online",
  "00000003-0000-0ff1-ce00-000000000000": "SharePoint Online",
};

async function getAppsData() {
  return getCached("m365-apps", async () => {
    const token = await getToken();

    const [appsResult, grantsResult, authPolicyResp, graphSPResp] =
      await Promise.all([
        gfetchAllPages(
          "https://graph.microsoft.com/v1.0/applications" +
            "?$expand=owners($select=id,displayName,accountEnabled)" +
            "&$select=id,appId,displayName,createdDateTime,signInAudience," +
            "requiredResourceAccess,passwordCredentials,keyCredentials,web,spa,publicClient" +
            "&$top=999",
          token
        ),
        gfetchAllPages(
          "https://graph.microsoft.com/v1.0/oauth2PermissionGrants" +
            "?$select=clientId,consentType,principalId,resourceId,scope&$top=999",
          token
        ),
        gfetch("https://graph.microsoft.com/v1.0/policies/authorizationPolicy", token),
        gfetch(
          "https://graph.microsoft.com/v1.0/servicePrincipals" +
            "?$filter=appId eq '00000003-0000-0000-c000-000000000000'" +
            "&$select=id,appId,appRoles,oauth2PermissionScopes",
          token
        ),
      ]);

    if (appsResult.denied) {
      return {
        totalApps: 0,
        appsWithNoOwner: 0,
        appsWithHighRisk: 0,
        appsWithExpiredCredentials: 0,
        appsWithLongLivedSecrets: 0,
        multiTenantApps: 0,
        usersCanRegisterApps: true,
        permissionError: true,
        apps: [],
      };
    }

    const permIdToName = new Map<string, string>();
    const graphSP = graphSPResp.ok ? (graphSPResp.data?.value?.[0] as any) : null;
    if (graphSP) {
      for (const role of (graphSP.appRoles ?? []) as any[]) {
        permIdToName.set(role.id as string, role.value as string);
      }
      for (const scope of (graphSP.oauth2PermissionScopes ?? []) as any[]) {
        permIdToName.set(scope.id as string, scope.value as string);
      }
    }

    const authPolicy = authPolicyResp.ok ? (authPolicyResp.data as any) : null;
    const usersCanRegisterApps =
      authPolicy?.defaultUserRolePermissions?.allowedToCreateApps !== false;

    const now = Date.now();
    const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

    const apps = (appsResult.items as any[]).map((app) => {
      const owners: Array<{ id: string; displayName: string; accountEnabled?: boolean }> =
        (app.owners ?? []).map((o: any) => ({
          id: o.id as string,
          displayName: o.displayName as string,
          accountEnabled: o.accountEnabled as boolean | undefined,
        }));

      const credentials: Array<{
        keyId: string;
        displayName: string | null;
        startDateTime: string | null;
        endDateTime: string | null;
        type: "secret" | "certificate";
        hint: string | null;
      }> = [];
      let hasExpiredCredentials = false;
      let hasLongLivedSecrets = false;

      for (const secret of (app.passwordCredentials ?? []) as any[]) {
        const endDate = secret.endDateTime ? new Date(secret.endDateTime as string).getTime() : null;
        const startDate = secret.startDateTime ? new Date(secret.startDateTime as string).getTime() : null;
        if (endDate !== null && endDate < now) hasExpiredCredentials = true;
        const lifeMs = startDate && endDate ? endDate - startDate : null;
        if (lifeMs !== null && lifeMs > ONE_YEAR_MS) hasLongLivedSecrets = true;
        credentials.push({
          keyId: secret.keyId as string,
          displayName: (secret.displayName as string) ?? null,
          startDateTime: (secret.startDateTime as string) ?? null,
          endDateTime: (secret.endDateTime as string) ?? null,
          type: "secret",
          hint: (secret.hint as string) ?? null,
        });
      }
      for (const cert of (app.keyCredentials ?? []) as any[]) {
        const endDate = cert.endDateTime ? new Date(cert.endDateTime as string).getTime() : null;
        if (endDate !== null && endDate < now) hasExpiredCredentials = true;
        credentials.push({
          keyId: cert.keyId as string,
          displayName: (cert.displayName as string) ?? null,
          startDateTime: (cert.startDateTime as string) ?? null,
          endDateTime: (cert.endDateTime as string) ?? null,
          type: "certificate",
          hint: null,
        });
      }

      const permissions: Array<{
        resourceAppId: string;
        resourceName: string;
        scopes: string[];
        type: "Scope" | "Role";
        isHighRisk: boolean;
      }> = [];
      const highRiskScopesFound: string[] = [];

      for (const resource of (app.requiredResourceAccess ?? []) as any[]) {
        const resourceName = RESOURCE_NAMES[resource.resourceAppId as string] ?? resource.resourceAppId as string;
        const byType: Record<string, string[]> = {};
        for (const access of (resource.resourceAccess ?? []) as any[]) {
          const scopeName = permIdToName.get(access.id as string) ?? (access.id as string);
          const t = access.type as string;
          byType[t] = byType[t] ?? [];
          byType[t].push(scopeName);
          if (HIGH_RISK_SCOPES.has(scopeName)) highRiskScopesFound.push(scopeName);
        }
        for (const t of ["Scope", "Role"] as const) {
          if (byType[t]?.length) {
            permissions.push({
              resourceAppId: resource.resourceAppId as string,
              resourceName,
              scopes: byType[t],
              type: t,
              isHighRisk: byType[t].some((s) => HIGH_RISK_SCOPES.has(s)),
            });
          }
        }
      }

      const hasHighRiskPermissions = highRiskScopesFound.length > 0;

      const redirectUris: string[] = [
        ...((app.web?.redirectUris ?? []) as string[]),
        ...((app.spa?.redirectUris ?? []) as string[]),
        ...((app.publicClient?.redirectUris ?? []) as string[]),
      ];
      const hasWildcardRedirectUris = redirectUris.some(
        (uri) =>
          uri.includes("*") ||
          (uri.startsWith("http://") && !uri.includes("localhost") && !uri.includes("127.0.0.1"))
      );

      const isMultiTenant = (app.signInAudience as string) !== "AzureADMyOrg";
      const hasDisabledOwner = owners.some((o) => o.accountEnabled === false);

      const riskFactors: string[] = [];
      if (owners.length === 0) riskFactors.push("No owners assigned");
      if (hasHighRiskPermissions) {
        const preview = [...new Set(highRiskScopesFound)].slice(0, 3);
        riskFactors.push(
          `High-risk permissions: ${preview.join(", ")}${highRiskScopesFound.length > 3 ? "…" : ""}`
        );
      }
      if (hasLongLivedSecrets) riskFactors.push("Long-lived secrets (>12 months)");
      if (hasExpiredCredentials) riskFactors.push("Expired credentials still present");
      if (isMultiTenant) riskFactors.push("Multi-tenant audience");
      if (hasWildcardRedirectUris) riskFactors.push("Insecure redirect URIs (HTTP/wildcard)");
      if (hasDisabledOwner) riskFactors.push("Owner account is disabled");
      const secretOnly =
        credentials.length > 0 && credentials.every((c) => c.type === "secret");
      if (secretOnly) riskFactors.push("Secrets only — no certificates or federated credentials");

      const riskScore = riskFactors.length;
      const riskLevel: "high" | "medium" | "low" =
        riskScore >= 4 ? "high" : riskScore >= 2 ? "medium" : "low";

      return {
        id: app.id as string,
        appId: app.appId as string,
        displayName: app.displayName as string,
        createdDateTime: (app.createdDateTime as string) ?? null,
        signInAudience: app.signInAudience as string,
        owners,
        credentials,
        hasExpiredCredentials,
        hasLongLivedSecrets,
        permissions,
        hasHighRiskPermissions,
        highRiskScopes: [...new Set(highRiskScopesFound)],
        redirectUris,
        hasWildcardRedirectUris,
        hasTenantWideAdminConsent: false,
        grantedScopes: [],
        riskScore,
        riskLevel,
        riskFactors,
      };
    });

    return {
      totalApps: apps.length,
      appsWithNoOwner: apps.filter((a) => a.owners.length === 0).length,
      appsWithHighRisk: apps.filter((a) => a.riskLevel === "high").length,
      appsWithExpiredCredentials: apps.filter((a) => a.hasExpiredCredentials).length,
      appsWithLongLivedSecrets: apps.filter((a) => a.hasLongLivedSecrets).length,
      multiTenantApps: apps.filter((a) => a.signInAudience !== "AzureADMyOrg").length,
      usersCanRegisterApps,
      permissionError: false,
      apps,
    };
  });
}

router.get("/m365/apps", async (req, res) => {
  try {
    const result = await getAppsData();

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch enterprise apps");
    res.status(500).json({ error: "Failed to fetch enterprise apps" });
  }
});

router.get("/m365/apps/with-metadata", async (req, res) => {
  try {
    const data = await getAppsData();

    const fieldMetadata = {
      totalApps: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Application.Read.All",
      },
      appsWithNoOwner: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Derived from application owners expansion",
      },
      appsWithHighRisk: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "Derived from high-risk scopes and configuration factors",
      },
      appsWithExpiredCredentials: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Application credential expiration dates",
      },
      appsWithLongLivedSecrets: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Application secret lifespan analysis",
      },
      multiTenantApps: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "signInAudience",
      },
      usersCanRegisterApps: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Authorization policy",
      },
      permissionError: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "HTTP status from Graph applications endpoint",
      },
      apps: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Application inventory with owners, credentials, and permissions",
      },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch enterprise apps with metadata");
    res.status(500).json({ error: "Failed to fetch enterprise apps" });
  }
});

export default router;
