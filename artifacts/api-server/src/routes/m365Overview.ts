import { Router } from "express";
import { graphClient, getCached } from "../lib/graphClient.js";

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

router.get("/m365/overview", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-overview", async () => {
      const [orgData, usersData, subsData, secScoreData, mfaData, healthData] =
        await Promise.all([
          fetchWithToken(
            "https://graph.microsoft.com/v1.0/organization?$select=displayName,id"
          ),
          fetchAllPages(
            "https://graph.microsoft.com/v1.0/users?$select=id,accountEnabled,userType&$top=999"
          ),
          fetchWithToken("https://graph.microsoft.com/v1.0/subscribedSkus"),
          fetchWithToken(
            "https://graph.microsoft.com/v1.0/security/secureScores?$top=1"
          ),
          fetchAllPages(
            "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails?$select=id,isMfaRegistered&$top=999"
          ),
          fetchWithToken(
            "https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/healthOverviews"
          ).catch(() => null),
        ]);

      const org = orgData?.value?.[0] ?? null;
      const rawUsers: any[] = usersData ?? [];
      const subs: any[] = subsData?.value ?? [];
      const secScore = secScoreData?.value?.[0] ?? null;
      const mfaUsers: any[] = mfaData ?? [];
      const services: any[] = healthData?.value ?? [];

      let totalUsers = rawUsers.length;
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
        mfaUsers.length > 0
          ? Math.round((mfaEnabledCount / mfaUsers.length) * 100)
          : 0;

      const totalServices = services.length;
      const activeServices = services.filter(
        (s: any) => s.status === "serviceOperational"
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
      };
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 overview");
    res.status(500).json({ error: "Failed to fetch M365 overview" });
  }
});

export default router;
