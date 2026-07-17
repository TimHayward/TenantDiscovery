import {
  fetchAllGraphPages,
  fetchGraphJson,
  isPermissionIssue,
  type CollectionIssue,
} from "../collectionIssues.js";
import type {
  GraphApplication,
  GraphAuthorizationPolicy,
  GraphOAuthGrant,
  GraphPermissionDefiningSP,
} from "./graphTypes.js";

const HIGH_RISK_SCOPES = new Set([
  "Directory.ReadWrite.All", "Directory.Read.All", "User.ReadWrite.All", "User.ManageIdentities.All",
  "Group.ReadWrite.All", "Mail.ReadWrite", "Mail.ReadWrite.Shared", "MailboxSettings.ReadWrite",
  "Files.ReadWrite.All", "Calendars.ReadWrite", "RoleManagement.ReadWrite.Directory",
  "RoleManagement.Read.Directory", "Application.ReadWrite.All", "Application.ReadWrite.OwnedBy",
  "Policy.ReadWrite.All", "Policy.ReadWrite.ConditionalAccess", "PrivilegedAccess.ReadWrite.AzureAD",
  "PrivilegedAccess.Read.AzureAD", "Sites.FullControl.All", "Sites.Manage.All", "Sites.ReadWrite.All",
  "Exchange.ManageAsApp", "AuditLog.Read.All", "Organization.ReadWrite.All",
  "DeviceManagementConfiguration.ReadWrite.All",
]);

const RESOURCE_NAMES: Record<string, string> = {
  "00000003-0000-0000-c000-000000000000": "Microsoft Graph",
  "00000002-0000-0000-c000-000000000000": "Azure AD Graph (Legacy)",
  "00000002-0000-0ff1-ce00-000000000000": "Exchange Online",
  "00000003-0000-0ff1-ce00-000000000000": "SharePoint Online",
};

