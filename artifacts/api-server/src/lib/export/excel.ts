import ExcelJS from "exceljs";
import { FINDING_EXPORT_COLUMNS, SEVERITY_RANK, type FindingExportRow } from "./model.js";
import type { FrameworkCoverage } from "../findings/frameworks/coverage.js";

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

function addFrameworkSheet(wb: ExcelJS.Workbook, coverage: FrameworkCoverage[]): void {
  const sheet = wb.addWorksheet("Framework Coverage");
  sheet.columns = [
    { header: "Framework", key: "framework", width: 36 },
    { header: "Control", key: "controlId", width: 12 },
    { header: "Title", key: "title", width: 40 },
    { header: "Requirement", key: "requirement", width: 50 },
    { header: "Status", key: "status", width: 14 },
    { header: "Mapped findings", key: "findingCount", width: 16 },
    { header: "Fail", key: "failCount", width: 8 },
    { header: "Review", key: "warningCount", width: 8 },
    { header: "Manual", key: "manualCount", width: 8 },
    { header: "Pass", key: "passCount", width: 8 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const fw of coverage) {
    for (const c of fw.controls) {
      sheet.addRow({
        framework: fw.name,
        controlId: c.controlId,
        title: c.title,
        requirement: c.requirement,
        status: c.status,
        findingCount: c.findingCount,
        failCount: c.failCount,
        warningCount: c.warningCount,
        manualCount: c.manualCount,
        passCount: c.passCount,
      });
    }
  }
  sheet.autoFilter = { from: "A1", to: { row: 1, column: 10 } };
}

/**
 * Build an architect evidence workbook: a summary sheet plus one sheet per
 * finding category, and a framework-coverage sheet when coverage is supplied.
 */
export async function buildFindingsWorkbook(
  rows: FindingExportRow[],
  coverage?: FrameworkCoverage[],
): Promise<Buffer> {
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

  // Framework control coverage (CIS / NCSC), when supplied.
  if (coverage && coverage.length > 0) {
    addFrameworkSheet(wb, coverage);
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
