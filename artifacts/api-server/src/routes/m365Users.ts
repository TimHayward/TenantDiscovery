import { Router } from "express";
import { withMetadata } from "../lib/metadata.js";
import { getOrFetch } from "../lib/metricStore.js";
import { collectUsers } from "../lib/collectors/users.js";

const router = Router();

router.get("/m365/users", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-users", collectUsers);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 users");
    res.status(500).json({ error: "Failed to fetch M365 users" });
  }
});

router.get("/m365/users/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-users", collectUsers);

    const fieldMetadata = {
      totalUsers: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "User.Read.All", notes: ["Total count from Microsoft Graph users collection"] },
      activeUsers: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "User.Read.All", notes: ["Computed from accountEnabled users"] },
      disabledUsers: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "User.Read.All", notes: ["Computed from accountEnabled=false users"] },
      guestUsers: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "User.Read.All", notes: ["Computed from userType=Guest users"] },
      memberUsers: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "User.Read.All", notes: ["Computed from non-Guest users"] },
      mfaEnabled: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All", notes: ["Count from authentication methods user registration report"] },
      mfaDisabled: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All", notes: ["Computed from users without MFA registration"] },
      neverSignedIn: { evidenceStatus: "partial" as const, confidenceLabel: "medium" as const, sourceLabel: "AuditLog.Read.All", notes: ["Depends on signInActivity availability and retention"] },
      usersByDepartment: { evidenceStatus: "apiBacked" as const, confidenceLabel: "medium" as const, sourceLabel: "User.Read.All", notes: ["Derived from department attribute which may be unassigned"] },
      users: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "User.Read.All", notes: ["Detailed user list from Graph users endpoint"] },
      partialData: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when one or more upstream collection calls failed"] },
      permissionError: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["True when collection issues include permission-related failures"] },
      collectionIssues: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Route diagnostics", notes: ["Per-source issue details for failed Graph collection calls"] },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 users with metadata");
    res.status(500).json({ error: "Failed to fetch M365 users" });
  }
});

export default router;
