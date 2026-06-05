import { Router } from "express";
import { withMetadata, type FieldMetadataMap } from "../lib/metadata.js";
import { getOrFetch } from "../lib/metricStore.js";
import { collectOverview } from "../lib/collectors/overview.js";

const router = Router();

router.get("/m365/overview", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-overview", collectOverview);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 overview");
    res.status(500).json({ error: "Failed to fetch M365 overview" });
  }
});

router.get("/m365/overview/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-overview", collectOverview);

    const fieldMetadata: FieldMetadataMap = {
      tenantName: { evidenceStatus: "apiBacked", confidenceLabel: "high", sourceLabel: "Microsoft Graph organization" },
      tenantId: { evidenceStatus: "apiBacked", confidenceLabel: "high", sourceLabel: "Microsoft Graph organization" },
      totalUsers: { evidenceStatus: "apiBacked", confidenceLabel: "high", sourceLabel: "Microsoft Graph users" },
      activeUsers: { evidenceStatus: "apiBacked", confidenceLabel: "high", sourceLabel: "Microsoft Graph users", notes: ["Calculated from Graph users by filtering disabled and guest users."] },
      totalLicenses: { evidenceStatus: "apiBacked", confidenceLabel: "high", sourceLabel: "Microsoft Graph subscribedSkus" },
      assignedLicenses: { evidenceStatus: "apiBacked", confidenceLabel: "high", sourceLabel: "Microsoft Graph subscribedSkus" },
      mfaEnabledPercent: { evidenceStatus: "partial", confidenceLabel: "medium", sourceLabel: "Graph userRegistrationDetails", notes: ["Computed from registration details report; result depends on report availability and scope coverage."] },
      secureScore: { evidenceStatus: "apiBacked", confidenceLabel: "high", sourceLabel: "Microsoft Graph secureScores" },
      secureScoreMax: { evidenceStatus: "apiBacked", confidenceLabel: "high", sourceLabel: "Microsoft Graph secureScores" },
      guestUsers: { evidenceStatus: "apiBacked", confidenceLabel: "high", sourceLabel: "Microsoft Graph users", notes: ["Calculated by filtering users with userType Guest."] },
      disabledUsers: { evidenceStatus: "apiBacked", confidenceLabel: "high", sourceLabel: "Microsoft Graph users", notes: ["Calculated by filtering users with accountEnabled=false."] },
      activeServices: { evidenceStatus: "partial", confidenceLabel: "medium", sourceLabel: "Microsoft Graph serviceAnnouncement/healthOverviews", notes: ["Derived from service health statuses and defaults to 0 if service health API is unavailable."] },
      totalServices: { evidenceStatus: "partial", confidenceLabel: "medium", sourceLabel: "Microsoft Graph serviceAnnouncement/healthOverviews", notes: ["Depends on service health API availability."] },
      partialData: { evidenceStatus: "apiBacked", confidenceLabel: "high", sourceLabel: "Route diagnostics", notes: ["True when one or more upstream collection calls failed."] },
      permissionError: { evidenceStatus: "apiBacked", confidenceLabel: "high", sourceLabel: "Route diagnostics", notes: ["True when collection issues include permission-related failures."] },
      collectionIssues: { evidenceStatus: "apiBacked", confidenceLabel: "high", sourceLabel: "Route diagnostics", notes: ["Per-source issue details for failed Graph collection calls."] },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 overview metadata");
    res.status(500).json({ error: "Failed to fetch M365 overview metadata" });
  }
});

export default router;
