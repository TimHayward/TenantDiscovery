import { getPermissionMetadataForFeature } from "../permissionMetadata.js";
import {
  createCollectionIssue,
  fetchResourceWithRetry,
  isPermissionIssue,
  type CollectionIssue,
} from "../collectionIssues.js";
import type { GraphOAuthGrantWithResource, GraphServicePrincipal } from "./graphTypes.js";

const MS_PUBLISHER_NAMES = new Set(["Microsoft Corporation", "Microsoft Services", "Microsoft Azure", "Windows Azure", "Microsoft 365"]);
const MS_RESOURCE_APP_IDS = new Set([
  "00000003-0000-0000-c000-000000000000", "00000002-0000-0000-c000-000000000000",
  "00000002-0000-0ff1-ce00-000000000000", "00000003-0000-0ff1-ce00-000000000000",
  "0000000a-0000-0000-c000-000000000000", "00000007-0000-0000-c000-000000000000",
  "48ac35b8-9aa8-4d74-927d-1f4a14a0b239",
]);
const HIGH_RISK_SCOPES = new Set([
  "Directory.ReadWrite.All", "Directory.Read.All", "User.ReadWrite.All", "User.ManageIdentities.All",
  "Group.ReadWrite.All", "Mail.ReadWrite", "Mail.ReadWrite.Shared", "MailboxSettings.ReadWrite",
  "Files.ReadWrite.All", "Calendars.ReadWrite", "RoleManagement.ReadWrite.Directory", "RoleManagement.Read.Directory",
  "Application.ReadWrite.All", "Application.ReadWrite.OwnedBy", "Policy.ReadWrite.All", "Policy.ReadWrite.ConditionalAccess",
  "PrivilegedAccess.ReadWrite.AzureAD", "PrivilegedAccess.Read.AzureAD", "Sites.FullControl.All", "Sites.Manage.All",
  "Sites.ReadWrite.All", "Exchange.ManageAsApp", "AuditLog.Read.All", "Organization.ReadWrite.All",
  "DeviceManagementConfiguration.ReadWrite.All",
]);

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

async function gfetch<T>(url: string, extraHeaders?: Record<string, string>): Promise<{ data: T | null; ok: boolean; status: number }> {
  const resp = await fetchResourceWithRetry(url, GRAPH_SCOPE, extraHeaders);
  if (!resp.ok) return { data: null, ok: false, status: resp.status };
  return { data: (await resp.json()) as T, ok: true, status: resp.status };
}

interface GraphPage<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

async function gfetchAllPages<T>(firstUrl: string, extraHeaders?: Record<string, string>): Promise<{ items: T[]; denied: boolean; status: number | null }> {
  const items: T[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const { data, ok, status }: { data: GraphPage<T> | null; ok: boolean; status: number } =
      await gfetch<GraphPage<T>>(url, extraHeaders);
    if (!ok) return { items: [], denied: status === 401 || status === 403, status };
    if (!data?.value) break;
    items.push(...data.value);
    url = data["@odata.nextLink"] ?? null;
  }
  return { items, denied: false, status: null };
}

