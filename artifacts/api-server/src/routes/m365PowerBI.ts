import { Router } from "express";
import { getCached, getGraphCredentialValues } from "../lib/graphClient.js";
import {
  createCollectionIssue,
  isPermissionIssue,
  type CollectionIssue,
} from "../lib/collectionIssues.js";
import { withMetadata } from "../lib/metadata.js";

const router = Router();

const POWERBI_API_BASE = "https://api.powerbi.com/v1.0/myorg/admin";

export interface PowerBIWorkspaceItem {
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

export interface PowerBICapacityItem {
  id: string;
  displayName: string;
  sku: string;
  state: string;
  adminCount: number;
}

async function fetchPBIJson<T>(
  url: string,
  token: string,
  source: string,
  issues: CollectionIssue[],
): Promise<T | null> {
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
      const body = await resp.text();
      issues.push(createCollectionIssue(source, resp.status, body.slice(0, 300)));
      return null;
    }
    return (await resp.json()) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Power BI API request failed";
    issues.push(createCollectionIssue(source, null, message));
    return null;
  }
}

async function getPowerBIData() {
  return getCached("m365-powerbi", async () => {
    const collectionIssues: CollectionIssue[] = [];

    // Acquire Power BI token using the separate analysis.windows.net scope.
    // Timeout after 8s so a slow/unreachable OIDC endpoint doesn't hang the route.
    let token: string | null = null;
    try {
      const { ClientSecretCredential } = await import("@azure/identity");
      const { tenantId, clientId, clientSecret } = await getGraphCredentialValues();
      const cred = new ClientSecretCredential(tenantId, clientId, clientSecret);
      const tokenResult = await Promise.race([
        cred.getToken("https://analysis.windows.net/powerbi/api/.default"),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Power BI token acquisition timed out after 8s")), 8_000),
        ),
      ]);
      if (tokenResult?.token) token = tokenResult.token;
    } catch {
      // Power BI scope not configured, service principal lacks access, or token endpoint timed out
    }

    if (!token) {
      const issue = createCollectionIssue(
        "powerBIToken",
        401,
        "Unable to acquire Power BI API token. Ensure the service principal has Power BI Tenant.Read.All or Tenant.ReadWrite.All admin access configured.",
      );
      return {
        available: false,
        totalWorkspaces: 0,
        activeWorkspaces: 0,
        orphanedWorkspaces: 0,
        personalWorkspaces: 0,
        dedicatedCapacityWorkspaces: 0,
        totalDatasets: 0,
        refreshableDatasets: 0,
        totalReports: 0,
        capacities: [] as PowerBICapacityItem[],
        workspaces: [] as PowerBIWorkspaceItem[],
        partialData: true,
        permissionError: true,
        collectionIssues: [issue],
      };
    }

    const [groupsData, capacitiesData] = await Promise.all([
      fetchPBIJson<{ value: any[] }>(
        `${POWERBI_API_BASE}/groups?$top=200&$expand=users,datasets,reports`,
        token,
        "powerBIWorkspaces",
        collectionIssues,
      ),
      fetchPBIJson<{ value: any[] }>(
        `${POWERBI_API_BASE}/capacities`,
        token,
        "powerBICapacities",
        collectionIssues,
      ),
    ]);

    const groups: any[] = groupsData?.value ?? [];

    const workspaces: PowerBIWorkspaceItem[] = groups.map((g: any) => {
      const users: any[] = g.users ?? [];
      const adminCount = users.filter(
        (u: any) => u.groupUserAccessRight === "Admin",
      ).length;
      return {
        id: g.id ?? "",
        name: g.name ?? "",
        type: g.type ?? "Workspace",
        state: g.state ?? "Active",
        isOrphaned: adminCount === 0,
        adminCount,
        datasetCount: (g.datasets ?? []).length,
        reportCount: (g.reports ?? []).length,
        isOnDedicatedCapacity: g.isOnDedicatedCapacity ?? false,
        capacityId: g.capacityId ?? null,
      };
    });

    const totalWorkspaces = workspaces.length;
    const activeWorkspaces = workspaces.filter((w) => w.state === "Active").length;
    const orphanedWorkspaces = workspaces.filter(
      (w) => w.isOrphaned && w.state === "Active",
    ).length;
    const personalWorkspaces = workspaces.filter((w) => w.type === "PersonalGroup").length;
    const dedicatedCapacityWorkspaces = workspaces.filter(
      (w) => w.isOnDedicatedCapacity,
    ).length;

    const allDatasets: any[] = groups.flatMap((g: any) => g.datasets ?? []);
    const totalDatasets = allDatasets.length;
    const refreshableDatasets = allDatasets.filter((d: any) => d.isRefreshable).length;
    const totalReports = groups.reduce(
      (sum: number, g: any) => sum + (g.reports ?? []).length,
      0,
    );

    const capacities: PowerBICapacityItem[] = (capacitiesData?.value ?? []).map(
      (c: any) => ({
        id: c.id ?? "",
        displayName: c.displayName ?? "",
        sku: c.sku ?? "",
        state: c.state ?? "",
        adminCount: (c.admins ?? []).length,
      }),
    );

    return {
      available: true,
      totalWorkspaces,
      activeWorkspaces,
      orphanedWorkspaces,
      personalWorkspaces,
      dedicatedCapacityWorkspaces,
      totalDatasets,
      refreshableDatasets,
      totalReports,
      capacities,
      workspaces,
      partialData: collectionIssues.length > 0,
      permissionError: collectionIssues.some(isPermissionIssue),
      collectionIssues,
    };
  });
}

router.get("/m365/powerbi", async (req, res): Promise<void> => {
  try {
    const data = await getPowerBIData();
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch Power BI data");
    res.status(500).json({ error: "Failed to fetch Power BI data" });
  }
});

router.get("/m365/powerbi/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getPowerBIData();

    const fieldMetadata = {
      available: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Power BI Admin API token acquisition",
        notes: [
          "False when Power BI API token cannot be acquired — typically means the service principal lacks Power BI admin consent",
        ],
      },
      totalWorkspaces: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Power BI Admin API /admin/groups",
      },
      activeWorkspaces: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Power BI Admin API /admin/groups (state=Active)",
      },
      orphanedWorkspaces: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "Computed from workspace admin user count",
        notes: ["Workspace is orphaned when no user has groupUserAccessRight=Admin"],
      },
      personalWorkspaces: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Power BI Admin API (type=PersonalGroup)",
      },
      dedicatedCapacityWorkspaces: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Power BI Admin API (isOnDedicatedCapacity=true)",
      },
      totalDatasets: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Power BI Admin API workspaces $expand=datasets",
      },
      refreshableDatasets: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "isRefreshable flag from Power BI Admin API",
      },
      totalReports: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Power BI Admin API workspaces $expand=reports",
      },
      capacities: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Power BI Admin API /admin/capacities",
      },
      workspaces: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Power BI Admin API /admin/groups",
        notes: ["Limited to first 200 workspaces; larger tenants may require pagination"],
      },
      partialData: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
        notes: ["True when one or more upstream collection calls failed"],
      },
      permissionError: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
        notes: ["True when collection issues include permission-related failures"],
      },
      collectionIssues: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
        notes: ["Per-source issue details for failed Power BI API calls"],
      },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch Power BI data with metadata");
    res.status(500).json({ error: "Failed to fetch Power BI data" });
  }
});

export default router;
