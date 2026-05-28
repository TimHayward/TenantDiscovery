import { Router } from "express";
import { getCached } from "../lib/graphClient.js";
import {
  fetchGraphText,
  isPermissionIssue,
  type CollectionIssue,
} from "../lib/collectionIssues.js";
import { withMetadata } from "../lib/metadata.js";

const router = Router();

type ReportPeriod = "D30" | "D90" | "D180";

const TREND_PERIODS: ReportPeriod[] = ["D30", "D90", "D180"];

function parseCsv(csv: string): Record<string, string>[] {
  // Strip UTF-8 BOM that Graph prepends to CSV responses
  const cleaned = csv.replace(/^﻿/, "").trim();
  const lines = cleaned.split("\n").filter(Boolean);
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

function toNum(s: string | undefined): number {
  return parseInt(s ?? "0", 10) || 0;
}

function adoptionPct(active: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((active / total) * 1000) / 10;
}

// Graph reports arrive oldest-first and have a 48-72h lag: the most recent
// rows often have zeroed-out data while processing is still in progress.
// Walk backwards to find the last row where Office 365 Active is populated.
function latestRow(
  rows: Record<string, string>[],
  ...sentinelCols: string[]
): Record<string, string> | null {
  if (rows.length === 0) return null;
  const cols = sentinelCols.length > 0 ? sentinelCols : ["Office 365 Active"];
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (cols.some((c) => toNum(row[c]) > 0)) return row;
  }
  // All rows are zero — return the last row rather than null so the caller
  // can still distinguish between "no data" and "empty response".
  return rows[rows.length - 1];
}

const WORKLOAD_DEFS = [
  {
    key: "Exchange",
    displayName: "Exchange Online",
    activeCol: "Exchange Active",
    inactiveCol: "Exchange Inactive",
  },
  {
    key: "Teams",
    displayName: "Microsoft Teams",
    activeCol: "Teams Active",
    inactiveCol: "Teams Inactive",
  },
  {
    key: "SharePoint",
    displayName: "SharePoint Online",
    activeCol: "SharePoint Active",
    inactiveCol: "SharePoint Inactive",
  },
  {
    key: "OneDrive",
    displayName: "OneDrive for Business",
    activeCol: "OneDrive Active",
    inactiveCol: "OneDrive Inactive",
  },
  {
    key: "Yammer",
    displayName: "Viva Engage (Yammer)",
    activeCol: "Yammer Active",
    inactiveCol: "Yammer Inactive",
  },
] as const;

const APP_DEFS = [
  { key: "Outlook",    displayName: "Outlook"     },
  { key: "Teams",      displayName: "Teams"        },
  { key: "Word",       displayName: "Word"         },
  { key: "Excel",      displayName: "Excel"        },
  { key: "PowerPoint", displayName: "PowerPoint"   },
  { key: "OneNote",    displayName: "OneNote"      },
] as const;

export interface WorkloadTrendPoint {
  period: string;
  activeUsers: number;
  licensedUsers: number;
  adoptionPercent: number;
}

export interface WorkloadDepthMetrics {
  // Teams depth
  teamChatMessages: number | null;
  privateChatMessages: number | null;
  calls: number | null;
  meetings: number | null;
  // OneDrive depth
  odViewedOrEdited: number | null;
  odSynced: number | null;
  odSharedInternally: number | null;
  odSharedExternally: number | null;
  // SharePoint depth
  spVisitedPages: number | null;
  spViewedOrEdited: number | null;
  spSynced: number | null;
  spSharedInternally: number | null;
  spSharedExternally: number | null;
  // Exchange depth
  emailSent: number | null;
  emailReceived: number | null;
  emailRead: number | null;
}

export interface WorkloadAdoptionItem {
  workload: string;
  displayName: string;
  activeUsers: number;
  inactiveUsers: number;
  licensedUsers: number;
  adoptionPercent: number;
  isValueGap: boolean;
  trend: WorkloadTrendPoint[];
  depth: WorkloadDepthMetrics | null;
}

export interface AppActivationItem {
  app: string;
  displayName: string;
  activeUsers: number;
}

export interface CopilotAppUsage {
  app: string;
  displayName: string;
  enabledUsers: number;
  activeUsers: number;
}

export interface CopilotAdoptionData {
  enabledUsers: number;
  activeUsers: number;
  adoptionPercent: number;
  appBreakdown: CopilotAppUsage[];
}

export interface M365AdoptionData {
  workloads: WorkloadAdoptionItem[];
  totalActiveUsers: number;
  totalLicensedUsers: number;
  overallAdoptionPercent: number;
  valueGapCount: number;
  appsActivation: AppActivationItem[];
  copilotAdoption: CopilotAdoptionData | null;
  partialData: boolean;
  permissionError: boolean;
  collectionIssues: CollectionIssue[];
}

