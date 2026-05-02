import { Router } from "express";
import { graphClient, getCached } from "../lib/graphClient.js";

const router = Router();

const SKU_FRIENDLY_NAMES: Record<string, string> = {
  "ENTERPRISEPREMIUM": "Microsoft 365 E5",
  "ENTERPRISEPACK": "Microsoft 365 E3",
  "SPE_E3": "Microsoft 365 E3",
  "SPE_E5": "Microsoft 365 E5",
  "BUSINESS_PREMIUM": "Microsoft 365 Business Premium",
  "SMB_BUSINESS_PREMIUM": "Microsoft 365 Business Premium",
  "EXCHANGESTANDARD": "Exchange Online Plan 1",
  "EXCHANGEENTERPRISE": "Exchange Online Plan 2",
  "TEAMS_EXPLORATORY": "Teams Exploratory",
  "MCOSTANDARD": "Skype for Business Online",
  "POWER_BI_PRO": "Power BI Pro",
  "POWER_BI_STANDARD": "Power BI (Free)",
  "PROJECTPREMIUM": "Project Plan 5",
  "PROJECTPROFESSIONAL": "Project Plan 3",
  "VISIOCLIENT": "Visio Plan 2",
  "FLOW_FREE": "Power Automate Free",
  "POWERAPPS_DEV": "PowerApps Developer",
  "INTUNE_A": "Intune",
  "AAD_PREMIUM": "Azure AD Premium P1",
  "AAD_PREMIUM_P2": "Azure AD Premium P2",
  "EMS": "Enterprise Mobility + Security E3",
  "EMSPREMIUM": "Enterprise Mobility + Security E5",
};

router.get("/m365/licenses", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-licenses", async () => {
      const result = await graphClient.api("/subscribedSkus").get();
      const skus = result?.value ?? [];

      let totalLicenses = 0;
      let assignedLicenses = 0;
      let availableLicenses = 0;

      const licenses = skus.map((sku: any) => {
        const total = sku.prepaidUnits?.enabled ?? 0;
        const assigned = sku.consumedUnits ?? 0;
        const available = Math.max(0, total - assigned);
        const suspended = sku.prepaidUnits?.suspended ?? 0;
        const warning = sku.prepaidUnits?.warning ?? 0;

        totalLicenses += total;
        assignedLicenses += assigned;
        availableLicenses += available;

        const skuPartNumber = sku.skuPartNumber ?? "";
        const displayName = SKU_FRIENDLY_NAMES[skuPartNumber] ?? skuPartNumber.replace(/_/g, " ");

        return {
          skuId: sku.skuId,
          skuPartNumber,
          displayName,
          total,
          assigned,
          available,
          suspended,
          warning,
        };
      });

      const utilizationPercent = totalLicenses > 0
        ? Math.round((assignedLicenses / totalLicenses) * 100)
        : 0;

      return {
        totalLicenses,
        assignedLicenses,
        availableLicenses,
        utilizationPercent,
        licenses: licenses.sort((a: any, b: any) => b.total - a.total),
      };
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 licenses");
    res.status(500).json({ error: "Failed to fetch M365 licenses" });
  }
});

export default router;
