import { Router } from "express";
import {
  createCollectionIssue,
  isPermissionIssue,
} from "../lib/collectionIssues.js";
import { withMetadata } from "../lib/metadata.js";
import { getOrFetch } from "../lib/metricStore.js";
import { collectSecurity, collectSecurityEstate } from "../lib/collectors/security.js";

const router = Router();

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected route processing error";
}

function getErrorStatus(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number") return statusCode;
  }
  return null;
}

router.get("/m365/security", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-security", collectSecurity);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 security data");
    const fallbackIssue = createCollectionIssue("securityRoute", getErrorStatus(err), getErrorMessage(err));
    res.status(200).json({
      secureScore: 0, secureScoreMax: 100, secureScorePercent: 0,
      mfaEnabledUsers: 0, mfaDisabledUsers: 0, mfaEnabledPercent: 0,
      conditionalAccessPolicies: 0, enabledCAPs: 0, disabledCAPs: 0, reportOnlyCAPs: 0,
      secureScoreHistory: [], controlCategories: [], caPolicies: [], riskyUsers: 0,
      adminsWithoutMfa: 0, mfaUsersList: [], mfaMethodsBreakdown: [], riskDetectionTimeline: [],
      riskyUsersDetail: [], secureScoreControls: [], legacyAuthSignInCount: null,
      legacyAuthBlockedByCA: false, partialData: true,
      permissionError: isPermissionIssue(fallbackIssue), collectionIssues: [fallbackIssue],
    });
  }
});

router.get("/m365/security/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-security", collectSecurity);

    const fieldMetadata = {
      secureScore: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "SecurityEvents.Read.All" },
      secureScorePercent: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Derived from secure score current/max" },
      mfaEnabledUsers: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All" },
      mfaDisabledUsers: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All" },
      conditionalAccessPolicies: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Policy.Read.All" },
      caPolicies: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Identity conditional access policies" },
      secureScoreHistory: { evidenceStatus: "apiBacked" as const, confidenceLabel: "medium" as const, sourceLabel: "Security secure score snapshots" },
      riskDetectionTimeline: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "Identity Protection detections" },
      riskyUsersDetail: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "Identity Protection risky users" },
      secureScoreControls: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Secure score controlScores" },
      partialData: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when one or more upstream collection calls failed"] },
      permissionError: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when collection issues include permission-related failures"] },
      collectionIssues: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["Per-source issue details for failed Graph collection calls"] },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 security data with metadata");
    res.status(500).json({ error: "Failed to fetch M365 security data" });
  }
});

router.get("/m365/security/estate", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-security-estate", collectSecurityEstate);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 security estate data");
    res.status(500).json({ error: "Failed to fetch M365 security estate data" });
  }
});

router.get("/m365/security/estate/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-security-estate", collectSecurityEstate);

    const fieldMetadata = {
      deviceSummary: { evidenceStatus: "apiBacked" as const, confidenceLabel: "medium" as const, sourceLabel: "Graph devices + Intune managedDevices + Defender machines" },
      deviceList: { evidenceStatus: "apiBacked" as const, confidenceLabel: "medium" as const, sourceLabel: "Merged device inventory" },
      mdeDeviceInventory: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "Defender for Endpoint machines API" },
      mdeStatus: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Defender machine API status and diagnostics" },
      defenderEndpointAlerts: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Graph security alerts_v2 filtered to Defender for Endpoint" },
      incidentAlert30dSummary: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Graph security incidents + alerts_v2 from last 30 days" },
      saasApps: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Service principals inventory" },
      oauthApps: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "OAuth2 permission grants" },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 security estate data with metadata");
    res.status(500).json({ error: "Failed to fetch M365 security estate data" });
  }
});

export default router;
