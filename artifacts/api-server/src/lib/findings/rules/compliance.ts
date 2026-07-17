import type { RuleDefinition } from "./helpers.js";

/** Minimal shape of the m365-compliance snapshot consumed by these rules. */
export interface ComplianceData {
  auditLogEnabled?: boolean;
  unifiedAuditLogEnabled?: boolean;
  sensitivityLabels?: number;
  dlpPolicies?: number;
  activeDlpPolicies?: number;
  retentionLabelCount?: number | null;
  retentionEvidence?: "apiBacked" | "manual";
}

export const complianceRules: RuleDefinition<ComplianceData>[] = [
  {
    ruleId: "compliance.checklist.7.1.backup",
    category: "compliance",
    title: "Data backups are configured",
    description: "Microsoft 365 backup or 3rd-party backup solution is configured",
    severity: "high",
    metricId: "compliance.checklist.7.1.backup",
    remediation: "Deploy a Microsoft 365 backup (native or third-party) covering Exchange, SharePoint, OneDrive and Teams.",
    evaluate: () => [{ checkStatus: "manual" }],
  },
  {
    ruleId: "compliance.checklist.7.1.backupTest",
    category: "compliance",
    title: "Backup restoration has been tested",
    description: "Backup restoration has been tested",
    severity: "medium",
    metricId: "compliance.checklist.7.1.backupTest",
    remediation: "Perform and document a test restore to validate recovery objectives.",
    evaluate: () => [{ checkStatus: "manual" }],
  },
  {
    ruleId: "compliance.checklist.7.2.auditLogging",
    category: "compliance",
    title: "Audit logging is enabled",
    description: "Unified Audit Log is enabled",
    severity: "high",
    metricId: "compliance.checklist.7.2.auditLogging",
    remediation: "Enable the Unified Audit Log in the Purview compliance portal.",
    evaluate: (d) => {
      if (!d) return null;
      const enabled = (d.auditLogEnabled && d.unifiedAuditLogEnabled) ?? false;
      return [{ checkStatus: enabled ? "pass" : "fail", detail: enabled ? "Enabled" : "Not enabled" }];
    },
  },
  {
    ruleId: "compliance.checklist.7.2.auditRetention",
    category: "compliance",
    title: "Audit log retention is appropriate",
    description: "Audit log data is retained for an appropriate period",
    severity: "medium",
    metricId: "compliance.checklist.7.2.auditRetention",
    remediation: "Configure audit log retention policies to meet your retention requirements.",
    evaluate: () => [{ checkStatus: "manual" }],
  },
  {
    ruleId: "compliance.checklist.7.3.retentionPolicies",
    category: "compliance",
    title: "Retention labels are published",
    description: "Retention labels are published for key data sources",
    severity: "medium",
    metricId: "compliance.checklist.7.3.retentionPolicies",
    remediation: "Publish retention labels covering key workloads; validate scope and justify uncovered repositories.",
    evaluate: (d) => {
      if (!d) return null;
      // Manual when the retention labels API was unavailable; otherwise pass/fail on count.
      if (d.retentionEvidence !== "apiBacked" || d.retentionLabelCount == null) {
        return [{ checkStatus: "manual" }];
      }
      const n = d.retentionLabelCount;
      return [{ checkStatus: n > 0 ? "pass" : "fail", detail: `${n} retention labels published` }];
    },
  },
  {
    ruleId: "compliance.checklist.7.4.sensitivityLabels",
    category: "compliance",
    title: "Sensitivity labels are implemented",
    description: "Sensitivity labels are published for users",
    severity: "medium",
    metricId: "compliance.checklist.7.4.sensitivityLabels",
    remediation: "Publish sensitivity labels and assign them to users via a label policy.",
    evaluate: (d) => {
      if (!d) return null;
      const n = d.sensitivityLabels ?? 0;
      return [{ checkStatus: n > 0 ? "pass" : "fail", detail: `${n} labels configured` }];
    },
  },
  {
    ruleId: "compliance.checklist.7.4.autoLabeling",
    category: "compliance",
    title: "Automatic labelling is configured",
    description: "Labels are applied automatically based on content scanning",
    severity: "low",
    metricId: "compliance.checklist.7.4.autoLabeling",
    remediation: "Configure auto-labelling policies for sensitive information types.",
    evaluate: () => [{ checkStatus: "manual" }],
  },
  {
    ruleId: "compliance.checklist.7.5.dlpPolicies",
    category: "compliance",
    title: "DLP policies are implemented",
    description: "DLP policies exist for sensitive data types",
    severity: "high",
    metricId: "compliance.checklist.7.5.dlpPolicies",
    remediation: "Create and enable DLP policies for sensitive data types across workloads.",
    evaluate: (d) => {
      if (!d) return null;
      const total = d.dlpPolicies ?? 0;
      const active = d.activeDlpPolicies ?? 0;
      if (total === 0) return [{ checkStatus: "fail", detail: "No DLP policies found" }];
      return active > 0
        ? [{ checkStatus: "pass", detail: `${active} active DLP policies` }]
        : [{ checkStatus: "warning", detail: `${total} policies (none active)` }];
    },
  },
  {
    ruleId: "compliance.checklist.7.5.dlpCoverage",
    category: "compliance",
    title: "DLP coverage spans all workloads",
    description: "DLP policies cover Exchange, SharePoint, Teams, and endpoints",
    severity: "medium",
    metricId: "compliance.checklist.7.5.dlpCoverage",
    remediation: "Extend DLP coverage to Exchange, SharePoint, Teams and endpoint locations.",
    evaluate: () => [{ checkStatus: "manual" }],
  },
];
