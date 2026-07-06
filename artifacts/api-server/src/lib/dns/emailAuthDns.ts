import { createCollectionIssue, type CollectionIssue } from "../collectionIssues.js";

const DNS_TIMEOUT_MS = 25_000;

/**
 * Resolve over DNS-over-HTTPS (port 443) rather than the host's c-ares/UDP-53 resolver.
 * Many hosting environments block outbound UDP/53 or hand back an unreachable internal
 * resolver, which made the native `node:dns` lookups fail while the records exist
 * publicly. DoH reuses the same HTTPS egress already used for Microsoft Graph.
 */
const DOH_PROVIDERS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
];

/** DNS record type numbers used in DoH JSON `Answer[].type`. */
const DNS_TYPE = { TXT: 16, MX: 15, CNAME: 5 } as const;
type DnsRecordType = keyof typeof DNS_TYPE;

/** Microsoft 365 default DKIM selector hosts checked when EXO data is unavailable. */
const M365_DKIM_SELECTORS = ["selector1._domainkey", "selector2._domainkey"];

interface DohAnswer {
  name: string;
  type: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
}

export interface DnsEmailAuthResult {
  /** True when an SPF TXT record (`v=spf1`) is published. */
  hasSpf: boolean;
  /** The raw SPF record string, when found. */
  spfRecord: string | null;
  /** True when a DMARC TXT record (`v=DMARC1`) is published at `_dmarc.<domain>`. */
  hasDmarc: boolean;
  /** The DMARC policy (`p=` value), when found. */
  dmarcPolicy: string | null;
  /** True when at least one MX host is published. */
  mxConfigured: boolean;
  /** True when an M365 DKIM selector CNAME resolves (DNS-based fallback signal). */
  hasDkimCname: boolean;
  /** Non-fatal lookup failures (excludes "record not present"). */
  issues: CollectionIssue[];
}

/**
 * Query a record type over DoH, trying each provider until one returns a definitive
 * answer. Returns the record `data` strings (empty array for NXDOMAIN/no records),
 * or `null` when every provider failed (a real lookup error, recorded as an issue).
 */
async function dohQuery(
  name: string,
  type: DnsRecordType,
  source: string,
  issues: CollectionIssue[],
): Promise<string[] | null> {
  let lastError = "DoH query failed";

  for (const base of DOH_PROVIDERS) {
    try {
      const url = `${base}?name=${encodeURIComponent(name)}&type=${type}`;
      const resp = await fetch(url, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(DNS_TIMEOUT_MS),
      });

      if (!resp.ok) {
        lastError = `${base} returned HTTP ${resp.status}`;
        continue;
      }

      const json = (await resp.json()) as DohResponse;

      // 0 = NOERROR, 3 = NXDOMAIN — both are definitive answers (NXDOMAIN => no records).
      if (json.Status === 0 || json.Status === 3) {
        const answers = Array.isArray(json.Answer) ? json.Answer : [];
        return answers.filter((a) => a.type === DNS_TYPE[type]).map((a) => a.data);
      }

      lastError = `${base} returned DNS status ${json.Status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "DoH query failed";
    }
  }

  issues.push(createCollectionIssue(`${source}:${name}`, null, lastError));
  return null;
}

/** DoH TXT data arrives quoted and long records are split into adjacent quoted chunks. */
function normalizeTxt(data: string): string {
  return data.replace(/"\s+"/g, "").replace(/"/g, "");
}

function extractDmarcPolicy(record: string): string | null {
  const match = record.match(/(?:^|;)\s*p\s*=\s*([a-zA-Z]+)/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Validate a domain's email authentication against live DNS via DNS-over-HTTPS. Each
 * lookup is isolated so one failure does not mask the others.
 */
export async function lookupDomainEmailAuth(domain: string): Promise<DnsEmailAuthResult> {
  const issues: CollectionIssue[] = [];

  const [txtRecords, dmarcRecords, mxRecords, dkimCnames] = await Promise.all([
    dohQuery(domain, "TXT", "spfLookup", issues),
    dohQuery(`_dmarc.${domain}`, "TXT", "dmarcLookup", issues),
    dohQuery(domain, "MX", "mxLookup", issues),
    Promise.all(
      M365_DKIM_SELECTORS.map((selector) =>
        dohQuery(`${selector}.${domain}`, "CNAME", "dkimCnameLookup", issues),
      ),
    ),
  ]);

  const spfRecord =
    (txtRecords ?? []).map(normalizeTxt).find((r) => r.toLowerCase().includes("v=spf1")) ?? null;
  const dmarcRecord =
    (dmarcRecords ?? []).map(normalizeTxt).find((r) => r.toLowerCase().includes("v=dmarc1")) ?? null;

  return {
    hasSpf: spfRecord !== null,
    spfRecord,
    hasDmarc: dmarcRecord !== null,
    dmarcPolicy: dmarcRecord ? extractDmarcPolicy(dmarcRecord) : null,
    mxConfigured: (mxRecords ?? []).length > 0,
    hasDkimCname: dkimCnames.some((entry) => Array.isArray(entry) && entry.length > 0),
    issues,
  };
}
