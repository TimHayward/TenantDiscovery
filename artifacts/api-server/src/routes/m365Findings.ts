import { Router } from "express";
import {
  ensureFindingsCurrent,
  getFindings,
  updateFindingState,
  type FindingStateUpdate,
} from "../lib/findings/store.js";
import { evaluateFindings } from "../lib/findings/engine.js";
import { computeFrameworkCoverage } from "../lib/findings/frameworks/coverage.js";
import { FINDING_STATUSES, type FindingStatus } from "../lib/findings/types.js";

const router = Router();

router.get("/m365/findings/frameworks", async (req, res): Promise<void> => {
  try {
    // Compute from fresh rule output so framework bindings are always present,
    // independent of how the persisted register stores findings.
    const findings = await evaluateFindings();
    const frameworks = computeFrameworkCoverage(findings);
    res.json({ frameworks });
  } catch (err) {
    req.log.error({ err }, "Failed to compute framework coverage");
    res.status(500).json({ error: "Failed to compute framework coverage" });
  }
});

router.get("/m365/findings", async (req, res): Promise<void> => {
  try {
    // Keep the register current with the latest collected snapshots on read,
    // regenerating only when new data has been collected since the last run.
    await ensureFindingsCurrent();
    const findings = await getFindings({
      severity: typeof req.query.severity === "string" ? req.query.severity : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      category: typeof req.query.category === "string" ? req.query.category : undefined,
    });

    const summary = findings.reduce(
      (acc, f) => {
        acc.bySeverity[f.severity] = (acc.bySeverity[f.severity] ?? 0) + 1;
        acc.byStatus[f.status] = (acc.byStatus[f.status] ?? 0) + 1;
        return acc;
      },
      { bySeverity: {} as Record<string, number>, byStatus: {} as Record<string, number> },
    );

    res.json({ findings, total: findings.length, summary });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch findings register");
    res.status(500).json({ error: "Failed to fetch findings register" });
  }
});

router.patch("/m365/findings/:fingerprint", async (req, res): Promise<void> => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.status !== undefined && !FINDING_STATUSES.includes(body.status as FindingStatus)) {
      res.status(400).json({ error: `status must be one of: ${FINDING_STATUSES.join(", ")}` });
      return;
    }
    // Reject unparseable dates so we never persist NaN as due_date.
    if (typeof body.dueDate === "string" && Number.isNaN(Date.parse(body.dueDate))) {
      res.status(400).json({ error: "dueDate must be a valid ISO date string or null" });
      return;
    }

    const update: FindingStateUpdate = {
      status: body.status as FindingStatus | undefined,
      owner: body.owner === undefined ? undefined : (body.owner as string | null),
      notes: body.notes === undefined ? undefined : (body.notes as string | null),
      dueDate: body.dueDate === undefined ? undefined : (body.dueDate as string | null),
    };

    const ok = await updateFindingState(req.params.fingerprint, update);
    if (!ok) {
      res.status(404).json({ error: "Finding not found" });
      return;
    }

    const updated = (await getFindings()).find((f) => f.fingerprint === req.params.fingerprint);
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update finding state");
    res.status(500).json({ error: "Failed to update finding state" });
  }
});

export default router;
