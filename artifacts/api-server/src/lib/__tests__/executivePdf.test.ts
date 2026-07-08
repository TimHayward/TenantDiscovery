import { describe, expect, it } from "vitest";
import { renderExecutivePdf } from "../export/executive";
import type { ExecutiveModel } from "../export/model";
import type { FindingExportRow } from "../export/model";

function makeRow(overrides: Partial<FindingExportRow>): FindingExportRow {
  return {
    severity: "high",
    category: "Identity",
    title: "Finding",
    description: "",
    checkStatus: "fail",
    status: "open",
    owner: "",
    dueDate: "",
    evidenceStatus: "verified",
    confidenceLabel: "high",
    source: "",
    remediation: "",
    notes: "",
    firstSeen: "",
    lastSeen: "",
    ...overrides,
  };
}

describe("renderExecutivePdf", () => {
  it("renders non-WinAnsi display names (CJK, emoji) without throwing", async () => {
    const model: ExecutiveModel = {
      generatedAt: new Date().toISOString(),
      scanId: null,
      total: 2,
      bySeverity: { high: 2 },
      byStatus: { open: 2 },
      topFindings: [
        makeRow({ title: "李雷 (Sales) 🚀 has standing admin access" }),
        makeRow({ title: "Zoë Müller has a stale guest invite" }),
      ],
      drift: {
        fromScanId: null,
        toScanId: null,
        added: [
          {
            fingerprint: "f1",
            title: "李雷 (Sales) 🚀",
            category: "Identity",
            severity: "high",
            checkStatus: "fail",
          },
        ],
        resolved: [],
        changed: [],
      },
      frameworks: [],
    };

    const bytes = await renderExecutivePdf(model);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("renders Latin-1 display names unchanged", async () => {
    const model: ExecutiveModel = {
      generatedAt: new Date().toISOString(),
      scanId: null,
      total: 1,
      bySeverity: { low: 1 },
      byStatus: { open: 1 },
      topFindings: [makeRow({ title: "Zoë Müller", severity: "low" })],
      drift: { fromScanId: null, toScanId: null, added: [], resolved: [], changed: [] },
      frameworks: [],
    };

    const bytes = await renderExecutivePdf(model);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    // Latin-1 text is representable in WinAnsi, so the raw bytes carry the
    // encoded glyph codes for ë/ü rather than "?" substitutions.
    expect(bytes.toString("latin1")).not.toMatch(/Zo\? M\?ller/);
  });
});
