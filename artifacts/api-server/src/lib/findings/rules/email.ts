import type { RuleDefinition, RuleOutcome } from "./helpers.js";
import { cis, ce } from "../frameworks/catalogue.js";

interface DomainAuthRecord {
  domain: string;
  hasSpf?: boolean;
  hasDkim?: boolean;
  hasDmarc?: boolean;
  mxConfigured?: boolean;
  dmarcPolicy?: string | null;
  dkimSource?: "exchange" | "dns" | "none";
}

/** Minimal shape of the m365-exchange snapshot consumed by these rules. */
export interface EmailData {
  domainAuthRecords?: DomainAuthRecord[];
}

/** Build one outcome per email domain (each domain is a tracked entity). */
function perDomain(
  records: DomainAuthRecord[] | undefined,
  fn: (r: DomainAuthRecord) => { checkStatus: RuleOutcome["checkStatus"]; detail?: string },
): RuleOutcome[] | null {
  if (!records) return null;
  if (records.length === 0) return [{ checkStatus: "manual", detail: "no verified email domains" }];
  return records.map((r) => {
    const { checkStatus, detail } = fn(r);
    return { target: r.domain, targetLabel: r.domain, checkStatus, detail, evidence: r };
  });
}

export const emailRules: RuleDefinition<EmailData>[] = [
  {
    ruleId: "email.spf",
    category: "email",
    title: "Domain publishes an SPF record",
    description: "An accepted email domain publishes a valid SPF record",
    severity: "high",
    metricId: "email.finding.spf",
    remediation: "Publish an SPF TXT record authorising Microsoft 365 mail (e.g. include:spf.protection.outlook.com).",
    frameworks: [cis("2.1.9"), ce("SC")],
    evaluate: (d) => perDomain(d?.domainAuthRecords, (r) => ({
      checkStatus: r.hasSpf ? "pass" : "fail",
      detail: r.hasSpf ? "SPF present" : "no SPF record",
    })),
  },
  {
    ruleId: "email.dkim",
    category: "email",
    title: "Domain has DKIM signing enabled",
    description: "An accepted email domain has DKIM signing configured",
    severity: "high",
    metricId: "email.finding.dkim",
    remediation: "Enable DKIM signing for the domain in Exchange Online and publish the selector CNAMEs.",
    frameworks: [cis("2.1.9"), ce("SC")],
    evaluate: (d) => perDomain(d?.domainAuthRecords, (r) => ({
      checkStatus: r.hasDkim ? "pass" : "fail",
      detail: r.hasDkim ? `DKIM present (${r.dkimSource ?? "dns"})` : "no DKIM signing",
    })),
  },
  {
    ruleId: "email.dmarc",
    category: "email",
    title: "Domain publishes a DMARC record",
    description: "An accepted email domain publishes a DMARC record",
    severity: "high",
    metricId: "email.finding.dmarc",
    remediation: "Publish a DMARC TXT record at _dmarc.<domain> and progress the policy to quarantine/reject.",
    frameworks: [cis("2.1.9"), ce("SC")],
    evaluate: (d) => perDomain(d?.domainAuthRecords, (r) => ({
      checkStatus: r.hasDmarc ? "pass" : "fail",
      detail: r.hasDmarc ? `DMARC present${r.dmarcPolicy ? ` (${r.dmarcPolicy})` : ""}` : "no DMARC record",
    })),
  },
  {
    ruleId: "email.dmarcEnforced",
    category: "email",
    title: "DMARC policy is enforcing",
    description: "DMARC policy is set to quarantine or reject (not p=none)",
    severity: "medium",
    metricId: "email.finding.dmarcEnforced",
    remediation: "Move the DMARC policy from p=none to p=quarantine then p=reject after monitoring reports.",
    frameworks: [cis("2.1.9"), ce("SC")],
    evaluate: (d) => perDomain(d?.domainAuthRecords, (r) => {
      if (!r.hasDmarc) return { checkStatus: "fail", detail: "no DMARC record" };
      const policy = (r.dmarcPolicy ?? "").toLowerCase();
      const enforcing = policy.includes("quarantine") || policy.includes("reject");
      return {
        checkStatus: enforcing ? "pass" : "warning",
        detail: r.dmarcPolicy ? r.dmarcPolicy : "p=none (monitor only)",
      };
    }),
  },
];
