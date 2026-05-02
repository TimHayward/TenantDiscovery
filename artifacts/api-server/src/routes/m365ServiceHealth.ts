import { Router } from "express";
import { graphClient, getCached } from "../lib/graphClient.js";

const router = Router();

router.get("/m365/service-health", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-service-health", async () => {
      const [healthRes, issuesRes] = await Promise.allSettled([
        graphClient.api("/admin/serviceAnnouncement/healthOverviews").get(),
        graphClient.api("/admin/serviceAnnouncement/issues")
          .filter("isResolved eq false")
          .select("id,title,service,status,classification,startDateTime,isResolved")
          .get(),
      ]);

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
      };
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 service health");
    res.status(500).json({ error: "Failed to fetch M365 service health" });
  }
});

export default router;
