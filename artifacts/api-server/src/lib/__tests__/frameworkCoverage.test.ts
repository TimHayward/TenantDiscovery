import { describe, expect, it } from "vitest";
import { computeFrameworkCoverage } from "../findings/frameworks/coverage";
import type { Finding } from "../findings/types";

function f(checkStatus: Finding["checkStatus"], controlId: string): Pick<Finding, "checkStatus" | "frameworks"> {
  return { checkStatus, frameworks: [{ framework: "CIS-M365", controlId }] };
}

describe("computeFrameworkCoverage", () => {
  it("rolls a control up to its worst mapped status", () => {
    const coverage = computeFrameworkCoverage([f("pass", "1.1.3"), f("fail", "1.1.3"), f("warning", "1.1.3")]);
    const cis = coverage.find((c) => c.framework === "CIS-M365")!;
    const control = cis.controls.find((c) => c.controlId === "1.1.3")!;
    expect(control.status).toBe("fail");
    expect(control.findingCount).toBe(3);
    expect(control.failCount).toBe(1);
  });

  it("marks controls with no mapped findings as notAssessed", () => {
    const coverage = computeFrameworkCoverage([]);
    const cis = coverage.find((c) => c.framework === "CIS-M365")!;
    expect(cis.controls.every((c) => c.status === "notAssessed")).toBe(true);
    expect(cis.summary.coveragePercent).toBe(0);
  });

  it("computes coverage percent from fully-satisfied controls", () => {
    const coverage = computeFrameworkCoverage([f("pass", "1.1.3")]);
    const cis = coverage.find((c) => c.framework === "CIS-M365")!;
    expect(cis.summary.pass).toBe(1);
    expect(cis.summary.coveragePercent).toBeGreaterThan(0);
  });

  it("returns an entry for every framework in the catalogue", () => {
    const coverage = computeFrameworkCoverage([]);
    expect(coverage.map((c) => c.framework).sort()).toEqual(["CIS-M365", "NCSC-CE"]);
  });
});