// Read a column value trying multiple name variants (Graph CSV column names vary slightly between endpoints/tenants)
function col(row: Record<string, string>, ...names: string[]): number {
  for (const n of names) {
    const v = row[n];
    if (v !== undefined) return toNum(v);
  }
  return 0;
}

function nullableCol(row: Record<string, string> | null, ...names: string[]): number | null {
  if (!row) return null;
  for (const n of names) {
    if (row[n] !== undefined) return toNum(row[n]);
  }
  return null;
}

async function getAdoptionData(): Promise<M365AdoptionData> {
  return getCached("m365-adoption", async () => {
    const collectionIssues: CollectionIssue[] = [];

    const [periodResults, appsResult, teamsDepthResult, odDepthResult, spDepthResult, emailDepthResult, copilotResult] = await Promise.all([
      Promise.all(
        TREND_PERIODS.map(async (period) => {
          const result = await fetchGraphText(
            `https://graph.microsoft.com/v1.0/reports/getOffice365ServicesUserCounts(period='${period}')`,
            `getOffice365ServicesUserCounts(${period})`,
          );
          if (result.issue) collectionIssues.push(result.issue);
          return { period, rows: parseCsv(result.text ?? "") };
        }),
      ),
      fetchGraphText(
        "https://graph.microsoft.com/v1.0/reports/getM365AppUserCounts(period='D30')",
        "getM365AppUserCounts(D30)",
      ),
      fetchGraphText(
        "https://graph.microsoft.com/v1.0/reports/getTeamsUserActivityUserCounts(period='D30')",
        "getTeamsUserActivityUserCounts(D30)",
      ),
      fetchGraphText(
        "https://graph.microsoft.com/v1.0/reports/getOneDriveActivityUserCounts(period='D30')",
        "getOneDriveActivityUserCounts(D30)",
      ),
      fetchGraphText(
        "https://graph.microsoft.com/v1.0/reports/getSharePointActivityUserCounts(period='D30')",
        "getSharePointActivityUserCounts(D30)",
      ),
      fetchGraphText(
        "https://graph.microsoft.com/v1.0/reports/getEmailActivityUserCounts(period='D30')",
        "getEmailActivityUserCounts(D30)",
      ),
      fetchGraphText(
        "https://graph.microsoft.com/beta/reports/getMicrosoft365CopilotUserCounts(period='D30')",
        "getMicrosoft365CopilotUserCounts(D30)",
      ),
    ]);

    if (appsResult.issue) collectionIssues.push(appsResult.issue);
    if (teamsDepthResult.issue) collectionIssues.push(teamsDepthResult.issue);
    if (odDepthResult.issue) collectionIssues.push(odDepthResult.issue);
    if (spDepthResult.issue) collectionIssues.push(spDepthResult.issue);
    if (emailDepthResult.issue) collectionIssues.push(emailDepthResult.issue);
    // Copilot endpoint errors are non-fatal (tenant may not have Copilot licences)
    if (copilotResult.issue) collectionIssues.push(copilotResult.issue);

    const periodMap = new Map(periodResults.map((r) => [r.period, r.rows]));
    const d30Latest = latestRow(periodMap.get("D30") ?? []);

    // Depth metric rows (use last non-zero row by checking Teams active or "Viewed Or Edited")
    const teamsDepthRow = latestRow(parseCsv(teamsDepthResult.text ?? ""));
    const odDepthRow = latestRow(parseCsv(odDepthResult.text ?? ""));
    const spDepthRow = latestRow(parseCsv(spDepthResult.text ?? ""));
    const emailDepthRow = latestRow(parseCsv(emailDepthResult.text ?? ""));

    const workloads: WorkloadAdoptionItem[] = WORKLOAD_DEFS.map((def) => {
      const active = d30Latest ? toNum(d30Latest[def.activeCol]) : 0;
      const inactive = d30Latest ? toNum(d30Latest[def.inactiveCol]) : 0;
      const licensed = active + inactive;
      const pct = adoptionPct(active, licensed);

      const trend: WorkloadTrendPoint[] = TREND_PERIODS.map((tp) => {
        const row = latestRow(periodMap.get(tp) ?? []);
        const tActive = row ? toNum(row[def.activeCol]) : 0;
        const tInactive = row ? toNum(row[def.inactiveCol]) : 0;
        const tLicensed = tActive + tInactive;
        return {
          period: tp,
          activeUsers: tActive,
          licensedUsers: tLicensed,
          adoptionPercent: adoptionPct(tActive, tLicensed),
        };
      });

      let depth: WorkloadDepthMetrics | null = null;
      if (def.key === "Teams") {
        depth = {
          teamChatMessages: nullableCol(teamsDepthRow, "Team Chat Messages", "Team Chat Message Count"),
          privateChatMessages: nullableCol(teamsDepthRow, "Private Chat Messages", "Private Chat Message Count"),
          calls: nullableCol(teamsDepthRow, "Calls", "Call Count"),
          meetings: nullableCol(teamsDepthRow, "Meetings", "Meeting Count", "Meetings Attended Count"),
          odViewedOrEdited: null, odSynced: null, odSharedInternally: null, odSharedExternally: null,
          spVisitedPages: null, spViewedOrEdited: null, spSynced: null, spSharedInternally: null, spSharedExternally: null,
          emailSent: null, emailReceived: null, emailRead: null,
        };
      } else if (def.key === "OneDrive") {
        depth = {
          teamChatMessages: null, privateChatMessages: null, calls: null, meetings: null,
          odViewedOrEdited: nullableCol(odDepthRow, "Viewed Or Edited", "Viewed Or Edited File Count"),
          odSynced: nullableCol(odDepthRow, "Synced", "Synced File Count"),
          odSharedInternally: nullableCol(odDepthRow, "Shared Internally", "Shared Internally File Count"),
          odSharedExternally: nullableCol(odDepthRow, "Shared Externally", "Shared Externally File Count"),
          spVisitedPages: null, spViewedOrEdited: null, spSynced: null, spSharedInternally: null, spSharedExternally: null,
          emailSent: null, emailReceived: null, emailRead: null,
        };
      } else if (def.key === "SharePoint") {
        depth = {
          teamChatMessages: null, privateChatMessages: null, calls: null, meetings: null,
          odViewedOrEdited: null, odSynced: null, odSharedInternally: null, odSharedExternally: null,
          spVisitedPages: nullableCol(spDepthRow, "Visited Page Count", "Visited Page"),
          spViewedOrEdited: nullableCol(spDepthRow, "Viewed Or Edited File Count", "Viewed Or Edited Files", "Viewed Or Edited"),
          spSynced: nullableCol(spDepthRow, "Synced File Count", "Synced Files", "Synced"),
          spSharedInternally: nullableCol(spDepthRow, "Shared Internally File Count", "Shared Internally"),
          spSharedExternally: nullableCol(spDepthRow, "Shared Externally File Count", "Shared Externally"),
          emailSent: null, emailReceived: null, emailRead: null,
        };
      } else if (def.key === "Exchange") {
        depth = {
          teamChatMessages: null, privateChatMessages: null, calls: null, meetings: null,
          odViewedOrEdited: null, odSynced: null, odSharedInternally: null, odSharedExternally: null,
          spVisitedPages: null, spViewedOrEdited: null, spSynced: null, spSharedInternally: null, spSharedExternally: null,
          emailSent: nullableCol(emailDepthRow, "Send", "Send Count", "Sent"),
          emailReceived: nullableCol(emailDepthRow, "Receive", "Receive Count", "Received"),
          emailRead: nullableCol(emailDepthRow, "Read", "Read Count"),
        };
      }

      return {
        workload: def.key,
        displayName: def.displayName,
        activeUsers: active,
        inactiveUsers: inactive,
        licensedUsers: licensed,
        adoptionPercent: pct,
        isValueGap: licensed > 0 && pct < 20,
        trend,
        depth,
      };
    });

    // Apps activation — find the best (most recent non-zero) row per app independently,
    // since Microsoft's pipeline may lag differently across apps on the same report date.
    const appsRows = parseCsv(appsResult.text ?? "");
    if (appsRows.length > 0) {
      console.log("[m365Adoption] getM365AppUserCounts CSV headers:", Object.keys(appsRows[0]).join(", "));
    }
    const appsActivation: AppActivationItem[] = APP_DEFS.map((def) => {
      const appRow = latestRow(appsRows, def.key);
      return {
        app: def.key,
        displayName: def.displayName,
        activeUsers: appRow ? col(appRow, def.key) : 0,
      };
    });

    // Copilot adoption (null when endpoint errors or no Copilot licences)
    let copilotAdoption: CopilotAdoptionData | null = null;
    if (!copilotResult.issue && copilotResult.text) {
      const copilotRows = parseCsv(copilotResult.text);
      const copilotRow = latestRow(copilotRows);
      if (copilotRow) {
        const enabledUsers = col(copilotRow, "Enabled Users", "Microsoft 365 Copilot Enabled Users");
        const activeUsers = col(copilotRow, "Active Users", "Microsoft 365 Copilot Active Users");
        const COPILOT_APPS = [
          { app: "Teams",      displayName: "Teams",       enabledCol: "Teams Enabled",       activeCol: "Teams Active"       },
          { app: "Outlook",    displayName: "Outlook",     enabledCol: "Outlook Enabled",     activeCol: "Outlook Active"     },
          { app: "Word",       displayName: "Word",        enabledCol: "Word Enabled",        activeCol: "Word Active"        },
          { app: "Excel",      displayName: "Excel",       enabledCol: "Excel Enabled",       activeCol: "Excel Active"       },
          { app: "PowerPoint", displayName: "PowerPoint",  enabledCol: "PowerPoint Enabled",  activeCol: "PowerPoint Active"  },
          { app: "OneNote",    displayName: "OneNote",     enabledCol: "OneNote Enabled",     activeCol: "OneNote Active"     },
        ] as const;
        copilotAdoption = {
          enabledUsers,
          activeUsers,
          adoptionPercent: adoptionPct(activeUsers, enabledUsers),
          appBreakdown: COPILOT_APPS.map((a) => ({
            app: a.app,
            displayName: a.displayName,
            enabledUsers: col(copilotRow, a.enabledCol),
            activeUsers: col(copilotRow, a.activeCol),
          })),
        };
        // Treat as null if enabled users is zero (no Copilot licences)
        if (enabledUsers === 0) copilotAdoption = null;
      }
    }

    const totalActive = d30Latest ? toNum(d30Latest["Office 365 Active"]) : 0;
    const totalInactive = d30Latest
      ? toNum(d30Latest["Office 365 Inactive"])
      : 0;
    const totalLicensed = totalActive + totalInactive;

    return {
      workloads,
      totalActiveUsers: totalActive,
      totalLicensedUsers: totalLicensed,
      overallAdoptionPercent: adoptionPct(totalActive, totalLicensed),
      valueGapCount: workloads.filter((w) => w.isValueGap).length,
      appsActivation,
      copilotAdoption,
      partialData: collectionIssues.length > 0,
      permissionError: collectionIssues.some(isPermissionIssue),
      collectionIssues,
    };
  });
}

