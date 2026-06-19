import ExcelJS from "exceljs";
import { FINDING_EXPORT_COLUMNS, type FindingExportRow } from "./model.js";

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function addSheet(wb: ExcelJS.Workbook, name: string, rows: FindingExportRow[]): void {
  // Excel sheet names cannot exceed 31 chars or contain certain characters.
  const safeName = name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
  const sheet = wb.addWorksheet(safeName);
  sheet.columns = FINDING_EXPORT_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key as string,
    width: c.key === "description" || c.key === "remediation" ? 50 : 18,
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  sheet.autoFilter = { from: "A1", to: { row: 1, column: FINDING_EXPORT_COLUMNS.length } };
}

/**
 * Build an architect evidence workbook: a summary sheet plus one sheet per
 * finding category.
 */
export async function buildFindingsWorkbook(rows: FindingExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TenentDiscovery";
  wb.created = new Date();

  // Summary sheet.
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Metric", key: "metric", width: 30 },
    { header: "Value", key: "value", width: 16 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.addRow({ metric: "Total findings", value: rows.length });
  for (const sev of ["critical", "high", "medium", "low", "info"]) {
    summary.addRow({ metric: `Severity: ${sev}`, value: rows.filter((r) => r.severity === sev).length });
  }
  summary.addRow({ metric: "Open", value: rows.filter((r) => r.status === "open").length });
  summary.addRow({ metric: "Remediated", value: rows.filter((r) => r.status === "remediated").length });

  // All findings sheet.
  addSheet(wb, "All Findings", [...rows].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9),
  ));

  // One sheet per category.
  const categories = Array.from(new Set(rows.map((r) => r.category))).sort();
  for (const cat of categories) {
    addSheet(wb, cat, rows.filter((r) => r.category === cat));
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
