import { Router } from "express";
import { graphClient, getCached } from "../lib/graphClient.js";
import {
  createCollectionIssue,
  isPermissionIssue,
  type CollectionIssue,
} from "../lib/collectionIssues.js";
import { withMetadata } from "../lib/metadata.js";

const router = Router();

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected Graph client error";
}

function getErrorStatus(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number") return statusCode;
  }
  return null;
}

async function getLicensesData() {
  return getCached("m365-licenses", async () => {
    const collectionIssues: CollectionIssue[] = [];
    const result = await graphClient.api("/subscribedSkus").get().catch((error: unknown) => {
      collectionIssues.push(
        createCollectionIssue(
          "subscribedSkus",
          getErrorStatus(error),
          getErrorMessage(error),
        ),
      );
      return null;
    });

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
      partialData: collectionIssues.length > 0,
      permissionError: collectionIssues.some(isPermissionIssue),
      collectionIssues,
    };
  });
}

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
    const data = await getLicensesData();

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 licenses");
    res.status(500).json({ error: "Failed to fetch M365 licenses" });
  }
});

router.get("/m365/licenses/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getLicensesData();

    const fieldMetadata = {
      totalLicenses: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Organization.Read.All",
        notes: ["Sum of all subscribed SKU prepaid units (enabled). Source: Graph /subscribedSkus"]
      },
      assignedLicenses: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Organization.Read.All",
        notes: ["Sum of all consumed units across SKUs. Source: Graph /subscribedSkus"]
      },
      availableLicenses: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Organization.Read.All",
        notes: ["Calculated as total - assigned. Direct measurement."]
      },
      utilizationPercent: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Organization.Read.All",
        notes: ["Percentage of assigned / total licenses. Direct calculation from API metrics."]
      },
      partialData: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
        notes: ["True when one or more upstream collection calls failed"]
      },
      permissionError: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
        notes: ["True when collection issues include permission-related failures"]
      },
      collectionIssues: {
        evidenceStatus: "apiBacked" as const,
        confidenceLabel: "high" as const,
        sourceLabel: "Route diagnostics",
        notes: ["Per-source issue details for failed Graph collection calls"]
      },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 licenses with metadata");
    res.status(500).json({ error: "Failed to fetch M365 licenses" });
  }
});

export default router;
