import type { CheckStatus, Finding, FrameworkId } from "../types.js";
import { FRAMEWORK_NAMES, frameworkControls, type FrameworkControl } from "./catalogue.js";

/** Rolled-up status of a control given the findings mapped to it. */
export type ControlStatus = "pass" | "fail" | "warning" | "manual" | "notAssessed";

export interface ControlCoverage extends FrameworkControl {
  status: ControlStatus;
  findingCount: number;
  failCount: number;
  warningCount: number;
  manualCount: number;
  passCount: number;
}

export interface FrameworkCoverage {
  framework: FrameworkId;
  name: string;
  controls: ControlCoverage[];
  summary: {
    totalControls: number;
    pass: number;
    fail: number;
    warning: number;
    manual: number;
    notAssessed: number;
    /** Percentage of controls fully satisfied (pass) across the framework. */
    coveragePercent: number;
  };
}

// Worst-status-wins ordering when several findings map onto one control.
const STATUS_RANK: Record<CheckStatus, number> = { fail: 4, warning: 3, manual: 2, pass: 1 };

function rollUp(statuses: CheckStatus[]): ControlStatus {
  if (statuses.length === 0) return "notAssessed";
  return statuses.reduce<CheckStatus>((worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst), "pass");
}

/**
 * Compute per-control and per-framework coverage from the current findings.
 * Each control aggregates the findings whose `frameworks[]` references it,
 * taking the worst check status as the control status.
 */
export function computeFrameworkCoverage(findings: Pick<Finding, "checkStatus" | "frameworks">[]): FrameworkCoverage[] {
  // Bucket finding statuses by `${framework}:${controlId}`.
  const byControl = new Map<string, CheckStatus[]>();
  for (const f of findings) {
    for (const ref of f.frameworks ?? []) {
      const key = `${ref.framework}:${ref.controlId}`;
      const list = byControl.get(key) ?? [];
      list.push(f.checkStatus);
      byControl.set(key, list);
    }
  }

  const frameworks = [...new Set(frameworkControls.map((c) => c.framework))];

  return frameworks.map((framework) => {
    const controls: ControlCoverage[] = frameworkControls
      .filter((c) => c.framework === framework)
      .map((c) => {
        const statuses = byControl.get(`${c.framework}:${c.controlId}`) ?? [];
        return {
          ...c,
          status: rollUp(statuses),
          findingCount: statuses.length,
          failCount: statuses.filter((s) => s === "fail").length,
          warningCount: statuses.filter((s) => s === "warning").length,
          manualCount: statuses.filter((s) => s === "manual").length,
          passCount: statuses.filter((s) => s === "pass").length,
        };
      });

    const count = (s: ControlStatus) => controls.filter((c) => c.status === s).length;
    const totalControls = controls.length;
    const pass = count("pass");

    return {
      framework,
      name: FRAMEWORK_NAMES[framework],
      controls,
      summary: {
        totalControls,
        pass,
        fail: count("fail"),
        warning: count("warning"),
        manual: count("manual"),
        notAssessed: count("notAssessed"),
        coveragePercent: totalControls > 0 ? Math.round((pass / totalControls) * 100) : 0,
      },
    };
  });
}
