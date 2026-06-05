import { Router } from "express";
import { withMetadata } from "../lib/metadata.js";
import { getOrFetch } from "../lib/metricStore.js";
import { collectAdoption } from "../lib/collectors/adoption.js";
import { fetchGraphText } from "../lib/collectionIssues.js";

const router = Router();

// Debug endpoint — direct Graph call, not cached
router.get("/m365/adoption/debug", async (req, res): Promise<void> => {
  try {
    const result = await fetchGraphText(
      "https://graph.microsoft.com/v1.0/reports/getOffice365ServicesUserCounts(period='D30')",
      "debug",
    );
    if (result.issue) { res.json({ error: result.issue }); return; }
    const raw = result.text ?? "";
    const hasBom = raw.charCodeAt(0) === 0xfeff;
    const cleaned = raw.replace(/^﻿/, "").trim();
    const lines = cleaned.split("\n").filter(Boolean);
    const headers = lines.length > 0 ? lines[0].split(",").map((h) => h.trim().replace(/\r/g, "")) : [];
    const firstDataRow = lines.length > 1 ? lines[1].split(",").map((v) => v.trim().replace(/\r/g, "")) : [];
    const lastDataRow = lines.length > 1 ? lines[lines.length - 1].split(",").map((v) => v.trim().replace(/\r/g, "")) : [];
    res.json({ hasBom, totalRows: lines.length - 1, rawFirst200Chars: raw.slice(0, 200), headers, firstDataRow: Object.fromEntries(headers.map((h, i) => [h, firstDataRow[i]])), lastDataRow: Object.fromEntries(headers.map((h, i) => [h, lastDataRow[i]])) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/m365/adoption", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-adoption", collectAdoption);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 Adoption data");
    res.status(500).json({ error: "Failed to fetch M365 Adoption data" });
  }
});

router.get("/m365/adoption/with-metadata", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-adoption", collectAdoption);

    const fieldMetadata = {
      workloads: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All — getOffice365ServicesUserCounts (D30/D90/D180)" },
      totalActiveUsers: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All — getOffice365ServicesUserCounts, Office 365 Active column" },
      totalLicensedUsers: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Reports.Read.All — Active + Inactive from Office 365 aggregate" },
      overallAdoptionPercent: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Calculated: Office 365 Active ÷ (Active + Inactive) × 100" },
      valueGapCount: { evidenceStatus: "apiBacked" as const, confidenceLabel: "high" as const, sourceLabel: "Count of workloads with <20% adoption in 30-day window" },
    };

    res.json(withMetadata(data, fieldMetadata));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 Adoption data");
    res.status(500).json({ error: "Failed to fetch M365 Adoption data" });
  }
});

export default router;
