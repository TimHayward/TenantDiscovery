import { Router } from "express";
import { getCached } from "../lib/graphClient.js";

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

router.get("/m365/users", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-users", async () => {
      const [rawUsers, mfaUsers] = await Promise.all([
        fetchAllPages(
          "https://graph.microsoft.com/v1.0/users" +
            "?$select=id,displayName,userPrincipalName,accountEnabled,userType,signInActivity,assignedLicenses,department,jobTitle" +
            "&$top=999"
        ),
        fetchAllPages(
          "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails" +
            "?$select=id,isMfaRegistered&$top=999"
        ),
      ]);

      const mfaMap = new Map<string, boolean>();
      for (const m of mfaUsers) {
        mfaMap.set(m.id, m.isMfaRegistered ?? false);
      }

      let totalUsers = rawUsers.length;
      let activeUsers = 0;
      let disabledUsers = 0;
      let guestUsers = 0;
      let memberUsers = 0;
      let mfaEnabled = 0;
      let mfaDisabled = 0;
      let neverSignedIn = 0;

      const deptMap = new Map<string, number>();

      const users = rawUsers.map((u: any) => {
        const isMfa = mfaMap.get(u.id) ?? false;
        if (u.accountEnabled) activeUsers++;
        else disabledUsers++;
        if (u.userType === "Guest") guestUsers++;
        else memberUsers++;
        if (isMfa) mfaEnabled++;
        else mfaDisabled++;

        const lastSignIn =
          u.signInActivity?.lastSignInDateTime ??
          u.signInActivity?.lastNonInteractiveSignInDateTime ??
          null;
        if (!lastSignIn) neverSignedIn++;

        const dept = u.department ?? "Unassigned";
        deptMap.set(dept, (deptMap.get(dept) ?? 0) + 1);

        return {
          id: u.id,
          displayName: u.displayName ?? "",
          userPrincipalName: u.userPrincipalName ?? "",
          accountEnabled: u.accountEnabled ?? false,
          userType: u.userType ?? "Member",
          mfaEnabled: isMfa,
          lastSignIn,
          assignedLicenses: u.assignedLicenses?.length ?? 0,
          department: u.department ?? null,
          jobTitle: u.jobTitle ?? null,
        };
      });

      const usersByDepartment = Array.from(deptMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([department, count]) => ({ department, count }));

      return {
        totalUsers,
        activeUsers,
        disabledUsers,
        guestUsers,
        memberUsers,
        mfaEnabled,
        mfaDisabled,
        neverSignedIn,
        usersByDepartment,
        users,
      };
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 users");
    res.status(500).json({ error: "Failed to fetch M365 users" });
  }
});

export default router;
