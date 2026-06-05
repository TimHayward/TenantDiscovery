import { Router } from "express";
import { withMetadata } from "../lib/metadata.js";
import { getOrFetch } from "../lib/metricStore.js";
import { collectTeams } from "../lib/collectors/teams.js";

const router = Router();

router.get("/m365/teams", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-teams", collectTeams);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 Teams data");
    res.status(500).json({ error: "Failed to fetch M365 Teams data" });
  }
});

router.get("/m365/teams/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-teams", collectTeams);

    const fieldMetadata = {
      totalTeams: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Group.Read.All", notes: ["Count of Teams from Graph /teams endpoint"] },
      activeTeams: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Group.Read.All", notes: ["Computed from non-archived teams"] },
      privateTeams: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Group.Read.All", notes: ["Computed from visibility=private teams"] },
      publicTeams: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Group.Read.All", notes: ["Computed from non-private visibility"] },
      archivedTeams: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Group.Read.All", notes: ["Count of archived teams"] },
      totalChannels: { evidenceStatus: "manual" as const, confidenceLabel: "low" as const, sourceLabel: "N/A", notes: ["Channel count not currently populated in this route"] },
      activeUsersLast30Days: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "Reports.Read.All", notes: ["Derived from Teams device usage report maxima"] },
      meetingsOrganizedLast30Days: { evidenceStatus: "apiBacked" as const, confidenceLabel: "medium" as const, sourceLabel: "Reports.Read.All", notes: ["Aggregated from Teams user activity report"] },
      callsLast30Days: { evidenceStatus: "apiBacked" as const, confidenceLabel: "medium" as const, sourceLabel: "Reports.Read.All", notes: ["Aggregated from Teams user activity report"] },
      messagesLast30Days: { evidenceStatus: "apiBacked" as const, confidenceLabel: "medium" as const, sourceLabel: "Reports.Read.All", notes: ["Aggregated from Teams chat and post activity"] },
      guestAccessEnabled: { evidenceStatus: "manual" as const, confidenceLabel: "low" as const, sourceLabel: "N/A", notes: ["Hardcoded fallback; policy endpoint not wired yet"] },
      externalAccessEnabled: { evidenceStatus: "manual" as const, confidenceLabel: "low" as const, sourceLabel: "N/A", notes: ["Hardcoded fallback; policy endpoint not wired yet"] },
      teamsBySize: { evidenceStatus: "apiBacked" as const, confidenceLabel: "medium" as const, sourceLabel: "Group.Read.All", notes: ["Computed from Graph group transitive members plus owners for each Team"] },
      topTeams: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All", notes: ["Per-team activity from getTeamsTeamActivityDetail report, sorted by messages desc, top 25"] },
      partialData: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when one or more upstream collection calls failed"] },
      permissionError: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when collection issues include permission-related failures"] },
      collectionIssues: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["Per-source issue details for failed Graph collection/report calls"] },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 Teams data with metadata");
    res.status(500).json({ error: "Failed to fetch M365 Teams data" });
  }
});

export default router;
