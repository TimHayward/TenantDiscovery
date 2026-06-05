import {
  fetchAllGraphPages,
  fetchGraphText,
  isPermissionIssue,
  type CollectionIssue,
} from "../collectionIssues.js";

function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/\r/g, ""));
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim().replace(/\r/g, ""));
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });
}

function isLikelyGuid(value: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ||
    /^[0-9a-f]{32}$/i.test(value)
  );
}

async function pLimit<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  if (tasks.length === 0) return [];
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex++;
      if (current >= tasks.length) return;
      results[current] = await tasks[current]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}

type TeamUserRef = { id?: string; userType?: string };

export async function collectTeams() {
  const [teamsResult, activityCsvResult, deviceCsvResult, teamActivityDetailCsvResult] = await Promise.all([
    fetchAllGraphPages<any>("https://graph.microsoft.com/v1.0/teams?$select=id,displayName,visibility,isArchived&$top=999", "teams"),
    fetchGraphText("https://graph.microsoft.com/v1.0/reports/getTeamsUserActivityCounts(period='D30')", "teamsUserActivityReport"),
    fetchGraphText("https://graph.microsoft.com/v1.0/reports/getTeamsDeviceUsageUserCounts(period='D30')", "teamsDeviceUsageReport"),
    fetchGraphText("https://graph.microsoft.com/v1.0/reports/getTeamsTeamActivityDetail(period='D30')", "teamsTeamActivityDetailReport"),
  ]);

  const collectionIssues: CollectionIssue[] = [];
  collectionIssues.push(...teamsResult.issues);
  if (activityCsvResult.issue) collectionIssues.push(activityCsvResult.issue);
  if (deviceCsvResult.issue) collectionIssues.push(deviceCsvResult.issue);
  if (teamActivityDetailCsvResult.issue) collectionIssues.push(teamActivityDetailCsvResult.issue);

  const teams = teamsResult.items;
  const activityRows = parseCsv(activityCsvResult.text ?? "");
  const deviceRows = parseCsv(deviceCsvResult.text ?? "");
  const teamActivityDetailRows = parseCsv(teamActivityDetailCsvResult.text ?? "");

  const totalTeams = teams.length;
  let activeTeams = 0, privateTeams = 0, publicTeams = 0, archivedTeams = 0;

  const sizeRanges = [
    { label: "1-5 members", min: 1, max: 5 },
    { label: "6-20 members", min: 6, max: 20 },
    { label: "21-50 members", min: 21, max: 50 },
    { label: "51-100 members", min: 51, max: 100 },
    { label: "100+ members", min: 101, max: Infinity },
  ];
  const sizeBreakdown = sizeRanges.map(() => ({ count: 0, totalTeamSize: 0, owners: 0, members: 0, guests: 0 }));

  for (const t of teams) {
    if (t.isArchived) archivedTeams++; else activeTeams++;
    const vis = (t.visibility ?? "").toLowerCase();
    if (vis === "private") privateTeams++; else publicTeams++;
  }

  const memberCountTasks = teams
    .filter((t: any) => typeof t.id === "string" && t.id.length > 0)
    .map((t: any) => async () => {
      const teamId = t.id as string;
      const [membersResult, ownersResult] = await Promise.all([
        fetchAllGraphPages<TeamUserRef>(`https://graph.microsoft.com/v1.0/groups/${teamId}/transitiveMembers/microsoft.graph.user?$select=id,userType&$top=999`, `teamMembers:${teamId}`),
        fetchAllGraphPages<TeamUserRef>(`https://graph.microsoft.com/v1.0/groups/${teamId}/owners/microsoft.graph.user?$select=id,userType&$top=999`, `teamOwners:${teamId}`),
      ]);
      const ownerIds = new Set<string>();
      const memberIds = new Set<string>();
      const guestIds = new Set<string>();
      for (const member of membersResult.items) {
        if (member.id) { memberIds.add(member.id); if ((member.userType ?? "").toLowerCase() === "guest") guestIds.add(member.id); }
      }
      for (const owner of ownersResult.items) {
        if (owner.id) { ownerIds.add(owner.id); if ((owner.userType ?? "").toLowerCase() === "guest") guestIds.add(owner.id); }
      }
      const totalUserIds = new Set<string>([...memberIds, ...ownerIds]);
      const memberOnlyCount = Array.from(memberIds).filter((id) => !ownerIds.has(id)).length;
      return { totalTeamSize: totalUserIds.size, owners: ownerIds.size, members: memberOnlyCount, guests: guestIds.size, issues: [...membersResult.issues, ...ownersResult.issues] };
    });

  const memberCountResults = await pLimit(memberCountTasks, 8);
  for (const result of memberCountResults) {
    if (result.issues.length > 0) collectionIssues.push(...result.issues);
    if (result.totalTeamSize <= 0) continue;
    const bucketIndex = sizeRanges.findIndex((range) => result.totalTeamSize >= range.min && result.totalTeamSize <= range.max);
    if (bucketIndex >= 0) {
      sizeBreakdown[bucketIndex].count += 1;
      sizeBreakdown[bucketIndex].totalTeamSize += result.totalTeamSize;
      sizeBreakdown[bucketIndex].owners += result.owners;
      sizeBreakdown[bucketIndex].members += result.members;
      sizeBreakdown[bucketIndex].guests += result.guests;
    }
  }

  let meetingsOrganizedLast30Days = 0, callsLast30Days = 0, messagesLast30Days = 0;
  for (const row of activityRows) {
    messagesLast30Days += (parseInt(row["Team Chat Messages"] ?? "0", 10) || 0) + (parseInt(row["Private Chat Messages"] ?? "0", 10) || 0) + (parseInt(row["Post Messages"] ?? "0", 10) || 0);
    callsLast30Days += parseInt(row["Calls"] ?? "0", 10) || 0;
    meetingsOrganizedLast30Days += parseInt(row["Meetings Organized Count"] ?? "0", 10) || 0;
  }

  let activeUsersLast30Days = 0;
  for (const row of deviceRows) {
    if (row["Report Date"]) {
      const total = (parseInt(row["Windows"] ?? "0", 10) || 0) + (parseInt(row["Mac"] ?? "0", 10) || 0) + (parseInt(row["Web"] ?? "0", 10) || 0) + (parseInt(row["iOS"] ?? "0", 10) || 0) + (parseInt(row["Android Phone"] ?? "0", 10) || 0);
      activeUsersLast30Days = Math.max(activeUsersLast30Days, total);
    }
  }

  const teamDisplayNameById = new Map<string, string>();
  for (const t of teams) { if (t.id && t.displayName) teamDisplayNameById.set(t.id, t.displayName); }

  const topTeams = teamActivityDetailRows
    .filter((row) => row["Is Deleted"] !== "Yes")
    .map((row) => {
      const teamId = row["Team Id"] ?? "";
      const reportTeamName = row["Team Name"] ?? "";
      const mappedName = teamDisplayNameById.get(teamId);
      const teamName = reportTeamName && !isLikelyGuid(reportTeamName) ? reportTeamName : (mappedName ?? reportTeamName) || teamId;
      return {
        teamId, teamName, lastActivityDate: row["Last Activity Date"] || null,
        activeUsers: parseInt(row["Active Users"] ?? "0", 10) || 0,
        activeChannels: parseInt(row["Active Channels"] ?? "0", 10) || 0,
        messages: parseInt(row["Messages"] ?? "0", 10) || 0,
        urgentMessages: parseInt(row["Urgent Messages"] ?? "0", 10) || 0,
        reactions: parseInt(row["Reactions"] ?? "0", 10) || 0,
        meetingsOrganized: parseInt(row["Meetings Organized"] ?? "0", 10) || 0,
        guests: parseInt(row["Guests"] ?? "0", 10) || 0,
      };
    })
    .sort((a, b) => b.messages - a.messages)
    .slice(0, 25);

  return {
    totalTeams, activeTeams, privateTeams, publicTeams, archivedTeams,
    totalChannels: 0, activeUsersLast30Days, meetingsOrganizedLast30Days, callsLast30Days, messagesLast30Days,
    guestAccessEnabled: true, externalAccessEnabled: true,
    teamsBySize: sizeRanges.map((r, i) => ({ range: r.label, ...sizeBreakdown[i] })),
    topTeams,
    partialData: collectionIssues.length > 0,
    permissionError: collectionIssues.some(isPermissionIssue),
    collectionIssues,
  };
}
