import { Router } from "express";
import {
  type ConfidenceLabel,
  type EvidenceStatus,
  metricDataSources,
} from "@workspace/permissions-manifest";
import { GetM365DataSourcesQueryParams } from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";

const router = Router();

router.get("/m365/data-sources", validate({ query: GetM365DataSourcesQueryParams }), (req, res) => {
  const query = req.valid!.query as {
    metricId?: string;
    tab?: string;
    evidenceStatus?: EvidenceStatus;
  };
  const metricId = query.metricId;
  const tab = query.tab;
  const evidenceStatus = query.evidenceStatus;

  const filtered = metricDataSources
    .filter((entry) => (metricId ? entry.metricId === metricId : true))
    .filter((entry) => (tab ? entry.tab === tab : true))
    .filter((entry) =>
      evidenceStatus ? entry.evidenceStatus === evidenceStatus : true
    )
    .sort((a, b) => a.metricId.localeCompare(b.metricId));

  const summary = {
    total: filtered.length,
    byConfidence: filtered.reduce<Record<ConfidenceLabel, number>>(
      (acc, entry) => {
        acc[entry.confidenceLabel] += 1;
        return acc;
      },
      {
        high: 0,
        medium: 0,
        low: 0,
        unknown: 0,
      }
    ),
    byEvidenceStatus: filtered.reduce<Record<EvidenceStatus, number>>(
      (acc, entry) => {
        acc[entry.evidenceStatus] += 1;
        return acc;
      },
      {
        apiBacked: 0,
        partial: 0,
        manual: 0,
        automationCandidate: 0,
        notAssessed: 0,
      }
    ),
  };

  return res.json({ items: filtered, summary });
});

export default router;
