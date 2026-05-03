import { Router } from "express";
import { getCached } from "../lib/graphClient.js";

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

async function gfetchAllPages(firstUrl: string, token: string, extraHeaders?: Record<string, string>): Promise<{ items: any[]; denied: boolean }> {
  const items: any[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const { data, ok, status } = await gfetch(url, token, extraHeaders);
    if (!ok) return { items: [], denied: status === 401 || status === 403 };
    if (!data?.value) break;
    items.push(...(data.value as any[]));
    url = (data["@odata.nextLink"] as string) ?? null;
  }
  return { items, denied: false };
}

// Known first-party Microsoft publisher names / tenant IDs
const MS_PUBLISHER_NAMES = new Set([
  "Microsoft Corporation",
  "Microsoft Services",
  "Microsoft Azure",
  "Windows Azure",
  "Microsoft 365",
]);

// Well-known Microsoft-owned resource App IDs
const MS_RESOURCE_APP_IDS = new Set([
  "00000003-0000-0000-c000-000000000000", // Microsoft Graph
  "00000002-0000-0000-c000-000000000000", // Azure AD Graph (Legacy)
  "00000002-0000-0ff1-ce00-000000000000", // Exchange Online
  "00000003-0000-0ff1-ce00-000000000000", // SharePoint Online
  "0000000a-0000-0000-c000-000000000000", // Microsoft Flow
  "00000007-0000-0000-c000-000000000000", // Dynamics CRM
  "48ac35b8-9aa8-4d74-927d-1f4a14a0b239", // Microsoft Teams Services
]);

// High-risk scopes
const HIGH_RISK_SCOPES = new Set([
  "Directory.ReadWrite.All", "Directory.Read.All",
  "User.ReadWrite.All", "User.ManageIdentities.All",
  "Group.ReadWrite.All", "Mail.ReadWrite", "Mail.ReadWrite.Shared",
  "MailboxSettings.ReadWrite", "Files.ReadWrite.All", "Calendars.ReadWrite",
  "RoleManagement.ReadWrite.Directory", "RoleManagement.Read.Directory",
  "Application.ReadWrite.All", "Application.ReadWrite.OwnedBy",
  "Policy.ReadWrite.All", "Policy.ReadWrite.ConditionalAccess",
  "PrivilegedAccess.ReadWrite.AzureAD", "PrivilegedAccess.Read.AzureAD",
  "Sites.FullControl.All", "Sites.Manage.All", "Sites.ReadWrite.All",
  "Exchange.ManageAsApp", "AuditLog.Read.All", "Organization.ReadWrite.All",
  "DeviceManagementConfiguration.ReadWrite.All",
]);

