import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { withMetadata } from "../lib/metadata.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz/with-metadata", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(
    withMetadata(data, {
      status: {
        evidenceStatus: "apiBacked",
        confidenceLabel: "high",
        sourceLabel: "API health check",
      },
    }),
  );
});

export default router;
