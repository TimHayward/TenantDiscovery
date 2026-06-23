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
    findings.push(...runRule(rule, securityData as never));
  }
  for (const rule of complianceRules) {
    findings.push(...runRule(rule, complianceData as never));
  }

  return findings;
}
