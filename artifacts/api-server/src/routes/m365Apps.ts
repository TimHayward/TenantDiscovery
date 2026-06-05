import { Router } from "express";
import { withMetadata } from "../lib/metadata.js";
import { getOrFetch } from "../lib/metricStore.js";
import { collectApps } from "../lib/collectors/apps.js";

const router = Router();

router.get("/m365/apps", async (req, res) => {
  try {
    const result = await getOrFetch("m365-apps", collectApps);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch enterprise apps");
    res.status(500).json({ error: "Failed to fetch enterprise apps" });
  }
});

router.get("/m365/apps/with-metadata", async (req, res) => {
  try {
    const data = await getOrFetch("m365-apps", collectApps);

    const fieldMetadata = {
      totalApps: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Application.Read.All" },
      appsWithNoOwner: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Derived from application owners expansion" },
      appsWithHighRisk: { evidenceStatus: "apiBacked" as const, confidenceLabel: "medium" as const, sourceLabel: "Derived from high-risk scopes and configuration factors" },
      appsWithExpiredCredentials: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Application credential expiration dates" },
      appsWithLongLivedSecrets: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Application secret lifespan analysis" },
      multiTenantApps: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "signInAudience" },
      usersCanRegisterApps: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Authorization policy" },
      permissionError: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "HTTP status from Graph applications endpoint" },
      apps: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Application inventory with owners, credentials, and permissions" },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch enterprise apps with metadata");
    res.status(500).json({ error: "Failed to fetch enterprise apps" });
  }
});

export default router;
