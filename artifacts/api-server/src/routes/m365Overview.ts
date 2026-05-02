import { Router } from "express";
import { graphClient, getCached } from "../lib/graphClient.js";

const router = Router();

router.get("/m365/overview", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-overview", async () => {
      const [orgRes, usersRes, subsRes, secScoreRes] = await Promise.allSettled([
        graphClient.api("/organization").select("displayName,id").get(),
        graphClient.api("/users").select("id,accountEnabled,userType").count(true).header("ConsistencyLevel", "eventual").get(),
        graphClient.api("/subscribedSkus").get(),
        graphClient.api("/security/secureScores").top(1).get(),
      ]);

      const org = orgRes.status === "fulfilled" ? orgRes.value?.value?.[0] : null;
      const usersData = usersRes.status === "fulfilled" ? usersRes.value : null;
      const subs = subsRes.status === "fulfilled" ? subsRes.value?.value ?? [] : [];
      const secScore = secScoreRes.status === "fulfilled" ? secScoreRes.value?.value?.[0] : null;

      let totalUsers = 0;
      let activeUsers = 0;
      let guestUsers = 0;
      let disabledUsers = 0;

      if (usersData?.value) {
        totalUsers = usersData["@odata.count"] ?? usersData.value.length;
        for (const u of usersData.value) {
          if (u.userType === "Guest") guestUsers++;
          if (!u.accountEnabled) disabledUsers++;
        }
        activeUsers = totalUsers - disabledUsers - guestUsers;
      }

      let totalLicenses = 0;
      let assignedLicenses = 0;
      for (const sku of subs) {
        totalLicenses += sku.prepaidUnits?.enabled ?? 0;
        assignedLicenses += sku.consumedUnits ?? 0;
      }

      const secureScore = secScore?.currentScore ?? 0;
      const secureScoreMax = secScore?.maxScore ?? 100;

      let mfaEnabledPercent = 0;
      try {
        const mfaRes = await graphClient
          .api("/reports/authenticationMethods/userRegistrationDetails")
          .filter("isMfaRegistered eq true")
          .count(true)
          .header("ConsistencyLevel", "eventual")
          .get();
        const mfaCount = mfaRes?.["@odata.count"] ?? 0;
        mfaEnabledPercent = totalUsers > 0 ? Math.round((mfaCount / totalUsers) * 100) : 0;
      } catch {
        mfaEnabledPercent = 0;
      }

      let activeServices = 0;
      let totalServices = 0;
      try {
        const healthRes = await graphClient.api("/admin/serviceAnnouncement/healthOverviews").get();
        const services = healthRes?.value ?? [];
        totalServices = services.length;
        activeServices = services.filter((s: any) => s.status === "serviceOperational").length;
      } catch {
        totalServices = 0;
        activeServices = 0;
      }

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
