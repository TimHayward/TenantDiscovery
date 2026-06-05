import { Router } from "express";
import { getOrFetch } from "../lib/metricStore.js";
import { collectAdminExposure } from "../lib/collectors/adminExposure.js";

const router = Router();

router.get("/m365/users/admin-exposure", async (req, res): Promise<void> => {
  try {
    const data = await getOrFetch("m365-users-admin-exposure", collectAdminExposure);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch M365 administrator exposure");
    res.status(500).json({ error: "Failed to fetch M365 administrator exposure" });
  }
});

export default router;
