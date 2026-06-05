import { getGraphCredentialValues } from "../graphClient.js";
import {
  createCollectionIssue,
  isPermissionIssue,
  type CollectionIssue,
} from "../collectionIssues.js";

const POWERBI_API_BASE = "https://api.powerbi.com/v1.0/myorg/admin";

async function fetchPBIJson<T>(url: string, token: string, source: string, issues: CollectionIssue[]): Promise<T | null> {
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) { const body = await resp.text(); issues.push(createCollectionIssue(source, resp.status, body.slice(0, 300))); return null; }
    return (await resp.json()) as T;
  } catch (error) {
    issues.push(createCollectionIssue(source, null, error instanceof Error ? error.message : "Power BI API request failed"));
    return null;
  }
}

export async function collectPowerBI() {
  const collectionIssues: CollectionIssue[] = [];
  let token: string | null = null;
  try {
    const { ClientSecretCredential } = await import("@azure/identity");
    const { tenantId, clientId, clientSecret } = await getGraphCredentialValues();
    const cred = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const tokenResult = await Promise.race([
      cred.getToken("https://analysis.windows.net/powerbi/api/.default"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Power BI token acquisition timed out after 8s")), 8_000)),
    ]);
    if (tokenResult?.token) token = tokenResult.token;
  } catch { /* Power BI scope not configured */ }

  if (!token) {
    const issue = createCollectionIssue("powerBIToken", 401, "Unable to acquire Power BI API token. Ensure the service principal has Power BI Tenant.Read.All or Tenant.ReadWrite.All admin access configured.");
    return {
      available: false, totalWorkspaces: 0, activeWorkspaces: 0, orphanedWorkspaces: 0,
      personalWorkspaces: 0, dedicatedCapacityWorkspaces: 0, totalDatasets: 0,
      refreshableDatasets: 0, totalReports: 0, capacities: [] as any[], workspaces: [] as any[],
      partialData: true, permissionError: true, collectionIssues: [issue],
    };
  }

  const [groupsData, capacitiesData] = await Promise.all([
    fetchPBIJson<{ value: any[] }>(`${POWERBI_API_BASE}/groups?$top=200&$expand=users,datasets,reports`, token, "powerBIWorkspaces", collectionIssues),
    fetchPBIJson<{ value: any[] }>(`${POWERBI_API_BASE}/capacities`, token, "powerBICapacities", collectionIssues),
  ]);

  const groups: any[] = groupsData?.value ?? [];
  const workspaces = groups.map((g: any) => {
    const users: any[] = g.users ?? [];
    const adminCount = users.filter((u: any) => u.groupUserAccessRight === "Admin").length;
    return {
      id: g.id ?? "", name: g.name ?? "", type: g.type ?? "Workspace", state: g.state ?? "Active",
      isOrphaned: adminCount === 0, adminCount, datasetCount: (g.datasets ?? []).length,
      reportCount: (g.reports ?? []).length, isOnDedicatedCapacity: g.isOnDedicatedCapacity ?? false, capacityId: g.capacityId ?? null,
    };
  });

  const allDatasets: any[] = groups.flatMap((g: any) => g.datasets ?? []);
  const capacities = (capacitiesData?.value ?? []).map((c: any) => ({
    id: c.id ?? "", displayName: c.displayName ?? "", sku: c.sku ?? "", state: c.state ?? "", adminCount: (c.admins ?? []).length,
  }));

  return {
    available: true,
    totalWorkspaces: workspaces.length,
    activeWorkspaces: workspaces.filter((w) => w.state === "Active").length,
    orphanedWorkspaces: workspaces.filter((w) => w.isOrphaned && w.state === "Active").length,
    personalWorkspaces: workspaces.filter((w) => w.type === "PersonalGroup").length,
    dedicatedCapacityWorkspaces: workspaces.filter((w) => w.isOnDedicatedCapacity).length,
    totalDatasets: allDatasets.length,
    refreshableDatasets: allDatasets.filter((d: any) => d.isRefreshable).length,
    totalReports: groups.reduce((sum: number, g: any) => sum + (g.reports ?? []).length, 0),
    capacities, workspaces,
    partialData: collectionIssues.length > 0,
    permissionError: collectionIssues.some(isPermissionIssue),
    collectionIssues,
  };
}