// Run N async tasks with at most `concurrency` in parallel
async function pLimit<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = [];
  const queue = [...tasks];
  async function worker() {
    while (queue.length > 0) {
      const task = queue.shift()!;
      results.push(await task());
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

router.get("/m365/service-principals", async (req, res) => {
  try {
    const token = await getCached("sp-token", getToken);

    // ── 1. Fetch all service principals (beta for signInActivity) ───────────
    const spResult = await gfetchAllPages(
      "https://graph.microsoft.com/beta/servicePrincipals" +
        "?$select=id,appId,displayName,publisherName,servicePrincipalType,accountEnabled,tags,homepage,replyUrls,signInActivity" +
        "&$top=500",
      token
    );

    if (spResult.denied) {
      return res.json({
        total: 0, applicationCount: 0, managedIdentityCount: 0,
        microsoftOwnedCount: 0, thirdPartyCount: 0, disabledCount: 0,
        withHighRiskGrants: 0, permissionError: true, servicePrincipals: [],
      });
    }

    const rawSPs = spResult.items as any[];

    // ── 2. Fetch all delegated (oauth2) permission grants ───────────────────
    const grantsResult = await gfetchAllPages(
      "https://graph.microsoft.com/v1.0/oauth2PermissionGrants?$select=clientId,resourceId,scope,consentType,principalId&$top=500",
      token
    );
    const rawGrants = grantsResult.items as any[];

    // Build a map: clientId (SP id) → grants
    const grantsBySpId = new Map<string, any[]>();
    for (const g of rawGrants) {
      if (!grantsBySpId.has(g.clientId)) grantsBySpId.set(g.clientId, []);
      grantsBySpId.get(g.clientId)!.push(g);
    }

    // ── 3. Fetch resource SP displayNames for grant resolution ──────────────
    const resourceIds = new Set(rawGrants.map((g: any) => g.resourceId as string));
    const resourceNameMap = new Map<string, string>();
    await pLimit(
      [...resourceIds].map((rid) => async () => {
        const { data, ok } = await gfetch(
          `https://graph.microsoft.com/v1.0/servicePrincipals/${rid}?$select=id,displayName,appId`,
          token
        );
        if (ok && data) {
          resourceNameMap.set(rid, data.displayName as string);
        }
      }),
      10
    );

    // ── 4. For Application-type SPs, fetch appRoleAssignedTo counts ─────────
    //    (only for non-first-party SPs to avoid noisy Microsoft apps)
    const appTypeSPs = rawSPs.filter(
      (sp: any) =>
        sp.servicePrincipalType === "Application" &&
        !MS_PUBLISHER_NAMES.has(sp.publisherName) &&
        !MS_RESOURCE_APP_IDS.has(sp.appId)
    );

    const assignmentCountMap = new Map<string, { users: number; groups: number }>();
    await pLimit(
      appTypeSPs.slice(0, 60).map((sp: any) => async () => {
        // Get first page of assignments (up to 100) + count header
        const { data, ok } = await gfetch(
          `https://graph.microsoft.com/v1.0/servicePrincipals/${sp.id}/appRoleAssignedTo?$select=principalType&$top=100`,
          token,
          { ConsistencyLevel: "eventual" }
        );
        if (!ok || !data?.value) return;
        const assignments = data.value as any[];
        const users  = assignments.filter((a: any) => a.principalType === "User").length;
        const groups = assignments.filter((a: any) => a.principalType === "Group").length;
        assignmentCountMap.set(sp.id, { users, groups });
      }),
      8
    );

    // ── 5. Build structured output ─────────────────────────────────────────
    const servicePrincipals = rawSPs.map((sp: any) => {
      const isFirstParty =
        MS_PUBLISHER_NAMES.has(sp.publisherName) ||
        MS_RESOURCE_APP_IDS.has(sp.appId) ||
        (sp.tags as string[] || []).includes("WindowsAzureActiveDirectoryIntegratedApp");

      const spGrants = grantsBySpId.get(sp.id) ?? [];
      const consentGrants = spGrants.map((g: any) => {
        const scopes: string[] = (g.scope ?? "").split(" ").filter(Boolean);
        const isHighRisk = scopes.some((s: string) => HIGH_RISK_SCOPES.has(s));
        return {
          consentType: g.consentType as "AllPrincipals" | "Principal",
          principalId: g.principalId ?? null,
          resourceId: g.resourceId,
          resourceName: resourceNameMap.get(g.resourceId) ?? g.resourceId,
          scopes,
          isHighRisk,
        };
      });

      const hasHighRiskGrants = consentGrants.some((g) => g.isHighRisk);
      const isAdminConsented  = consentGrants.some((g) => g.consentType === "AllPrincipals");
      const assignments = assignmentCountMap.get(sp.id) ?? { users: 0, groups: 0 };

      // Compute risk factors
      const riskFactors: string[] = [];
      if (hasHighRiskGrants && !isFirstParty)    riskFactors.push("High-risk delegated permissions");
      if (isAdminConsented && !isFirstParty)     riskFactors.push("Tenant-wide admin consent");
      if (!sp.accountEnabled && spGrants.length) riskFactors.push("Disabled SP with active grants");
      if (!isFirstParty && consentGrants.length > 5) riskFactors.push("Many consent grants (>5)");

      const riskScore = riskFactors.length;
      const riskLevel: "high" | "medium" | "low" =
        riskScore >= 3 ? "high" : riskScore >= 2 ? "medium" : "low";

      const signIn = sp.signInActivity ?? null;

      return {
        id: sp.id as string,
        appId: sp.appId as string,
        displayName: sp.displayName as string,
        publisherName: (sp.publisherName as string | null) ?? null,
        servicePrincipalType: sp.servicePrincipalType as string,
        accountEnabled: sp.accountEnabled as boolean,
        tags: (sp.tags as string[]) ?? [],
        homepage: (sp.homepage as string | null) ?? null,
        lastSignInDateTime: signIn?.lastSignInDateTime ?? null,
        consentGrants,
        hasHighRiskGrants,
        assignedUserCount: assignments.users,
        assignedGroupCount: assignments.groups,
        isAdminConsented,
        isFirstParty,
        riskLevel,
        riskScore,
        riskFactors,
      };
    });

    const applicationCount     = servicePrincipals.filter((sp) => sp.servicePrincipalType === "Application").length;
    const managedIdentityCount = servicePrincipals.filter((sp) => sp.servicePrincipalType === "ManagedIdentity").length;
    const microsoftOwnedCount  = servicePrincipals.filter((sp) => sp.isFirstParty).length;
    const thirdPartyCount      = servicePrincipals.filter((sp) => !sp.isFirstParty && sp.servicePrincipalType === "Application").length;
    const disabledCount        = servicePrincipals.filter((sp) => !sp.accountEnabled).length;
    const withHighRiskGrants   = servicePrincipals.filter((sp) => sp.hasHighRiskGrants && !sp.isFirstParty).length;

    return res.json({
      total: servicePrincipals.length,
      applicationCount,
      managedIdentityCount,
      microsoftOwnedCount,
      thirdPartyCount,
      disabledCount,
      withHighRiskGrants,
      permissionError: false,
      servicePrincipals,
    });
  } catch (err) {
    req.log.error(err, "Error fetching service principals");
    return res.status(500).json({ error: "Failed to fetch service principals" });
  }
});

export default router;
