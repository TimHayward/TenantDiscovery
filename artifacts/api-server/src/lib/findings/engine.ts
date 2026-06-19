import { getLatest } from "../metricStore.js";
import { runRule } from "./rules/helpers.js";
import { securityRules } from "./rules/security.js";
import { complianceRules } from "./rules/compliance.js";
import type { Finding } from "./types.js";

/**
 * Evaluate all registered rules against the latest collected metric snapshots and
 * return the consolidated findings. Security + Compliance are covered first; other
 * domains can be added by registering more rule sets here.
 */
export async function evaluateFindings(): Promise<Finding[]> {
  const [securityData, complianceData] = await Promise.all([
    getLatest<unknown>("m365-security"),
    getLatest<unknown>("m365-compliance"),
  ]);

  const findings: Finding[] = [];

  for (const rule of securityRules) {
    const f = runRule(rule, securityData as never);
    if (f) findings.push(f);
  }
  for (const rule of complianceRules) {
    const f = runRule(rule, complianceData as never);
    if (f) findings.push(f);
  }

  return findings;
}
