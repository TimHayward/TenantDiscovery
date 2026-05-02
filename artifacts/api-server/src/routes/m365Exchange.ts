import { Router } from "express";
import { graphClient, getCached } from "../lib/graphClient.js";

const router = Router();

router.get("/m365/exchange", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-exchange", async () => {
      const [mailboxRes, activityRes] = await Promise.allSettled([
        graphClient.api("/reports/getMailboxUsageDetail(period='D30')").header("Accept", "application/json").get(),
        graphClient.api("/reports/getEmailActivityCounts(period='D30')").header("Accept", "application/json").get(),
      ]);

      const mailboxes = mailboxRes.status === "fulfilled" ? mailboxRes.value?.value ?? [] : [];
      const activityRows = activityRes.status === "fulfilled" ? activityRes.value?.value ?? [] : [];

      let totalMailboxes = 0;
      let activeMailboxes = 0;
      let sharedMailboxes = 0;
      let roomMailboxes = 0;
      let totalStorageUsedBytes = 0;
      let totalStorageAllocatedBytes = 0;

      const sizeRanges = [
        { label: "0-1 GB", min: 0, max: 1 },
        { label: "1-5 GB", min: 1, max: 5 },
        { label: "5-10 GB", min: 5, max: 10 },
        { label: "10-25 GB", min: 10, max: 25 },
        { label: "25-50 GB", min: 25, max: 50 },
        { label: ">50 GB", min: 50, max: Infinity },
      ];
      const sizeCounts = new Array(sizeRanges.length).fill(0);

      for (const m of mailboxes) {
        totalMailboxes++;
        if (m.isDeleted === false && m.hasAnyActivity) activeMailboxes++;
        const mbType = (m.recipientType ?? "").toLowerCase();
        if (mbType.includes("shared")) sharedMailboxes++;
        if (mbType.includes("room") || mbType.includes("equipment")) roomMailboxes++;

        const usedBytes = m.storageUsedInBytes ?? 0;
        const allocBytes = m.prohibitSendReceiveQuotaInBytes ?? 0;
        totalStorageUsedBytes += usedBytes;
        totalStorageAllocatedBytes += allocBytes;

        const usedGB = usedBytes / 1e9;
        for (let i = 0; i < sizeRanges.length; i++) {
          if (usedGB >= sizeRanges[i].min && usedGB < sizeRanges[i].max) {
            sizeCounts[i]++;
            break;
          }
        }
      }

      let totalSent = 0;
      let totalReceived = 0;
      let totalRead = 0;
      for (const row of activityRows) {
        totalSent += row.send ?? 0;
        totalReceived += row.receive ?? 0;
        totalRead += row.read ?? 0;
      }

      return {
        totalMailboxes,
        activeMailboxes,
        sharedMailboxes,
        roomMailboxes,
        totalStorageUsedGB: Math.round((totalStorageUsedBytes / 1e9) * 10) / 10,
        totalStorageAllocatedGB: Math.round((totalStorageAllocatedBytes / 1e9) * 10) / 10,
        storageUtilizationPercent: totalStorageAllocatedBytes > 0
          ? Math.round((totalStorageUsedBytes / totalStorageAllocatedBytes) * 100)
          : 0,
        mailboxSizeDistribution: sizeRanges.map((r, i) => ({ range: r.label, count: sizeCounts[i] })),
        emailActivityLast30Days: {
          sent: totalSent,
          received: totalReceived,
          read: totalRead,
        },
        quarantinedMessages: 0,
        malwareDetected: 0,
        spamFiltered: 0,
      };
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 Exchange data");
    res.status(500).json({ error: "Failed to fetch M365 Exchange data" });
  }
});

export default router;
