import { Router } from "express";
import { getFindingRows, getExecutiveModel, FINDING_EXPORT_COLUMNS } from "../lib/export/model.js";
import { toCsv } from "../lib/export/csv.js";
import { buildFindingsWorkbook } from "../lib/export/excel.js";
import { renderExecutiveHtml, renderExecutivePdf } from "../lib/export/executive.js";

const router = Router();

function scanIdParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

router.get("/m365/export/findings.csv", async (req, res): Promise<void> => {
  try {
    const rows = await getFindingRows(scanIdParam(req.query.scanId));
    const csv = toCsv(FINDING_EXPORT_COLUMNS as Array<{ key: string; header: string }>, rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="findings-${stamp()}.csv"`);
    res.send(csv);
  } catch (err) {
    req.log.error({ err }, "Failed to export findings CSV");
    res.status(500).json({ error: "Failed to export findings CSV" });
  }
});

router.get("/m365/export/findings.xlsx", async (req, res): Promise<void> => {
  try {
    const rows = await getFindingRows(scanIdParam(req.query.scanId));
    const buf = await buildFindingsWorkbook(rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="findings-${stamp()}.xlsx"`);
    res.send(buf);
  } catch (err) {
    req.log.error({ err }, "Failed to export findings workbook");
    res.status(500).json({ error: "Failed to export findings workbook" });
  }
});

// Evidence pack is the same architect workbook; kept as a distinct, stable URL.
router.get("/m365/export/evidence.xlsx", async (req, res): Promise<void> => {
  try {
    const rows = await getFindingRows(scanIdParam(req.query.scanId));
    const buf = await buildFindingsWorkbook(rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="evidence-${stamp()}.xlsx"`);
    res.send(buf);
  } catch (err) {
    req.log.error({ err }, "Failed to export evidence workbook");
    res.status(500).json({ error: "Failed to export evidence workbook" });
  }
});

router.get("/m365/export/executive.html", async (req, res): Promise<void> => {
  try {
    const model = await getExecutiveModel(scanIdParam(req.query.scanId));
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderExecutiveHtml(model));
  } catch (err) {
    req.log.error({ err }, "Failed to export executive HTML");
    res.status(500).json({ error: "Failed to export executive HTML" });
  }
});

router.get("/m365/export/executive.pdf", async (req, res): Promise<void> => {
  try {
    const model = await getExecutiveModel(scanIdParam(req.query.scanId));
    const buf = await renderExecutivePdf(model);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="executive-${stamp()}.pdf"`);
    res.send(buf);
  } catch (err) {
    req.log.error({ err }, "Failed to export executive PDF");
    res.status(500).json({ error: "Failed to export executive PDF" });
  }
});

export default router;
