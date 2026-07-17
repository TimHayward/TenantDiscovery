import {
  createCollectionIssue,
  fetchResourceWithRetry,
  getAccessToken,
  isPermissionIssue,
  type CollectionIssue,
} from "../collectionIssues.js";

const POWERBI_API_BASE = "https://api.powerbi.com/v1.0/myorg/admin";
const POWERBI_SCOPE = "https://analysis.windows.net/powerbi/api/.default";

/** Wire shapes of the Power BI admin API responses (only the fields read). */
interface PbiUser { groupUserAccessRight?: string }
interface PbiDataset { isRefreshable?: boolean }
interface PbiGroup {
  id?: string;
  name?: string;
  type?: string;
  state?: string;
  users?: PbiUser[];
  datasets?: PbiDataset[];
  reports?: unknown[];
  isOnDedicatedCapacity?: boolean;
  capacityId?: string | null;
}
interface PbiCapacity { id?: string; displayName?: string; sku?: string; state?: string; admins?: unknown[] }

interface WorkspaceSummary {
  id: string;
  name: string;
  type: string;
  state: string;
  isOrphaned: boolean;
  adminCount: number;
  datasetCount: number;
  reportCount: number;
  isOnDedicatedCapacity: boolean;
  capacityId: string | null;
}
interface CapacitySummary { id: string; displayName: string; sku: string; state: string; adminCount: number }

async function fetchPBIJson<T>(url: string, source: string, issues: CollectionIssue[]): Promise<T | null> {
  try {
    // Shares the Graph helpers' timeout/retry policy via the scope-parameterized retry fetch.
    const resp = await fetchResourceWithRetry(url, POWERBI_SCOPE);
    if (!resp.ok) { const body = await resp.text(); issues.push(createCollectionIssue(source, resp.status, body.slice(0, 300))); return null; }
    return (await resp.json()) as T;
  } catch (error) {
    issues.push(createCollectionIssue(source, null, error instanceof Error ? error.message : "Power BI API request failed"));
    return null;
  }
}

export async function collectPowerBI() {
  const collectionIssues: CollectionIssue[] = [];
  let tokenAvailable = false;
  try {
    await Promise.race([
      getAccessToken(POWERBI_SCOPE),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Power BI token acquisition timed out after 8s")), 8_000)),
    ]);
    tokenAvailable = true;
  } catch { /* Power BI scope not configured */ }

  if (!tokenAvailable) {
    const issue = createCollectionIssue("powerBIToken", 401, "Unable to acquire Power BI API token. Ensure the service principal has Power BI Tenant.Read.All or Tenant.ReadWrite.All admin access configured.");
    return {
      available: false, totalWorkspaces: 0, activeWorkspaces: 0, orphanedWorkspaces: 0,
      personalWorkspaces: 0, dedicatedCapacityWorkspaces: 0, totalDatasets: 0,
      refreshableDatasets: 0, totalReports: 0, capacities: [] as CapacitySummary[], workspaces: [] as WorkspaceSummary[],
      partialData: true, permissionError: true, collectionIssues: [issue],
    };
  }

  const [groupsData, capacitiesData] = await Promise.all([
    fetchPBIJson<{ value?: PbiGroup[] }>(`${POWERBI_API_BASE}/groups?$top=200&$expand=users,datasets,reports`, "powerBIWorkspaces", collectionIssues),
    fetchPBIJson<{ value?: PbiCapacity[] }>(`${POWERBI_API_BASE}/capacities`, "powerBICapacities", collectionIssues),
  ]);

  const groups = groupsData?.value ?? [];
  const workspaces: WorkspaceSummary[] = groups.map((g) => {
    const users = g.users ?? [];
    const adminCount = users.filter((u) => u.groupUserAccessRight === "Admin").length;
    return {
      id: g.id ?? "", name: g.name ?? "", type: g.type ?? "Workspace", state: g.state ?? "Active",
      isOrphaned: adminCount === 0, adminCount, datasetCount: (g.datasets ?? []).length,
      reportCount: (g.reports ?? []).length, isOnDedicatedCapacity: g.isOnDedicatedCapacity ?? false, capacityId: g.capacityId ?? null,
    };
  });

  const allDatasets = groups.flatMap((g) => g.datasets ?? []);
  const capacities: CapacitySummary[] = (capacitiesData?.value ?? []).map((c) => ({
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
    refreshableDatasets: allDatasets.filter((d) => d.isRefreshable).length,
    totalReports: groups.reduce((sum, g) => sum + (g.reports ?? []).length, 0),
    capacities, workspaces,
    partialData: collectionIssues.length > 0,
    permissionError: collectionIssues.some(isPermissionIssue),
    collectionIssues,
  };
}
