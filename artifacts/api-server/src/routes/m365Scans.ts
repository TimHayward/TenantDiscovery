import { Router } from "express";
import { listScans, getScan, computeDrift } from "../lib/scanStore.js";

const router = Router();

router.get("/m365/scans", async (req, res): Promise<void> => {
  try {
    res.json({ scans: await listScans() });
  } catch (err) {
    req.log.error({ err }, "Failed to list scans");
    res.status(500).json({ error: "Failed to list scans" });
  }
});

router.get("/m365/drift", async (req, res): Promise<void> => {
  try {
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    res.json(await computeDrift(from, to));
  } catch (err) {
    req.log.error({ err }, "Failed to compute drift");
    res.status(500).json({ error: "Failed to compute drift" });
  }
});

router.get("/m365/scans/:id", async (req, res): Promise<void> => {
  try {
    const scan = await getScan(req.params.id);
    if (!scan) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }
    res.json(scan);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch scan");
    res.status(500).json({ error: "Failed to fetch scan" });
  }
});

export default router;
