import { describe, expect, it } from "vitest";
import { computeFrameworkCoverage } from "../findings/frameworks/coverage";
import { getFrameworkControl } from "../findings/frameworks/catalogue";
import type { Finding, FrameworkRef } from "../findings/types";
import { securityRules } from "../findings/rules/security";
import { complianceRules } from "../findings/rules/compliance";
import { identityRules } from "../findings/rules/identity";
import { appsRules } from "../findings/rules/apps";
import { devicesRules } from "../findings/rules/devices";
import { emailRules } from "../findings/rules/email";
import { collaborationRules } from "../findings/rules/collaboration";
import { licensingRules } from "../findings/rules/licensing";

/** Every registered rule, reduced to the fields this test needs. */
const allRules: { ruleId: string; frameworks?: FrameworkRef[] }[] = [
  ...securityRules,
  ...complianceRules,
  ...identityRules,
  ...appsRules,
  ...devicesRules,
  ...emailRules,
  ...collaborationRules,
  ...licensingRules,
];

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

  it("defines all five NCSC Cyber Essentials themes", () => {
    const coverage = computeFrameworkCoverage([]);
    const ce = coverage.find((c) => c.framework === "NCSC-CE")!;
    expect(ce.controls.map((c) => c.controlId).sort()).toEqual(["FW", "MPM", "SC", "SUM", "UAC"]);
  });
});

describe("framework reference integrity", () => {
  it("resolves every cis()/ce() reference declared by a rule to a defined control", () => {
    const dangling: string[] = [];
    for (const rule of allRules) {
      for (const ref of rule.frameworks ?? []) {
        if (!getFrameworkControl(ref)) {
          dangling.push(`${rule.ruleId} → ${ref.framework}:${ref.controlId}`);
        }
      }
    }
    // A dangling reference is silently dropped by coverage rollup, so fail loudly here.
    expect(dangling).toEqual([]);
  });
});