export async function collectApps() {
  const collectionIssues: CollectionIssue[] = [];

  const [appsResult, grantsResult, authPolicyResp, graphSPResp] = await Promise.all([
    fetchAllGraphPages<GraphApplication>(
      "https://graph.microsoft.com/v1.0/applications" +
        "?$expand=owners($select=id,displayName,accountEnabled)" +
        "&$select=id,appId,displayName,createdDateTime,signInAudience,requiredResourceAccess,passwordCredentials,keyCredentials,web,spa,publicClient&$top=999",
      "applications",
    ),
    fetchAllGraphPages<GraphOAuthGrant>("https://graph.microsoft.com/v1.0/oauth2PermissionGrants?$select=clientId,consentType,principalId,resourceId,scope&$top=999", "oauth2PermissionGrants"),
    fetchGraphJson<GraphAuthorizationPolicy>("https://graph.microsoft.com/v1.0/policies/authorizationPolicy", "authorizationPolicy"),
    fetchGraphJson<{ value?: GraphPermissionDefiningSP[] }>("https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '00000003-0000-0000-c000-000000000000'&$select=id,appId,appRoles,oauth2PermissionScopes", "graphServicePrincipal"),
  ]);

  collectionIssues.push(...appsResult.issues, ...grantsResult.issues);
  if (authPolicyResp.issue) collectionIssues.push(authPolicyResp.issue);
  if (graphSPResp.issue) collectionIssues.push(graphSPResp.issue);

  if (appsResult.permissionError) {
    return {
      totalApps: 0, appsWithNoOwner: 0, appsWithHighRisk: 0, appsWithExpiredCredentials: 0,
      appsWithLongLivedSecrets: 0, multiTenantApps: 0, usersCanRegisterApps: true,
      permissionError: true, apps: [],
      partialData: true, collectionIssues,
    };
  }

  const permIdToName = new Map<string, string>();
  const graphSP = graphSPResp.data?.value?.[0] ?? null;
  if (graphSP) {
    for (const role of graphSP.appRoles ?? []) {
      if (role.id && role.value) permIdToName.set(role.id, role.value);
    }
    for (const scope of graphSP.oauth2PermissionScopes ?? []) {
      if (scope.id && scope.value) permIdToName.set(scope.id, scope.value);
    }
  }

  const authPolicy = authPolicyResp.data ?? null;
  const usersCanRegisterApps = authPolicy?.defaultUserRolePermissions?.allowedToCreateApps !== false;
  const now = Date.now();
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  const apps = appsResult.items.map((app) => {
    const owners: Array<{ id: string; displayName: string; accountEnabled?: boolean }> =
      (app.owners ?? []).map((o) => ({ id: o.id ?? "", displayName: o.displayName ?? "", accountEnabled: o.accountEnabled }));
    const credentials: Array<{ keyId: string; displayName: string | null; startDateTime: string | null; endDateTime: string | null; type: "secret" | "certificate"; hint: string | null }> = [];
    let hasExpiredCredentials = false, hasLongLivedSecrets = false;

    for (const secret of app.passwordCredentials ?? []) {
      const endDate = secret.endDateTime ? new Date(secret.endDateTime).getTime() : null;
      const startDate = secret.startDateTime ? new Date(secret.startDateTime).getTime() : null;
      if (endDate !== null && endDate < now) hasExpiredCredentials = true;
      const lifeMs = startDate && endDate ? endDate - startDate : null;
      if (lifeMs !== null && lifeMs > ONE_YEAR_MS) hasLongLivedSecrets = true;
      credentials.push({ keyId: secret.keyId ?? "", displayName: secret.displayName ?? null, startDateTime: secret.startDateTime ?? null, endDateTime: secret.endDateTime ?? null, type: "secret", hint: secret.hint ?? null });
    }
    for (const cert of app.keyCredentials ?? []) {
      const endDate = cert.endDateTime ? new Date(cert.endDateTime).getTime() : null;
      if (endDate !== null && endDate < now) hasExpiredCredentials = true;
      credentials.push({ keyId: cert.keyId ?? "", displayName: cert.displayName ?? null, startDateTime: cert.startDateTime ?? null, endDateTime: cert.endDateTime ?? null, type: "certificate", hint: null });
    }

    const permissions: Array<{ resourceAppId: string; resourceName: string; scopes: string[]; type: "Scope" | "Role"; isHighRisk: boolean }> = [];
    const highRiskScopesFound: string[] = [];
    for (const resource of app.requiredResourceAccess ?? []) {
      const resourceAppId = resource.resourceAppId ?? "";
      const resourceName = RESOURCE_NAMES[resourceAppId] ?? resourceAppId;
      const byType: Record<string, string[]> = {};
      for (const access of resource.resourceAccess ?? []) {
        const accessId = access.id ?? "";
        const scopeName = permIdToName.get(accessId) ?? accessId;
        const t = access.type ?? ""; byType[t] = byType[t] ?? []; byType[t].push(scopeName);
        if (HIGH_RISK_SCOPES.has(scopeName)) highRiskScopesFound.push(scopeName);
      }
      for (const t of ["Scope", "Role"] as const) {
        if (byType[t]?.length) permissions.push({ resourceAppId, resourceName, scopes: byType[t], type: t, isHighRisk: byType[t].some((s) => HIGH_RISK_SCOPES.has(s)) });
      }
    }

    const hasHighRiskPermissions = highRiskScopesFound.length > 0;
    const redirectUris: string[] = [...(app.web?.redirectUris ?? []), ...(app.spa?.redirectUris ?? []), ...(app.publicClient?.redirectUris ?? [])];
    const hasWildcardRedirectUris = redirectUris.some((uri) => uri.includes("*") || (uri.startsWith("http://") && !uri.includes("localhost") && !uri.includes("127.0.0.1")));
    const isMultiTenant = app.signInAudience !== "AzureADMyOrg";
    const hasDisabledOwner = owners.some((o) => o.accountEnabled === false);

    const riskFactors: string[] = [];
    if (owners.length === 0) riskFactors.push("No owners assigned");
    if (hasHighRiskPermissions) { const preview = [...new Set(highRiskScopesFound)].slice(0, 3); riskFactors.push(`High-risk permissions: ${preview.join(", ")}${highRiskScopesFound.length > 3 ? "…" : ""}`); }
    if (hasLongLivedSecrets) riskFactors.push("Long-lived secrets (>12 months)");
    if (hasExpiredCredentials) riskFactors.push("Expired credentials still present");
    if (isMultiTenant) riskFactors.push("Multi-tenant audience");
    if (hasWildcardRedirectUris) riskFactors.push("Insecure redirect URIs (HTTP/wildcard)");
    if (hasDisabledOwner) riskFactors.push("Owner account is disabled");
    const secretOnly = credentials.length > 0 && credentials.every((c) => c.type === "secret");
    if (secretOnly) riskFactors.push("Secrets only — no certificates or federated credentials");

    const riskScore = riskFactors.length;
    const riskLevel: "high" | "medium" | "low" = riskScore >= 4 ? "high" : riskScore >= 2 ? "medium" : "low";

    return {
      id: app.id ?? "", appId: app.appId ?? "", displayName: app.displayName ?? "",
      createdDateTime: app.createdDateTime ?? null, signInAudience: app.signInAudience ?? "",
      owners, credentials, hasExpiredCredentials, hasLongLivedSecrets, permissions, hasHighRiskPermissions,
      highRiskScopes: [...new Set(highRiskScopesFound)], redirectUris, hasWildcardRedirectUris,
      hasTenantWideAdminConsent: false, grantedScopes: [], riskScore, riskLevel, riskFactors,
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
    permissionError: collectionIssues.some(isPermissionIssue),
    apps,
    partialData: collectionIssues.length > 0,
    collectionIssues,
  };
}
