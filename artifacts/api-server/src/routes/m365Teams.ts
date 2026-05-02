import { Router } from "express";
import { graphClient, getCached } from "../lib/graphClient.js";

const router = Router();

router.get("/m365/teams", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-teams", async () => {
      const [teamsRes, teamsActivityRes, teamsSettingsRes] = await Promise.allSettled([
        graphClient.api("/groups")
          .filter("resourceProvisioningOptions/Any(x:x eq 'Team')")
          .select("id,displayName,visibility,isArchived")
          .top(999)
          .get(),
        graphClient.api("/reports/getTeamsUserActivityCounts(period='D30')").header("Accept", "application/json").get(),
        graphClient.api("/teamwork").get(),
      ]);

      const teams = teamsRes.status === "fulfilled" ? teamsRes.value?.value ?? [] : [];
      const activityRows = teamsActivityRes.status === "fulfilled" ? teamsActivityRes.value?.value ?? [] : [];
      const teamsSettings = teamsSettingsRes.status === "fulfilled" ? teamsSettingsRes.value : null;

      let totalTeams = teams.length;
      let activeTeams = 0;
      let privateTeams = 0;
      let publicTeams = 0;
      let archivedTeams = 0;
      let totalChannels = 0;

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
        if ((t.visibility ?? "").toLowerCase() === "private") privateTeams++;
        else publicTeams++;
      }

      let meetingsOrganizedLast30Days = 0;
      let callsLast30Days = 0;
      let messagesLast30Days = 0;
      let activeUsersLast30Days = 0;

      for (const row of activityRows) {
        meetingsOrganizedLast30Days += row.teamChatMessages ?? 0;
        callsLast30Days += row.calls ?? 0;
        messagesLast30Days += row.teamChatMessages ?? 0;
        if ((row.teamChatMessages ?? 0) > 0 || (row.calls ?? 0) > 0) {
          activeUsersLast30Days++;
        }
      }

      let channelRes: any;
      try {
        channelRes = await graphClient.api("/reports/getTeamsDeviceUsageUserDetail(period='D30')").header("Accept", "application/json").get();
        totalChannels = channelRes?.value?.length ?? 0;
      } catch {
        totalChannels = 0;
      }

      const guestAccessEnabled = teamsSettings?.teamsAppSettings?.isUserPersonalScopeResourceSpecificConsentEnabled ?? true;
      const externalAccessEnabled = true;

      return {
        totalTeams,
        activeTeams,
        privateTeams,
        publicTeams,
        archivedTeams,
        totalChannels,
        activeUsersLast30Days,
        meetingsOrganizedLast30Days,
        callsLast30Days,
        messagesLast30Days,
        guestAccessEnabled,
        externalAccessEnabled,
        teamsBySize: sizeRanges.map((r, i) => ({ range: r.label, count: sizeCounts[i] })),
      };
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 Teams data");
    res.status(500).json({ error: "Failed to fetch M365 Teams data" });
  }
});

export default router;
