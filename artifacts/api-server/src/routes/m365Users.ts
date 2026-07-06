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

    // Sign-in-derived metrics degrade based on where the last-activity data
    // actually came from for this tenant (Graph signInActivity vs. usage-report
    // fallback vs. nothing) — not a fixed hardcoded confidence.
    const signInMeta = (() => {
      switch (data.signInDataSource) {
        case "graphAuditLog":
          return { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "AuditLog.Read.All", notes: ["From Graph signInActivity (interactive/non-interactive sign-ins)"] };
        case "usageReportFallback":
          return { evidenceStatus: "partial" as const, confidenceLabel: "low" as const, sourceLabel: "Reports.Read.All (usage activity fallback)", notes: ["AuditLog.Read.All unavailable; derived from M365 usage activity reports, which reflect service usage rather than authentication events and can undercount silent users"] };
        default:
          return { evidenceStatus: "notAssessed" as const, confidenceLabel: "unknown" as const, sourceLabel: "AuditLog.Read.All", notes: ["Neither Graph signInActivity nor usage activity reports were available; sign-in-based counts cannot be assessed"] };
      }
    })();

    // MFA registration numbers become unknown (not a fabricated 0%) when the
    // registration report is unavailable.
    const mfaMeta = data.mfaDataSource === "unavailable"
      ? { evidenceStatus: "notAssessed" as const, confidenceLabel: "unknown" as const, sourceLabel: "Reports.Read.All", notes: [`Per-user MFA registration report unavailable; tenant-wide enforcement signal: ${data.mfaEnforcementSignal}`] }
      : { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All", notes: ["Count from authentication methods user registration report"] };

    const fieldMetadata = {
      totalUsers: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "User.Read.All", notes: ["Total count from Microsoft Graph users collection"] },
      activeUsers: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "User.Read.All", notes: ["Computed from accountEnabled users"] },
      disabledUsers: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "User.Read.All", notes: ["Computed from accountEnabled=false users"] },
      guestUsers: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "User.Read.All", notes: ["Computed from userType=Guest users"] },
      memberUsers: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "User.Read.All", notes: ["Computed from non-Guest users"] },
      mfaEnabled: mfaMeta,
      mfaDisabled: mfaMeta,
      neverSignedIn: signInMeta,
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
