import { Router } from "express";
import { GetM365DriftQueryParams, GetM365ScanParams } from "@workspace/api-zod";
import { listScans, getScan, computeDrift } from "../lib/scanStore.js";
import { validate } from "../middlewares/validate.js";

const router = Router();

router.get("/m365/scans", async (req, res): Promise<void> => {
  try {
    res.json({ scans: await listScans() });
  } catch (err) {
    req.log.error({ err }, "Failed to list scans");
    res.status(500).json({ error: "Failed to list scans" });
  }
});

router.get(
  "/m365/drift",
  validate({ query: GetM365DriftQueryParams }),
  async (req, res): Promise<void> => {
  try {
    const { from, to } = req.valid!.query as { from?: string; to?: string };
    res.json(await computeDrift(from, to));
  } catch (err) {
    req.log.error({ err }, "Failed to compute drift");
    res.status(500).json({ error: "Failed to compute drift" });
  }
});

router.get(
  "/m365/scans/:id",
  validate({ params: GetM365ScanParams }),
  async (req, res): Promise<void> => {
  try {
    const { id } = req.valid!.params as { id: string };
    const scan = await getScan(id);
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
