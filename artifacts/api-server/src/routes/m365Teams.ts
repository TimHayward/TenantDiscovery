import { Router } from "express";
import { getCached } from "../lib/graphClient.js";
import {
  fetchAllGraphPages,
  fetchGraphText,
  isPermissionIssue,
  type CollectionIssue,
} from "../lib/collectionIssues.js";
import { withMetadata } from "../lib/metadata.js";

const router = Router();

function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/\r/g, ""));
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim().replace(/\r/g, ""));
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = vals[i] ?? "";
    });
    return obj;
  });
}

async function getTeamsData() {
  return getCached("m365-teams", async () => {
    const [teamsResult, activityCsvResult, deviceCsvResult] = await Promise.all([
      fetchAllGraphPages<any>(
        "https://graph.microsoft.com/v1.0/teams?$select=id,displayName,visibility,isArchived&$top=999",
        "teams",
      ),
      fetchGraphText(
        "https://graph.microsoft.com/v1.0/reports/getTeamsUserActivityCounts(period='D30')",
        "teamsUserActivityReport",
      ),
      fetchGraphText(
        "https://graph.microsoft.com/v1.0/reports/getTeamsDeviceUsageUserCounts(period='D30')",
        "teamsDeviceUsageReport",
      ),
    ]);

    const collectionIssues: CollectionIssue[] = [];
    collectionIssues.push(...teamsResult.issues);
    if (activityCsvResult.issue) collectionIssues.push(activityCsvResult.issue);
    if (deviceCsvResult.issue) collectionIssues.push(deviceCsvResult.issue);

    const teams = teamsResult.items;
    const activityRows = parseCsv(activityCsvResult.text ?? "");
    const deviceRows = parseCsv(deviceCsvResult.text ?? "");

    const totalTeams = teams.length;
    let activeTeams = 0;
    let privateTeams = 0;
    let publicTeams = 0;
    let archivedTeams = 0;

    const sizeRanges = [
      { label: "1-5 members", min: 1, max: 5 },
      { label: "6-20 members", min: 6, max: 20 },
      { label: "21-50 members", min: 21, max: 50 },
      { label: "51-100 members", min: 51, max: 100 },
      { label: "100+ members", min: 101, max: Infinity },
    ];
    const sizeCounts = new Array(sizeRanges.length).fill(0);

    for (const t of teams) {
      if (t.isArchived) archivedTeams++;
      else activeTeams++;
      const vis = (t.visibility ?? "").toLowerCase();
      if (vis === "private") privateTeams++;
      else publicTeams++;
    }

    let meetingsOrganizedLast30Days = 0;
    let callsLast30Days = 0;
    let messagesLast30Days = 0;

    for (const row of activityRows) {
      const teamChats = parseInt(row["Team Chat Messages"] ?? "0", 10) || 0;
      const privateMsgs =
        parseInt(row["Private Chat Messages"] ?? "0", 10) || 0;
      const calls = parseInt(row["Calls"] ?? "0", 10) || 0;
      const meetings =
        parseInt(row["Meetings Organized Count"] ?? "0", 10) || 0;
      const postMsgs = parseInt(row["Post Messages"] ?? "0", 10) || 0;
      messagesLast30Days += teamChats + privateMsgs + postMsgs;
      callsLast30Days += calls;
      meetingsOrganizedLast30Days += meetings;
    }

    let activeUsersLast30Days = 0;
    for (const row of deviceRows) {
      const date = row["Report Date"] ?? "";
      if (date) {
        const windows = parseInt(row["Windows"] ?? "0", 10) || 0;
        const mac = parseInt(row["Mac"] ?? "0", 10) || 0;
        const web = parseInt(row["Web"] ?? "0", 10) || 0;
        const ios = parseInt(row["iOS"] ?? "0", 10) || 0;
        const android = parseInt(row["Android Phone"] ?? "0", 10) || 0;
        activeUsersLast30Days = Math.max(
          activeUsersLast30Days,
          windows + mac + web + ios + android,
        );
      }
    }

    return {
      totalTeams,
      activeTeams,
      privateTeams,
      publicTeams,
      archivedTeams,
      totalChannels: 0,
      activeUsersLast30Days,
      meetingsOrganizedLast30Days,
      callsLast30Days,
      messagesLast30Days,
      guestAccessEnabled: true,
      externalAccessEnabled: true,
      teamsBySize: sizeRanges.map((r, i) => ({
        range: r.label,
        count: sizeCounts[i],
      })),
      partialData: collectionIssues.length > 0,
      permissionError: collectionIssues.some(isPermissionIssue),
      collectionIssues,
    };
  });
}

router.get("/m365/teams", async (req, res): Promise<void> => {
  try {
    const data = await getTeamsData();

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 Teams data");
    res.status(500).json({ error: "Failed to fetch M365 Teams data" });
  }
});

router.get("/m365/teams/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getTeamsData();

    const fieldMetadata = {
      totalTeams: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Group.Read.All",
        notes: ["Count of Teams from Graph /teams endpoint"],
      },
      activeTeams: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Group.Read.All",
        notes: ["Computed from non-archived teams"],
      },
      privateTeams: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Group.Read.All",
        notes: ["Computed from visibility=private teams"],
      },
      publicTeams: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Group.Read.All",
        notes: ["Computed from non-private visibility"],
      },
      archivedTeams: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Group.Read.All",
        notes: ["Count of archived teams"],
      },
      totalChannels: {
        evidenceStatus: "manual" as const,
        confidenceLabel: "low" as const,
        sourceLabel: "N/A",
        notes: ["Channel count not currently populated in this route"],
      },
      activeUsersLast30Days: {
        evidenceStatus: "partial" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "Reports.Read.All",
        notes: ["Derived from Teams device usage report maxima"],
      },
      meetingsOrganizedLast30Days: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "Reports.Read.All",
        notes: ["Aggregated from Teams user activity report"],
      },
      callsLast30Days: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "Reports.Read.All",
        notes: ["Aggregated from Teams user activity report"],
      },
      messagesLast30Days: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "medium" as const,
        sourceLabel: "Reports.Read.All",
        notes: ["Aggregated from Teams chat and post activity"],
      },
      guestAccessEnabled: {
        evidenceStatus: "manual" as const,
        confidenceLabel: "low" as const,
        sourceLabel: "N/A",
        notes: ["Hardcoded fallback; policy endpoint not wired yet"],
      },
      externalAccessEnabled: {
        evidenceStatus: "manual" as const,
        confidenceLabel: "low" as const,
        sourceLabel: "N/A",
        notes: ["Hardcoded fallback; policy endpoint not wired yet"],
      },
      teamsBySize: {
        evidenceStatus: "manual" as const,
        confidenceLabel: "low" as const,
        sourceLabel: "N/A",
        notes: ["Team member size distribution placeholder currently returns zeros"],
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
        notes: ["Per-source issue details for failed Graph collection/report calls"],
      },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 Teams data with metadata");
    res.status(500).json({ error: "Failed to fetch M365 Teams data" });
  }
});

export default router;
