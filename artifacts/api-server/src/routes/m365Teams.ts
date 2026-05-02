import { Router } from "express";
import { getCached } from "../lib/graphClient.js";

const router = Router();

async function fetchWithToken(url: string): Promise<any> {
  const { ClientSecretCredential } = await import("@azure/identity");
  const cred = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID!,
    process.env.AZURE_CLIENT_ID!,
    process.env.AZURE_CLIENT_SECRET!
  );
  const token = await cred.getToken("https://graph.microsoft.com/.default");
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token!.token}` },
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function fetchReportCsv(url: string): Promise<string> {
  const { ClientSecretCredential } = await import("@azure/identity");
  const cred = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID!,
    process.env.AZURE_CLIENT_ID!,
    process.env.AZURE_CLIENT_SECRET!
  );
  const token = await cred.getToken("https://graph.microsoft.com/.default");
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token!.token}` },
  });
  if (!resp.ok) return "";
  return resp.text();
}

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

async function fetchAllPages(firstUrl: string): Promise<any[]> {
  const results: any[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const page: any = await fetchWithToken(url);
    if (!page || !page.value) break;
    results.push(...page.value);
    url = page["@odata.nextLink"] ?? null;
  }
  return results;
}

router.get("/m365/teams", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-teams", async () => {
      const [teams, activityCsv, deviceCsv] = await Promise.all([
        fetchAllPages(
          "https://graph.microsoft.com/v1.0/teams?$select=id,displayName,visibility,isArchived&$top=999"
        ),
        fetchReportCsv(
          "https://graph.microsoft.com/v1.0/reports/getTeamsUserActivityCounts(period='D30')"
        ),
        fetchReportCsv(
          "https://graph.microsoft.com/v1.0/reports/getTeamsDeviceUsageUserCounts(period='D30')"
        ),
      ]);

      const activityRows = parseCsv(activityCsv);
      const deviceRows = parseCsv(deviceCsv);

      let totalTeams = teams.length;
      let activeTeams = 0;
      let privateTeams = 0;
      let publicTeams = 0;
      let archivedTeams = 0;

      const memberCountMap: Record<string, number> = {};
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
      let activeUsersSet = new Set<string>();

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
      const uniqueDays = new Set<string>();
      const windowsUsersPerDay: Record<string, number> = {};
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
            windows + mac + web + ios + android
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
      };
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 Teams data");
    res.status(500).json({ error: "Failed to fetch M365 Teams data" });
  }
});

export default router;
