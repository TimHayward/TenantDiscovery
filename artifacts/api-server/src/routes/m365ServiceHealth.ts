import { Router } from "express";
import { getCached, getGraphClient } from "../lib/graphClient.js";
import {
  createCollectionIssue,
  isPermissionIssue,
  type CollectionIssue,
} from "../lib/collectionIssues.js";
import { withMetadata } from "../lib/metadata.js";

const router = Router();

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected Graph client error";
}

function getErrorStatus(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number") return statusCode;
  }
  return null;
}

async function getServiceHealthData() {
  return getCached("m365-service-health", async () => {
    const graphClient = await getGraphClient();
    const [healthRes, issuesRes] = await Promise.allSettled([
      graphClient.api("/admin/serviceAnnouncement/healthOverviews").get(),
      graphClient.api("/admin/serviceAnnouncement/issues")
        .filter("isResolved eq false")
        .select("id,title,service,status,classification,startDateTime,isResolved")
        .get(),
    ]);

    const collectionIssues: CollectionIssue[] = [];
    if (healthRes.status === "rejected") {
      collectionIssues.push(
        createCollectionIssue(
          "serviceHealthOverviews",
          getErrorStatus(healthRes.reason),
          getErrorMessage(healthRes.reason),
        ),
      );
    }
    if (issuesRes.status === "rejected") {
      collectionIssues.push(
        createCollectionIssue(
          "serviceHealthIssues",
          getErrorStatus(issuesRes.reason),
          getErrorMessage(issuesRes.reason),
        ),
      );
    }

    const services = healthRes.status === "fulfilled" ? healthRes.value?.value ?? [] : [];
    const issues = issuesRes.status === "fulfilled" ? issuesRes.value?.value ?? [] : [];

    const issuesByService = new Map<string, number>();
    for (const issue of issues) {
      const svc = issue.service ?? "";
      issuesByService.set(svc, (issuesByService.get(svc) ?? 0) + 1);
    }

    let servicesHealthy = 0;
    let servicesWithIssues = 0;
    let activeIncidents = 0;
    let activeAdvisories = 0;

    const serviceList = services.map((s: any) => {
      const hasIssues = s.status !== "serviceOperational";
      const issueCount = issuesByService.get(s.service ?? "") ?? 0;

      if (hasIssues || issueCount > 0) servicesWithIssues++;
      else servicesHealthy++;

      return {
        service: s.service ?? s.id ?? "Unknown",
        status: s.status ?? "serviceOperational",
        classification: s.status === "serviceOperational" ? "advisory" : "incident",
        hasActiveIssues: hasIssues || issueCount > 0,
        activeIncidents: issueCount,
      };
    });

    for (const issue of issues) {
      if ((issue.classification ?? "").toLowerCase().includes("incident")) activeIncidents++;
      else activeAdvisories++;
    }

    const overallStatus = servicesWithIssues === 0
      ? "All services operational"
      : `${servicesWithIssues} service${servicesWithIssues > 1 ? "s" : ""} with issues`;

    return {
      overallStatus,
      servicesHealthy,
      servicesWithIssues,
      totalServices: services.length,
      activeIncidents,
      activeAdvisories,
      services: serviceList,
      partialData: collectionIssues.length > 0,
      permissionError: collectionIssues.some(isPermissionIssue),
      collectionIssues,
    };
  });
}

router.get("/m365/service-health", async (req, res): Promise<void> => {
  try {
    const data = await getServiceHealthData();

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 service health");
    res.status(500).json({ error: "Failed to fetch M365 service health" });
  }
});

router.get("/m365/service-health/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getServiceHealthData();

    const fieldMetadata = {
      overallStatus: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "ServiceHealth.Read.All",
        notes: ["Derived from health overview status and issues count. Source: Graph /admin/serviceAnnouncement endpoints"]
      },
      servicesHealthy: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "ServiceHealth.Read.All",
        notes: ["Count of services with operational status. Direct count from Graph API."]
      },
      servicesWithIssues: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "ServiceHealth.Read.All",
        notes: ["Count of services with non-operational status or active issues. Direct count from Graph API."]
      },
      totalServices: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "ServiceHealth.Read.All",
        notes: ["Total count of monitored services. Source: /admin/serviceAnnouncement/healthOverviews"]
      },
      activeIncidents: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "ServiceHealth.Read.All",
        notes: ["Count of unresolved issues classified as incidents. Source: /admin/serviceAnnouncement/issues with isResolved=false"]
      },
      activeAdvisories: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "ServiceHealth.Read.All",
        notes: ["Count of unresolved issues classified as advisories. Source: /admin/serviceAnnouncement/issues with isResolved=false"]
      },
      partialData: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
        notes: ["True when one or more upstream collection calls failed"]
      },
      permissionError: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
        notes: ["True when collection issues include permission-related failures"]
      },
      collectionIssues: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
        notes: ["Per-source issue details for failed Graph collection calls"]
      },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 service health with metadata");
    res.status(500).json({ error: "Failed to fetch M365 service health" });
  }
});

export default router;
