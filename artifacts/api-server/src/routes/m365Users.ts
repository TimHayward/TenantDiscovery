import { Router } from "express";
import { graphClient, getCached } from "../lib/graphClient.js";

const router = Router();

router.get("/m365/users", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-users", async () => {
      const [usersRes, mfaRes] = await Promise.allSettled([
        graphClient
          .api("/users")
          .select("id,displayName,userPrincipalName,accountEnabled,userType,lastSignInDateTime,assignedLicenses,department,jobTitle")
          .top(999)
          .header("ConsistencyLevel", "eventual")
          .orderby("displayName")
          .get(),
        graphClient
          .api("/reports/authenticationMethods/userRegistrationDetails")
          .select("id,isMfaRegistered")
          .top(999)
          .get(),
      ]);

      const rawUsers = usersRes.status === "fulfilled" ? usersRes.value?.value ?? [] : [];
      const mfaUsers = mfaRes.status === "fulfilled" ? mfaRes.value?.value ?? [] : [];

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
        if (!u.lastSignInDateTime) neverSignedIn++;

        const dept = u.department ?? "Unassigned";
        deptMap.set(dept, (deptMap.get(dept) ?? 0) + 1);

        return {
          id: u.id,
          displayName: u.displayName ?? "",
          userPrincipalName: u.userPrincipalName ?? "",
          accountEnabled: u.accountEnabled ?? false,
          userType: u.userType ?? "Member",
          mfaEnabled: isMfa,
          lastSignIn: u.lastSignInDateTime ?? null,
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
