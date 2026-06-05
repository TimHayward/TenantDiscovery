import { getGraphClient } from "../graphClient.js";
import {
  createCollectionIssue,
  isPermissionIssue,
  type CollectionIssue,
} from "../collectionIssues.js";

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

export async function collectServiceHealth() {
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
    collectionIssues.push(createCollectionIssue("serviceHealthOverviews", getErrorStatus(healthRes.reason), getErrorMessage(healthRes.reason)));
  }
  if (issuesRes.status === "rejected") {
    collectionIssues.push(createCollectionIssue("serviceHealthIssues", getErrorStatus(issuesRes.reason), getErrorMessage(issuesRes.reason)));
  }

  const services = healthRes.status === "fulfilled" ? healthRes.value?.value ?? [] : [];
  const issues = issuesRes.status === "fulfilled" ? issuesRes.value?.value ?? [] : [];

  const issuesByService = new Map<string, number>();
  for (const issue of issues) {
    const svc = issue.service ?? "";
    issuesByService.set(svc, (issuesByService.get(svc) ?? 0) + 1);
  }

  let servicesHealthy = 0, servicesWithIssues = 0, activeIncidents = 0, activeAdvisories = 0;

  const serviceList = services.map((s: any) => {
    const hasIssues = s.status !== "serviceOperational";
    const issueCount = issuesByService.get(s.service ?? "") ?? 0;
    if (hasIssues || issueCount > 0) servicesWithIssues++; else servicesHealthy++;
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
    overallStatus, servicesHealthy, servicesWithIssues,
    totalServices: services.length, activeIncidents, activeAdvisories, services: serviceList,
    partialData: collectionIssues.length > 0,
    permissionError: collectionIssues.some(isPermissionIssue),
    collectionIssues,
  };
}
