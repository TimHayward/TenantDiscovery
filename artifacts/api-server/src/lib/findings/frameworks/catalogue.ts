import type { FrameworkId, FrameworkRef, Severity } from "../types.js";

/**
 * A single control in a recognised security baseline. Findings bind to controls
 * via {@link FrameworkRef}; the coverage engine rolls findings up per control.
 *
 * Control identifiers follow the published benchmarks:
 *  - CIS-M365: CIS Microsoft 365 Foundations Benchmark section numbers.
 *  - NCSC-CE:  NCSC Cyber Essentials uses five thematic controls (not numbered),
 *              so we use short stable theme codes (UAC, SC, SUM, MPM, FW).
 */
export interface FrameworkControl {
  framework: FrameworkId;
  controlId: string;
  title: string;
  requirement: string;
  severity: Severity;
}

/** Human-readable framework names for UI/report headers. */
export const FRAMEWORK_NAMES: Record<FrameworkId, string> = {
  "CIS-M365": "CIS Microsoft 365 Foundations Benchmark",
  "NCSC-CE": "NCSC Cyber Essentials",
};

/** Terse constructors so rules can declare control bindings inline. */
export const cis = (controlId: string): FrameworkRef => ({ framework: "CIS-M365", controlId });
export const ce = (controlId: string): FrameworkRef => ({ framework: "NCSC-CE", controlId });

/**
 * The seeded control catalogue. Kept intentionally focused on the controls the
 * current rule set produces evidence for; extend as rule coverage grows.
 */
export const frameworkControls: FrameworkControl[] = [
  // ── CIS Microsoft 365 Foundations Benchmark ──────────────────────────────
  {
    framework: "CIS-M365",
    controlId: "1.1.1",
    title: "Administrative accounts are separate and unlicensed",
    requirement: "Privileged roles use dedicated, cloud-only accounts without productivity licences.",
    severity: "high",
  },
  {
    framework: "CIS-M365",
    controlId: "1.1.3",
    title: "Between two and four global administrators are designated",
    requirement: "Limit standing Global Administrator assignments to a small, named set.",
    severity: "high",
  },
  {
    framework: "CIS-M365",
    controlId: "1.1.4",
    title: "Stale and disabled accounts are reviewed",
    requirement: "Disabled or long-inactive accounts are deprovisioned or relicensed.",
    severity: "medium",
  },
  {
    framework: "CIS-M365",
    controlId: "1.3.3",
    title: "Guest access is reviewed",
    requirement: "External guest accounts are inventoried and stale guests removed.",
    severity: "medium",
  },
  {
    framework: "CIS-M365",
    controlId: "5.1.2",
    title: "Multi-factor authentication is enforced for users",
    requirement: "All users are registered for and required to use strong authentication.",
    severity: "critical",
  },
  {
    framework: "CIS-M365",
    controlId: "5.2.2",
    title: "Conditional Access baseline policies are enabled",
    requirement: "Baseline Conditional Access (MFA, legacy-auth block, risk) policies are active.",
    severity: "high",
  },
  {
    framework: "CIS-M365",
    controlId: "5.1.5.1",
    title: "User app registration and consent is restricted",
    requirement: "Standard users cannot register apps or grant tenant-wide consent unchecked.",
    severity: "medium",
  },
  {
    framework: "CIS-M365",
    controlId: "1.4.1",
    title: "Application credentials are governed",
    requirement: "App registrations have owners and no expired or excessively long-lived secrets.",
    severity: "medium",
  },
  {
    framework: "CIS-M365",
    controlId: "2.1.9",
    title: "DMARC, SPF and DKIM are published for domains",
    requirement: "Each email domain publishes SPF, DKIM and an enforcing DMARC record.",
    severity: "high",
  },
  {
    framework: "CIS-M365",
    controlId: "7.2.3",
    title: "External and anonymous sharing is controlled",
    requirement: "SharePoint/OneDrive anonymous sharing is restricted and links expire.",
    severity: "medium",
  },
  {
    framework: "CIS-M365",
    controlId: "3.1.1",
    title: "Device compliance is enforced",
    requirement: "Managed devices are compliant, encrypted and protected.",
    severity: "high",
  },

  // ── NCSC Cyber Essentials (five thematic controls) ───────────────────────
  {
    framework: "NCSC-CE",
    controlId: "UAC",
    title: "User access control",
    requirement: "Accounts are least-privilege, MFA-protected and removed when no longer needed.",
    severity: "high",
  },
  {
    framework: "NCSC-CE",
    controlId: "SC",
    title: "Secure configuration",
    requirement: "Services and devices are securely configured and unnecessary exposure is removed.",
    severity: "high",
  },
  {
    framework: "NCSC-CE",
    controlId: "MPM",
    title: "Malware protection",
    requirement: "Malware protection is enabled and tamper-resistant across devices.",
    severity: "high",
  },
  {
    framework: "NCSC-CE",
    controlId: "SUM",
    title: "Security update management",
    requirement: "Devices are supported, compliant and kept up to date.",
    severity: "high",
  },
  {
    framework: "NCSC-CE",
    controlId: "FW",
    title: "Firewalls",
    requirement: "Boundary and host-based firewalls protect devices and only necessary services are exposed.",
    severity: "high",
  },
];

const controlByKey = new Map<string, FrameworkControl>(
  frameworkControls.map((c) => [`${c.framework}:${c.controlId}`, c]),
);

/** Look up a control definition by framework + control id. */
export function getFrameworkControl(ref: FrameworkRef): FrameworkControl | undefined {
  return controlByKey.get(`${ref.framework}:${ref.controlId}`);
}
