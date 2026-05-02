import { Router } from "express";
import { getCached } from "../lib/graphClient.js";

const router = Router();

async function fetchReportCsv(url: string): Promise<string> {
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
  if (!resp.ok) return "";
  return resp.text();
}

function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/\r/g, ""));
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim().replace(/\r/g, ""));
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = vals[i] ?? "";
    });
    return obj;
  });
}

router.get("/m365/exchange", async (req, res): Promise<void> => {
  try {
    const data = await getCached("m365-exchange", async () => {
      const [mailboxCsv, activityCsv] = await Promise.all([
        fetchReportCsv(
          "https://graph.microsoft.com/v1.0/reports/getMailboxUsageDetail(period='D30')"
        ),
        fetchReportCsv(
          "https://graph.microsoft.com/v1.0/reports/getEmailActivityCounts(period='D30')"
        ),
      ]);

      const mailboxes = parseCsv(mailboxCsv);
      const activityRows = parseCsv(activityCsv);

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
        if (m["Is Deleted"] === "True") continue;
        totalMailboxes++;
        if (m["Last Activity Date"]) activeMailboxes++;

        const usedBytes = parseInt(m["Storage Used (Byte)"] ?? "0", 10) || 0;
        const allocBytes =
          parseInt(m["Prohibit Send/Receive Quota (Byte)"] ?? "0", 10) || 0;
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
        totalSent += parseInt(row["Send"] ?? "0", 10) || 0;
        totalReceived += parseInt(row["Receive"] ?? "0", 10) || 0;
        totalRead += parseInt(row["Read"] ?? "0", 10) || 0;
      }

      return {
        totalMailboxes,
        activeMailboxes,
        sharedMailboxes,
        roomMailboxes,
        totalStorageUsedGB: Math.round((totalStorageUsedBytes / 1e9) * 10) / 10,
        totalStorageAllocatedGB:
          Math.round((totalStorageAllocatedBytes / 1e9) * 10) / 10,
        storageUtilizationPercent:
          totalStorageAllocatedBytes > 0
            ? Math.round(
                (totalStorageUsedBytes / totalStorageAllocatedBytes) * 100
              )
            : 0,
        mailboxSizeDistribution: sizeRanges.map((r, i) => ({
          range: r.label,
          count: sizeCounts[i],
        })),
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