async function pLimit<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = []; const queue = [...tasks];
  async function worker() { while (queue.length > 0) { const task = queue.shift()!; results.push(await task()); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

export async function collectServicePrincipals() {
  const permissionMetadata = getPermissionMetadataForFeature("service-principals");
  const collectionIssues: CollectionIssue[] = [];

  let spResult = await gfetchAllPages<GraphServicePrincipal>(
    "https://graph.microsoft.com/beta/servicePrincipals?$select=id,appId,displayName,publisherName,servicePrincipalType,accountEnabled,tags,homepage,replyUrls,signInActivity&$top=500",
  );
  if (spResult.denied) {
    spResult = await gfetchAllPages<GraphServicePrincipal>(
      "https://graph.microsoft.com/v1.0/servicePrincipals?$select=id,appId,displayName,publisherName,servicePrincipalType,accountEnabled,tags,homepage,replyUrls&$top=500",
    );
  }
  if (spResult.denied) {
    collectionIssues.push(createCollectionIssue("servicePrincipals", spResult.status, "Unable to read service principals — permission required."));
    return { total: 0, applicationCount: 0, managedIdentityCount: 0, microsoftOwnedCount: 0, thirdPartyCount: 0, disabledCount: 0, withHighRiskGrants: 0, permissionError: true, servicePrincipals: [], permissionMetadata, partialData: true, collectionIssues };
  }

  const rawSPs = spResult.items;
  const grantsResult = await gfetchAllPages<GraphOAuthGrantWithResource>("https://graph.microsoft.com/v1.0/oauth2PermissionGrants?$select=clientId,resourceId,scope,consentType,principalId&$top=500");
  if (grantsResult.status !== null) {
    collectionIssues.push(createCollectionIssue("oauth2PermissionGrants", grantsResult.status, "Unable to read OAuth permission grants."));
  }
  const rawGrants = grantsResult.items;

  const grantsBySpId = new Map<string, GraphOAuthGrantWithResource[]>();
  for (const g of rawGrants) {
    const clientId = g.clientId ?? "";
    if (!grantsBySpId.has(clientId)) grantsBySpId.set(clientId, []);
    grantsBySpId.get(clientId)!.push(g);
  }

  const resourceIds = new Set(rawGrants.map((g) => g.resourceId ?? "").filter(Boolean));
  const resourceNameMap = new Map<string, string>();
  await pLimit([...resourceIds].map((rid) => async () => {
    const { data, ok } = await gfetch<GraphServicePrincipal>(`https://graph.microsoft.com/v1.0/servicePrincipals/${rid}?$select=id,displayName,appId`);
    if (ok && data?.displayName) resourceNameMap.set(rid, data.displayName);
  }), 10);

  const appTypeSPs = rawSPs.filter((sp) => sp.servicePrincipalType === "Application" && !MS_PUBLISHER_NAMES.has(sp.publisherName ?? "") && !MS_RESOURCE_APP_IDS.has(sp.appId ?? ""));
  const assignmentCountMap = new Map<string, { users: number; groups: number }>();
  await pLimit(appTypeSPs.slice(0, 60).map((sp) => async () => {
    const { data, ok } = await gfetch<{ value?: Array<{ principalType?: string }> }>(`https://graph.microsoft.com/v1.0/servicePrincipals/${sp.id}/appRoleAssignedTo?$select=principalType&$top=100`, { ConsistencyLevel: "eventual" });
    if (!ok || !data?.value) return;
    const assignments = data.value;
    assignmentCountMap.set(sp.id ?? "", { users: assignments.filter((a) => a.principalType === "User").length, groups: assignments.filter((a) => a.principalType === "Group").length });
  }), 8);

  const servicePrincipals = rawSPs.map((sp) => {
    const isFirstParty = MS_PUBLISHER_NAMES.has(sp.publisherName ?? "") || MS_RESOURCE_APP_IDS.has(sp.appId ?? "") || (sp.tags ?? []).includes("WindowsAzureActiveDirectoryIntegratedApp");
    const spGrants = grantsBySpId.get(sp.id ?? "") ?? [];
    const consentGrants = spGrants.map((g) => {
      const scopes: string[] = (g.scope ?? "").split(" ").filter(Boolean);
      const resourceId = g.resourceId ?? "";
      return { consentType: (g.consentType ?? "Principal") as "AllPrincipals" | "Principal", principalId: g.principalId ?? null, resourceId, resourceName: resourceNameMap.get(resourceId) ?? resourceId, scopes, isHighRisk: scopes.some((s) => HIGH_RISK_SCOPES.has(s)) };
    });
    const hasHighRiskGrants = consentGrants.some((g) => g.isHighRisk);
    const isAdminConsented = consentGrants.some((g) => g.consentType === "AllPrincipals");
    const assignments = assignmentCountMap.get(sp.id ?? "") ?? { users: 0, groups: 0 };
    const riskFactors: string[] = [];
    if (hasHighRiskGrants && !isFirstParty) riskFactors.push("High-risk delegated permissions");
    if (isAdminConsented && !isFirstParty) riskFactors.push("Tenant-wide admin consent");
    if (!sp.accountEnabled && spGrants.length) riskFactors.push("Disabled SP with active grants");
    if (!isFirstParty && consentGrants.length > 5) riskFactors.push("Many consent grants (>5)");
    const riskScore = riskFactors.length;
    const riskLevel: "high" | "medium" | "low" = riskScore >= 3 ? "high" : riskScore >= 2 ? "medium" : "low";
    const signIn = sp.signInActivity ?? null;
    return {
      id: sp.id ?? "", appId: sp.appId ?? "", displayName: sp.displayName ?? "",
      publisherName: sp.publisherName ?? null, servicePrincipalType: sp.servicePrincipalType ?? "",
      accountEnabled: sp.accountEnabled ?? false, tags: sp.tags ?? [],
      homepage: sp.homepage ?? null, lastSignInDateTime: signIn?.lastSignInDateTime ?? null,
      consentGrants, hasHighRiskGrants, assignedUserCount: assignments.users, assignedGroupCount: assignments.groups,
      isAdminConsented, isFirstParty, riskLevel, riskScore, riskFactors,
    };
  });

  return {
    total: servicePrincipals.length,
    applicationCount: servicePrincipals.filter((sp) => sp.servicePrincipalType === "Application").length,
    managedIdentityCount: servicePrincipals.filter((sp) => sp.servicePrincipalType === "ManagedIdentity").length,
    microsoftOwnedCount: servicePrincipals.filter((sp) => sp.isFirstParty).length,
    thirdPartyCount: servicePrincipals.filter((sp) => !sp.isFirstParty && sp.servicePrincipalType === "Application").length,
    disabledCount: servicePrincipals.filter((sp) => !sp.accountEnabled).length,
    withHighRiskGrants: servicePrincipals.filter((sp) => sp.hasHighRiskGrants && !sp.isFirstParty).length,
    permissionError: collectionIssues.some(isPermissionIssue),
    servicePrincipals, permissionMetadata,
    partialData: collectionIssues.length > 0,
    collectionIssues,
  };
}
