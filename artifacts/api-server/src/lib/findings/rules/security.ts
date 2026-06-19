import type { RuleDefinition } from "./helpers.js";

/** Minimal shape of the m365-security snapshot consumed by these rules. */
interface SecurityData {
  secureScorePercent?: number;
  mfaEnabledPercent?: number;
  enabledCAPs?: number;
  riskyUsers?: number;
  secureScoreControls?: Array<{ status?: string }>;
  mfaMethodsBreakdown?: Array<{ strength?: string; count?: number }>;
}

export const securityRules: RuleDefinition<SecurityData>[] = [
  {
    ruleId: "security.checklist.6.1.secureScore",
    category: "security",
    title: "Secure Score is monitored and benchmarked",
    description: "Secure Score remains above the minimum posture target",
    severity: "high",
    metricId: "security.checklist.6.1.secureScore",
    remediation: "Work through Microsoft Secure Score recommendations to raise the overall posture above target.",
    evaluate: (d) => {
      if (!d) return null;
      const pct = d.secureScorePercent ?? 0;
      return { checkStatus: pct >= 70 ? "pass" : pct >= 50 ? "warning" : "fail", detail: `${pct}%` };
    },
  },
  {
    ruleId: "security.checklist.6.2.mfaCoverage",
    category: "security",
    title: "MFA coverage for users is maintained",
    description: "MFA registration coverage for users is at an acceptable level",
    severity: "critical",
    metricId: "security.checklist.6.2.mfaCoverage",
    remediation: "Enforce MFA registration via Conditional Access / registration campaigns for all users.",
    evaluate: (d) => {
      if (!d) return null;
      const pct = d.mfaEnabledPercent ?? 0;
      return { checkStatus: pct >= 90 ? "pass" : pct >= 75 ? "warning" : "fail", detail: `${pct}% coverage` };
    },
  },
  {
    ruleId: "security.checklist.6.3.conditionalAccess",
    category: "security",
    title: "Conditional Access baseline policies are active",
    description: "Conditional Access baseline controls are enabled",
    severity: "high",
    metricId: "security.checklist.6.3.conditionalAccess",
    remediation: "Deploy the Conditional Access baseline (MFA, legacy-auth block, risk-based sign-in) policies.",
    evaluate: (d) => {
      if (!d) return null;
      const n = d.enabledCAPs ?? 0;
      return { checkStatus: n >= 3 ? "pass" : n > 0 ? "warning" : "fail", detail: `${n} enabled` };
    },
  },
  {
    ruleId: "security.checklist.6.4.riskyUsers",
    category: "security",
    title: "Risky users are identified and remediated",
    description: "Risky user backlog is managed",
    severity: "high",
    metricId: "security.checklist.6.4.riskyUsers",
    remediation: "Investigate and remediate risky users in Identity Protection; require password reset where appropriate.",
    evaluate: (d) => {
      if (!d) return null;
      const n = d.riskyUsers ?? 0;
      return { checkStatus: n === 0 ? "pass" : n <= 5 ? "warning" : "fail", detail: `${n} risky users` };
    },
  },
  {
    ruleId: "security.checklist.6.5.riskDetectionResponse",
    category: "security",
    title: "Risk detections are triaged within agreed SLA",
    description: "SOC triage SLA for identity risk detections is evidenced",
    severity: "medium",
    metricId: "security.checklist.6.5.riskDetectionResponse",
    remediation: "Document and evidence the SOC triage SLA for Identity Protection risk detections.",
    evaluate: () => ({ checkStatus: "manual" }),
  },
  {
    ruleId: "security.checklist.6.6.phishingResistantMfa",
    category: "security",
    title: "Phishing-resistant authentication is adopted",
    description: "Privileged users use phishing-resistant methods",
    severity: "medium",
    metricId: "security.checklist.6.6.phishingResistantMfa",
    remediation: "Roll out FIDO2 / certificate-based / Windows Hello for Business to privileged users.",
    evaluate: (d) => {
      const count = d?.mfaMethodsBreakdown?.find((m) => m.strength === "Phishing-resistant")?.count ?? 0;
      return count > 0
        ? { checkStatus: "warning", detail: `${count} users registered` }
        : { checkStatus: "manual" };
    },
  },
  {
    ruleId: "security.checklist.6.7.legacyAuthBlocked",
    category: "security",
    title: "Legacy authentication paths are blocked",
    description: "Legacy authentication protocols are effectively blocked",
    severity: "high",
    metricId: "security.checklist.6.7.legacyAuthBlocked",
    remediation: "Block legacy authentication via Conditional Access and confirm no break-glass exceptions remain.",
    evaluate: () => ({ checkStatus: "manual" }),
  },
  {
    ruleId: "security.checklist.6.8.controlBacklog",
    category: "security",
    title: "Secure Score control backlog is tracked",
    description: "Not-configured Secure Score controls are actively reduced",
    severity: "medium",
    metricId: "security.checklist.6.8.controlBacklog",
    remediation: "Prioritise and remediate the not-configured Secure Score controls.",
    evaluate: (d) => {
      if (!d) return null;
      const n = (d.secureScoreControls ?? []).filter((c) => c.status === "notConfigured").length;
      return { checkStatus: n === 0 ? "pass" : n <= 10 ? "warning" : "fail", detail: `${n} not configured` };
    },
  },
  {
    ruleId: "security.checklist.6.9.incidentResponse",
    category: "security",
    title: "Incident response runbooks are validated",
    description: "Security incident-response runbooks are current and tested",
    severity: "medium",
    metricId: "security.checklist.6.9.incidentResponse",
    remediation: "Review and test incident-response runbooks; record the last validation date.",
    evaluate: () => ({ checkStatus: "manual" }),
  },
];
