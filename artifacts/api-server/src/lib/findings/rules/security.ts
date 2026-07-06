import type { RuleDefinition, RuleOutcome } from "./helpers.js";
import { cis, ce } from "../frameworks/catalogue.js";
import type { Severity } from "../types.js";

/** Minimal shape of the m365-security snapshot consumed by these rules. */
interface SecurityData {
  secureScorePercent?: number;
  mfaEnabledPercent?: number;
  enabledCAPs?: number;
  riskyUsers?: number;
  riskyUsersDetail?: Array<{
    id?: string;
    displayName?: string;
    userPrincipalName?: string;
    riskLevel?: string;
    riskState?: string;
  }>;
  secureScoreControls?: Array<{
    status?: string;
    controlName?: string;
    title?: string;
    controlCategory?: string;
  }>;
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
      return [{ checkStatus: pct >= 70 ? "pass" : pct >= 50 ? "warning" : "fail", detail: `${pct}%` }];
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
    frameworks: [cis("5.1.2"), ce("UAC")],
    evaluate: (d) => {
      if (!d) return null;
      const pct = d.mfaEnabledPercent ?? 0;
      return [{ checkStatus: pct >= 90 ? "pass" : pct >= 75 ? "warning" : "fail", detail: `${pct}% coverage` }];
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
    frameworks: [cis("5.2.2"), ce("UAC")],
    evaluate: (d) => {
      if (!d) return null;
      const n = d.enabledCAPs ?? 0;
      return [{ checkStatus: n >= 3 ? "pass" : n > 0 ? "warning" : "fail", detail: `${n} enabled` }];
    },
  },
  {
    ruleId: "security.checklist.6.4.riskyUsers",
    category: "security",
    title: "Risky user",
    description: "Identity Protection flagged this user as risky",
    severity: "high",
    metricId: "security.checklist.6.4.riskyUsers",
    remediation: "Investigate and remediate risky users in Identity Protection; require password reset where appropriate.",
    evaluate: (d) => {
      if (!d) return null;
      const users = d.riskyUsersDetail ?? [];
      return users.map((u) => {
        const level = (u.riskLevel ?? "none").toLowerCase();
        const severity: Severity = level === "high" ? "high" : level === "low" ? "low" : "medium";
        const label = u.userPrincipalName || u.displayName || u.id || "unknown";
        return {
          target: u.id ?? label,
          targetLabel: label,
          severity,
          checkStatus: level === "low" ? "warning" : "fail",
          detail: `risk ${u.riskLevel ?? "unknown"}${u.riskState ? `, ${u.riskState}` : ""}`,
          evidence: u,
        } satisfies RuleOutcome;
      });
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
    evaluate: () => [{ checkStatus: "manual" }],
  },
  {
    ruleId: "security.checklist.6.6.phishingResistantMfa",
    category: "security",
    title: "Phishing-resistant authentication is adopted",
    description: "Privileged users use phishing-resistant methods",
    severity: "medium",
    metricId: "security.checklist.6.6.phishingResistantMfa",
    remediation: "Roll out FIDO2 / certificate-based / Windows Hello for Business to privileged users.",
    frameworks: [cis("5.1.2"), ce("UAC")],
    evaluate: (d) => {
      const count = d?.mfaMethodsBreakdown?.find((m) => m.strength === "Phishing-resistant")?.count ?? 0;
      return count > 0
        ? [{ checkStatus: "warning", detail: `${count} users registered` }]
        : [{ checkStatus: "manual" }];
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
    frameworks: [cis("5.2.2"), ce("UAC")],
    evaluate: () => [{ checkStatus: "manual" }],
  },
  {
    ruleId: "security.checklist.6.8.controlBacklog",
    category: "security",
    title: "Secure Score control not configured",
    description: "A Secure Score control has not been configured",
    severity: "medium",
    metricId: "security.checklist.6.8.controlBacklog",
    remediation: "Prioritise and remediate the not-configured Secure Score controls.",
    evaluate: (d) => {
      if (!d) return null;
      return (d.secureScoreControls ?? [])
        .filter((c) => c.status === "notConfigured")
        .map((c) => {
          const label = c.title || c.controlName || "unknown control";
          return {
            target: c.controlName ?? label,
            targetLabel: label,
            checkStatus: "fail",
            detail: c.controlCategory ? `category ${c.controlCategory}` : undefined,
            evidence: c,
          } satisfies RuleOutcome;
        });
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
    evaluate: () => [{ checkStatus: "manual" }],
  },
];
