import type { RuleDefinition } from "./helpers.js";
import { cis, ce } from "../frameworks/catalogue.js";

/** Minimal shape of the m365-intune snapshot consumed by these rules. */
export interface DevicesData {
  totalDevices?: number;
  overallCompliancePercent?: number;
  nonCompliantDevices?: number;
  encryptionPercent?: number;
  deviceListAvailable?: boolean;
  tamperProtectionPercent?: number;
  tamperProtectionEnabledDevices?: number;
  tamperProtectionDisabledDevices?: number;
  jailbrokenCount?: number;
  totalCompliancePolicies?: number;
  permissionRequired?: boolean;
}

export const devicesRules: RuleDefinition<DevicesData>[] = [
  {
    ruleId: "devices.compliance",
    category: "devices",
    title: "Managed devices are compliant",
    description: "Intune-managed devices meet compliance policy",
    severity: "high",
    metricId: "devices.finding.compliance",
    remediation: "Investigate non-compliant devices and remediate failing settings or retire stale devices.",
    frameworks: [cis("3.1.1"), ce("SUM")],
    evaluate: (d) => {
      if (!d) return null;
      if (d.permissionRequired || (d.totalDevices ?? 0) === 0) return [{ checkStatus: "manual" }];
      const pct = d.overallCompliancePercent ?? 0;
      const status = pct >= 90 ? "pass" : pct >= 70 ? "warning" : "fail";
      return [{ checkStatus: status, detail: `${pct}% compliant, ${d.nonCompliantDevices ?? 0} non-compliant` }];
    },
  },
  {
    ruleId: "devices.encryption",
    category: "devices",
    title: "Managed devices are encrypted",
    description: "Intune-managed devices report disk encryption enabled",
    severity: "high",
    metricId: "devices.finding.encryption",
    remediation: "Enforce disk encryption (BitLocker/FileVault) via Intune configuration profiles.",
    frameworks: [cis("3.1.1"), ce("SC")],
    evaluate: (d) => {
      if (!d) return null;
      if (!d.deviceListAvailable) return [{ checkStatus: "manual" }];
      const pct = d.encryptionPercent ?? 0;
      const status = pct >= 90 ? "pass" : pct >= 70 ? "warning" : "fail";
      return [{ checkStatus: status, detail: `${pct}% encrypted` }];
    },
  },
  {
    ruleId: "devices.tamperProtection",
    category: "devices",
    title: "Tamper protection is enabled on Windows devices",
    description: "Windows devices report Defender tamper protection enabled",
    severity: "medium",
    metricId: "devices.finding.tamperProtection",
    remediation: "Enable tamper protection via the Defender/Intune security baseline.",
    frameworks: [ce("MPM")],
    evaluate: (d) => {
      if (!d) return null;
      const reported = (d.tamperProtectionEnabledDevices ?? 0) + (d.tamperProtectionDisabledDevices ?? 0);
      if (reported === 0) return [{ checkStatus: "manual" }];
      const pct = d.tamperProtectionPercent ?? 0;
      const status = pct >= 90 ? "pass" : pct >= 70 ? "warning" : "fail";
      return [{ checkStatus: status, detail: `${pct}% of reporting Windows devices` }];
    },
  },
  {
    ruleId: "devices.jailbroken",
    category: "devices",
    title: "No jailbroken or rooted devices are managed",
    description: "Managed devices are not flagged as jailbroken or rooted",
    severity: "high",
    metricId: "devices.finding.jailbroken",
    remediation: "Block and remediate jailbroken/rooted devices via compliance policy.",
    frameworks: [ce("SC")],
    evaluate: (d) => {
      if (!d || !d.deviceListAvailable) return null;
      const n = d.jailbrokenCount ?? 0;
      return [{ checkStatus: n === 0 ? "pass" : "fail", detail: n === 0 ? "None detected" : `${n} device(s) flagged` }];
    },
  },
  {
    ruleId: "devices.compliancePolicies",
    category: "devices",
    title: "Device compliance policies are configured",
    description: "At least one Intune device compliance policy is defined",
    severity: "medium",
    metricId: "devices.finding.compliancePolicies",
    remediation: "Define and assign device compliance policies for each managed platform.",
    frameworks: [cis("3.1.1"), ce("SC")],
    evaluate: (d) => {
      if (!d || d.permissionRequired) return [{ checkStatus: "manual" }];
      const n = d.totalCompliancePolicies ?? 0;
      return [{ checkStatus: n > 0 ? "pass" : "fail", detail: `${n} compliance polic${n === 1 ? "y" : "ies"}` }];
    },
  },
  {
    // Cyber Essentials' Firewalls theme covers boundary and host firewall
    // configuration, which the app-only Graph model cannot evidence today
    // (no firewall-policy collector exists). Emit an explicit Manual Check so
    // the NCSC-CE "FW" control shows as a first-class manual item in coverage
    // rather than silently reading as not-assessed.
    ruleId: "devices.firewall",
    category: "devices",
    title: "Host and boundary firewalls are configured",
    description: "Devices run a correctly configured firewall exposing only necessary services (Cyber Essentials: Firewalls)",
    severity: "high",
    metricId: "devices.finding.firewall",
    remediation: "Review firewall configuration via Intune endpoint security firewall policies or device baselines; confirm only required inbound services are permitted.",
    frameworks: [ce("FW")],
    evaluate: () => [{ checkStatus: "manual" }],
  },
];
