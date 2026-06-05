import { Router } from "express";
import { getStatusAsync, triggerAll } from "../lib/backgroundRefresh.js";
import { TASK_KEYS } from "../lib/backgroundRefresh.js";

const router = Router();

router.get("/m365/collection-status", async (req, res): Promise<void> => {
  try {
    const status = await getStatusAsync();
    const values = Object.values(status);
    const isCollecting = values.some((s) => s.status === "collecting" || s.status === "pending");
    res.json({ isCollecting, keys: status });
  } catch (err) {
    req.log.error({ err }, "Failed to get collection status");
    res.status(500).json({ error: "Failed to get collection status" });
  }
});

router.post("/m365/refresh", async (req, res): Promise<void> => {
  try {
    // Fire and forget — returns immediately
    triggerAll().catch(() => {});
    res.status(202).json({ message: "Refresh triggered", keys: TASK_KEYS });
  } catch (err) {
    req.log.error({ err }, "Failed to trigger refresh");
    res.status(500).json({ error: "Failed to trigger refresh" });
  }
});

export default router;
