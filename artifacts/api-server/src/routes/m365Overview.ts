import { Router } from "express";
import { getCached } from "../lib/graphClient.js";
import {
  fetchAllGraphPages,
  fetchGraphJson,
  isPermissionIssue,
  type CollectionIssue,
} from "../lib/collectionIssues.js";
import { withMetadata, type FieldMetadataMap } from "../lib/metadata.js";

const router = Router();

async function getOverviewData() {
  const [orgData, usersData, subsData, secScoreData, mfaData, healthData] =
    await Promise.all([
      fetchGraphJson<any>(
        "https://graph.microsoft.com/v1.0/organization?$select=displayName,id",
        "organization",
      ),
      fetchAllGraphPages<any>(
        "https://graph.microsoft.com/v1.0/users?$select=id,accountEnabled,userType&$top=999",
        "users",
      ),
      fetchGraphJson<any>(
        "https://graph.microsoft.com/v1.0/subscribedSkus",
        "subscribedSkus",
      ),
      fetchGraphJson<any>(
        "https://graph.microsoft.com/v1.0/security/secureScores?$top=1",
        "secureScores",
      ),
      fetchAllGraphPages<any>(
        "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails?$select=id,isMfaRegistered&$top=999",
        "userRegistrationDetails",
      ),
      fetchGraphJson<any>(
        "https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/healthOverviews",
        "serviceHealthOverviews",
      ),
    ]);

  const collectionIssues: CollectionIssue[] = [];
  if (orgData.issue) collectionIssues.push(orgData.issue);
  collectionIssues.push(...usersData.issues);
  if (subsData.issue) collectionIssues.push(subsData.issue);
  if (secScoreData.issue) collectionIssues.push(secScoreData.issue);
  collectionIssues.push(...mfaData.issues);
  if (healthData.issue) collectionIssues.push(healthData.issue);

  const org = orgData.data?.value?.[0] ?? null;
  const rawUsers: any[] = usersData.items;
  const subs: any[] = subsData.data?.value ?? [];
  const secScore = secScoreData.data?.value?.[0] ?? null;
  const mfaUsers: any[] = mfaData.items;
  const services: any[] = healthData.data?.value ?? [];

  const totalUsers = rawUsers.length;
  let activeUsers = 0;
  let guestUsers = 0;
  let disabledUsers = 0;

  for (const u of rawUsers) {
    if (u.userType === "Guest") guestUsers++;
    if (!u.accountEnabled) disabledUsers++;
    else if (u.userType !== "Guest") activeUsers++;
  }

  let totalLicenses = 0;
  let assignedLicenses = 0;
  for (const sku of subs) {
    totalLicenses += sku.prepaidUnits?.enabled ?? 0;
    assignedLicenses += sku.consumedUnits ?? 0;
  }

  const secureScore = secScore?.currentScore ?? 0;
  const secureScoreMax = secScore?.maxScore ?? 100;

  const mfaEnabledCount = mfaUsers.filter((u: any) => u.isMfaRegistered).length;
  const mfaEnabledPercent =
    mfaUsers.length > 0 ? Math.round((mfaEnabledCount / mfaUsers.length) * 100) : 0;

  const totalServices = services.length;
  const activeServices = services.filter(
    (s: any) => s.status === "serviceOperational",
  ).length;

  return {
    tenantName: org?.displayName ?? "Unknown Tenant",
    tenantId: org?.id ?? "",
    totalUsers,
    activeUsers,
    totalLicenses,
    assignedLicenses,
    mfaEnabledPercent,
    secureScore,
    secureScoreMax,
    guestUsers,
    disabledUsers,
    activeServices,
    totalServices,
    partialData: collectionIssues.length > 0,
    permissionError: collectionIssues.some(isPermissionIssue),
    collectionIssues,
  };
}

router.get("/m365/overview", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-overview", getOverviewData);

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 overview");
    res.status(500).json({ error: "Failed to fetch M365 overview" });
  }
});

router.get("/m365/overview/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-overview", getOverviewData);

    const fieldMetadata: FieldMetadataMap = {
      tenantName: {
        evidenceStatus: "apiBacked",
        confidenceLabel: "high",
        sourceLabel: "Microsoft Graph organization",
      },
      tenantId: {
        evidenceStatus: "apiBacked",
        confidenceLabel: "high",
        sourceLabel: "Microsoft Graph organization",
      },
      totalUsers: {
        evidenceStatus: "apiBacked",
        confidenceLabel: "high",
        sourceLabel: "Microsoft Graph users",
      },
      activeUsers: {
        evidenceStatus: "apiBacked",
        confidenceLabel: "high",
        sourceLabel: "Microsoft Graph users",
        notes: ["Calculated from Graph users by filtering disabled and guest users."],
      },
      totalLicenses: {
        evidenceStatus: "apiBacked",
        confidenceLabel: "high",
        sourceLabel: "Microsoft Graph subscribedSkus",
      },
      assignedLicenses: {
        evidenceStatus: "apiBacked",
        confidenceLabel: "high",
        sourceLabel: "Microsoft Graph subscribedSkus",
      },
      mfaEnabledPercent: {
        evidenceStatus: "partial",
        confidenceLabel: "medium",
        sourceLabel: "Graph userRegistrationDetails",
        notes: [
          "Computed from registration details report; result depends on report availability and scope coverage.",
        ],
      },
      secureScore: {
        evidenceStatus: "apiBacked",
        confidenceLabel: "high",
        sourceLabel: "Microsoft Graph secureScores",
      },
      secureScoreMax: {
        evidenceStatus: "apiBacked",
        confidenceLabel: "high",
        sourceLabel: "Microsoft Graph secureScores",
      },
      guestUsers: {
        evidenceStatus: "apiBacked",
        confidenceLabel: "high",
        sourceLabel: "Microsoft Graph users",
        notes: ["Calculated by filtering users with userType Guest."],
      },
      disabledUsers: {
        evidenceStatus: "apiBacked",
        confidenceLabel: "high",
        sourceLabel: "Microsoft Graph users",
        notes: ["Calculated by filtering users with accountEnabled=false."],
      },
      activeServices: {
        evidenceStatus: "partial",
        confidenceLabel: "medium",
        sourceLabel: "Microsoft Graph serviceAnnouncement/healthOverviews",
        notes: [
          "Derived from service health statuses and defaults to 0 if service health API is unavailable.",
        ],
      },
      totalServices: {
        evidenceStatus: "partial",
        confidenceLabel: "medium",
        sourceLabel: "Microsoft Graph serviceAnnouncement/healthOverviews",
        notes: ["Depends on service health API availability."],
      },
      partialData: {
        evidenceStatus: "apiBacked",
        confidenceLabel: "high",
        sourceLabel: "Route diagnostics",
        notes: ["True when one or more upstream collection calls failed."],
      },
      permissionError: {
        evidenceStatus: "apiBacked",
        confidenceLabel: "high",
        sourceLabel: "Route diagnostics",
        notes: ["True when collection issues include permission-related failures."],
      },
      collectionIssues: {
        evidenceStatus: "apiBacked",
        confidenceLabel: "high",
        sourceLabel: "Route diagnostics",
        notes: ["Per-source issue details for failed Graph collection calls."],
      },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 overview metadata");
    res.status(500).json({ error: "Failed to fetch M365 overview metadata" });
  }
});

export default router;
