import {
  fetchAllGraphPages,
  isPermissionIssue,
  type CollectionIssue,
} from "../collectionIssues.js";
import type { GraphHealthOverview, GraphServiceIssue } from "./graphTypes.js";

export async function collectServiceHealth() {
  const [healthRes, issuesRes] = await Promise.all([
    fetchAllGraphPages<GraphHealthOverview>(
      "https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/healthOverviews",
      "serviceHealthOverviews",
      ["ServiceHealth.Read.All"],
    ),
    fetchAllGraphPages<GraphServiceIssue>(
      "https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/issues" +
        "?$filter=isResolved eq false" +
        "&$select=id,title,service,status,classification,startDateTime,isResolved",
      "serviceHealthIssues",
      ["ServiceHealth.Read.All"],
    ),
  ]);

  const collectionIssues: CollectionIssue[] = [...healthRes.issues, ...issuesRes.issues];

  const services = healthRes.items;
  const issues = issuesRes.items;

  const issuesByService = new Map<string, number>();
  for (const issue of issues) {
    const svc = issue.service ?? "";
    issuesByService.set(svc, (issuesByService.get(svc) ?? 0) + 1);
  }

  let servicesHealthy = 0, servicesWithIssues = 0, activeIncidents = 0, activeAdvisories = 0;

  const serviceList = services.map((s) => {
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
