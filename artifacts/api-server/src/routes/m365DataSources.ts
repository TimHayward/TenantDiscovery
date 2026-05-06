import { Router } from "express";
import {
  type ConfidenceLabel,
  type EvidenceStatus,
  metricDataSources,
} from "@workspace/permissions-manifest";

const router = Router();

router.get("/m365/data-sources", (req, res) => {
  const metricId =
    typeof req.query.metricId === "string" && req.query.metricId.length > 0
      ? req.query.metricId
      : undefined;
  const tab =
    typeof req.query.tab === "string" && req.query.tab.length > 0
      ? req.query.tab
      : undefined;
  const evidenceStatus =
    typeof req.query.evidenceStatus === "string" && req.query.evidenceStatus.length > 0
      ? (req.query.evidenceStatus as EvidenceStatus)
      : undefined;

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
