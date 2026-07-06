import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ExecutiveModel } from "./model.js";

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

/** Render the executive summary as a self-contained, print-ready HTML document. */
export function renderExecutiveHtml(m: ExecutiveModel): string {
  const sevRows = SEVERITY_ORDER.map(
    (s) => `<tr><td style="text-transform:capitalize">${s}</td><td>${m.bySeverity[s] ?? 0}</td></tr>`,
  ).join("");

  const topRows = m.topFindings
    .map(
      (f) =>
        `<tr><td style="text-transform:capitalize">${escapeHtml(f.severity)}</td>` +
        `<td>${escapeHtml(f.category)}</td><td>${escapeHtml(f.title)}</td>` +
        `<td>${escapeHtml(f.checkStatus)}</td><td>${escapeHtml(f.status || "open")}</td></tr>`,
    )
    .join("");

  const driftList = (label: string, entries: ExecutiveModel["drift"]["added"]) =>
    `<h3>${label} (${entries.length})</h3>` +
    (entries.length === 0
      ? `<p class="muted">None</p>`
      : `<ul>${entries.map((e) => `<li>[${escapeHtml(e.severity)}] ${escapeHtml(e.title)}</li>`).join("")}</ul>`);

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Executive Posture Report</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a1a; margin: 40px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 15px; margin-top: 28px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  h3 { font-size: 13px; margin: 14px 0 4px; }
  .muted { color: #777; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 12px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #eee; }
  th { background: #f5f5f5; }
  .kpis { display: flex; gap: 16px; margin-top: 12px; }
  .kpi { border: 1px solid #ddd; border-radius: 6px; padding: 10px 16px; }
  .kpi .n { font-size: 24px; font-weight: 700; }
  @media print { body { margin: 16px; } }
</style></head>
<body>
  <h1>Microsoft 365 Posture — Executive Report</h1>
  <p class="muted">Generated ${escapeHtml(m.generatedAt)}${m.scanId ? ` · scan ${escapeHtml(m.scanId)}` : ""}</p>

  <div class="kpis">
    <div class="kpi"><div class="n">${m.total}</div><div class="muted">Total findings</div></div>
    <div class="kpi"><div class="n">${m.bySeverity.critical ?? 0}</div><div class="muted">Critical</div></div>
    <div class="kpi"><div class="n">${m.bySeverity.high ?? 0}</div><div class="muted">High</div></div>
    <div class="kpi"><div class="n">${m.byStatus.open ?? 0}</div><div class="muted">Open</div></div>
  </div>

  <h2>Severity Breakdown</h2>
  <table><thead><tr><th>Severity</th><th>Count</th></tr></thead><tbody>${sevRows}</tbody></table>

  <h2>Top Findings</h2>
  <table><thead><tr><th>Severity</th><th>Category</th><th>Finding</th><th>Check</th><th>Status</th></tr></thead>
  <tbody>${topRows || '<tr><td colspan="5" class="muted">No open findings</td></tr>'}</tbody></table>

  <h2>Framework Coverage</h2>
  <table><thead><tr><th>Framework</th><th>Coverage</th><th>Pass</th><th>Fail</th><th>Review</th><th>Manual</th><th>Not assessed</th></tr></thead>
  <tbody>${
    m.frameworks.length === 0
      ? '<tr><td colspan="7" class="muted">No framework mapping available</td></tr>'
      : m.frameworks
          .map(
            (f) =>
              `<tr><td>${escapeHtml(f.name)}</td><td>${f.coveragePercent}%</td>` +
              `<td>${f.pass}</td><td>${f.fail}</td><td>${f.warning}</td><td>${f.manual}</td><td>${f.notAssessed}</td></tr>`,
          )
          .join("")
  }</tbody></table>

  <h2>What Changed Since Last Scan</h2>
  ${driftList("New", m.drift.added)}
  ${driftList("Resolved", m.drift.resolved)}
  ${driftList("Changed", m.drift.changed)}
</body></html>`;
}

/** Render the executive summary as a PDF (pure-JS pdf-lib; no headless browser). */
export async function renderExecutivePdf(m: ExecutiveModel): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([595, 842]); // A4 portrait
  const margin = 48;
  let y = 842 - margin;
  const lineGap = 16;

  const ensureSpace = (needed = lineGap) => {
    if (y - needed < margin) {
      page = doc.addPage([595, 842]);
      y = 842 - margin;
    }
  };
  const text = (s: string, size = 11, useBold = false, color = rgb(0.1, 0.1, 0.1)) => {
    ensureSpace();
    page.drawText(s, { x: margin, y, size, font: useBold ? bold : font, color });
    y -= lineGap;
  };
  const heading = (s: string) => {
    y -= 8;
    text(s, 14, true, rgb(0, 0, 0));
  };

  text("Microsoft 365 Posture — Executive Report", 18, true, rgb(0, 0, 0));
  text(`Generated ${m.generatedAt}${m.scanId ? ` · scan ${m.scanId}` : ""}`, 9, false, rgb(0.45, 0.45, 0.45));

  heading("Summary");
  text(`Total findings: ${m.total}`);
  text(`Critical: ${m.bySeverity.critical ?? 0}   High: ${m.bySeverity.high ?? 0}   Medium: ${m.bySeverity.medium ?? 0}   Low: ${m.bySeverity.low ?? 0}`);
  text(`Open: ${m.byStatus.open ?? 0}   Remediated: ${m.byStatus.remediated ?? 0}`);

  heading("Top Findings");
  if (m.topFindings.length === 0) {
    text("No open findings.", 10, false, rgb(0.45, 0.45, 0.45));
  } else {
    for (const f of m.topFindings) {
      const label = `[${f.severity}] ${f.category} — ${f.title} (${f.checkStatus})`;
      text(label.length > 95 ? label.slice(0, 92) + "…" : label, 10);
    }
  }

  heading("Framework Coverage");
  if (m.frameworks.length === 0) {
    text("No framework mapping available.", 10, false, rgb(0.45, 0.45, 0.45));
  } else {
    for (const f of m.frameworks) {
      text(`${f.name}: ${f.coveragePercent}% (pass ${f.pass}, fail ${f.fail}, review ${f.warning}, manual ${f.manual}, n/a ${f.notAssessed})`, 10);
    }
  }

  heading("What Changed Since Last Scan");
  text(`New: ${m.drift.added.length}   Resolved: ${m.drift.resolved.length}   Changed: ${m.drift.changed.length}`, 10);
  for (const e of m.drift.added.slice(0, 10)) text(`+ [${e.severity}] ${e.title}`, 9, false, rgb(0.6, 0.1, 0.1));
  for (const e of m.drift.resolved.slice(0, 10)) text(`- [${e.severity}] ${e.title}`, 9, false, rgb(0.1, 0.45, 0.1));

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