router.get("/m365/adoption/debug", async (req, res): Promise<void> => {
  try {
    const result = await fetchGraphText(
      "https://graph.microsoft.com/v1.0/reports/getOffice365ServicesUserCounts(period='D30')",
      "debug",
    );
    if (result.issue) {
      res.json({ error: result.issue });
      return;
    }
    const raw = result.text ?? "";
    const hasBom = raw.charCodeAt(0) === 0xfeff;
    const cleaned = raw.replace(/^﻿/, "").trim();
    const lines = cleaned.split("\n").filter(Boolean);
    const headers = lines.length > 0
      ? lines[0].split(",").map((h) => h.trim().replace(/\r/g, ""))
      : [];
    const firstDataRow = lines.length > 1
      ? lines[1].split(",").map((v) => v.trim().replace(/\r/g, ""))
      : [];
    const lastDataRow = lines.length > 1
      ? lines[lines.length - 1].split(",").map((v) => v.trim().replace(/\r/g, ""))
      : [];
    res.json({
      hasBom,
      totalRows: lines.length - 1,
      rawFirst200Chars: raw.slice(0, 200),
      headers,
      firstDataRow: Object.fromEntries(headers.map((h, i) => [h, firstDataRow[i]])),
      lastDataRow: Object.fromEntries(headers.map((h, i) => [h, lastDataRow[i]])),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/m365/adoption", async (req, res): Promise<void> => {
  try {
    const data = await getAdoptionData();
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 Adoption data");
    res.status(500).json({ error: "Failed to fetch M365 Adoption data" });
  }
});

router.get("/m365/adoption/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getAdoptionData();
    const fieldMetadata = {
      workloads: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel:
          "Reports.Read.All — getOffice365ServicesUserCounts (D30/D90/D180)",
      },
      totalActiveUsers: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel:
          "Reports.Read.All — getOffice365ServicesUserCounts, Office 365 Active column",
      },
      totalLicensedUsers: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel:
          "Reports.Read.All — Active + Inactive from Office 365 aggregate",
      },
      overallAdoptionPercent: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel:
          "Calculated: Office 365 Active ÷ (Active + Inactive) × 100",
      },
      valueGapCount: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Count of workloads with <20% adoption in 30-day window",
      },
    };
    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 Adoption data");
    res.status(500).json({ error: "Failed to fetch M365 Adoption data" });
  }
});

export default router;
