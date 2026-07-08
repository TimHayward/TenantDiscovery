import { getAccessToken, createCollectionIssue, type CollectionIssue } from "./collectionIssues.js";
import { getGraphCredentialValues } from "./graphClient.js";

const EXO_SCOPE = "https://outlook.office365.com/.default";
const EXO_TIMEOUT_MS = 25_000;

export interface DkimSigningConfig {
  /** Domain the signing config applies to (lower-cased). */
  domain: string;
  /** Whether DKIM signing is enabled for the domain. */
  enabled: boolean;
}

export interface DkimSigningResult {
  /** Map of lower-cased domain → DKIM enabled, or `null` when EXO data is unavailable. */
  byDomain: Map<string, boolean> | null;
  issues: CollectionIssue[];
}

/**
 * Whether app-only Exchange Online access is possible under the current credential.
 * App-only EXO access requires certificate-based app auth plus the `Exchange.ManageAsApp`
 * permission and a directory role (see backlog 6.1); the graph client only builds a
 * client-secret credential today, so this is always false until that lands.
 */
export function isExchangeCertAuthConfigured(): boolean {
  return false;
}

/**
 * Fetch DKIM signing configuration for all domains via the Exchange Online REST admin
 * API (the same endpoint EXO PowerShell V3 uses under the hood, `Get-DkimSigningConfig`).
 *
 * NOTE: app-only Exchange Online access requires certificate-based app auth plus the
 * `Exchange.ManageAsApp` permission and a directory role. The current client-secret
 * credential will typically be rejected (401/403); callers should treat a `null`
 * `byDomain` as "unavailable" and fall back to DNS-based DKIM detection.
 */
export async function fetchDkimSigningConfigs(): Promise<DkimSigningResult> {
  const issues: CollectionIssue[] = [];
  const source = "exchangeOnlineDkim";

  let tenantId: string;
  try {
    ({ tenantId } = await getGraphCredentialValues());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Missing credentials";
    issues.push(createCollectionIssue(source, null, message));
    return { byDomain: null, issues };
  }

  let token: string;
  try {
    token = await getAccessToken(EXO_SCOPE);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to acquire Exchange Online token";
    issues.push(createCollectionIssue(source, null, message));
    return { byDomain: null, issues };
  }

  const url = `https://outlook.office365.com/adminapi/beta/${encodeURIComponent(tenantId)}/InvokeCommand`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        CmdletInput: { CmdletName: "Get-DkimSigningConfig", Parameters: {} },
      }),
      signal: AbortSignal.timeout(EXO_TIMEOUT_MS),
    });

    if (!resp.ok) {
      const raw = await resp.text().catch(() => "");
      // EXO can return binary/non-printable bodies (e.g. on 401); fall back to a clean message.
      const printable = raw.replace(/[^\x20-\x7E]/g, "").trim();
      const message =
        printable.slice(0, 300) ||
        `Exchange Online request failed with status ${resp.status}` +
          (resp.status === 401 || resp.status === 403
            ? " (requires certificate-based app auth with Exchange.ManageAsApp)"
            : "");
      issues.push(createCollectionIssue(source, resp.status, message));
      return { byDomain: null, issues };
    }

    const data = (await resp.json()) as { value?: Array<Record<string, unknown>> };
    const configs: Array<Record<string, unknown>> = Array.isArray(data.value) ? data.value : [];

    const byDomain = new Map<string, boolean>();
    for (const cfg of configs) {
      const domain = (cfg.Domain ?? cfg.Identity ?? cfg.Name) as string | undefined;
      if (typeof domain !== "string" || !domain) continue;
      byDomain.set(domain.toLowerCase(), cfg.Enabled === true);
    }

    return { byDomain, issues };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Exchange Online request failed";
    issues.push(createCollectionIssue(source, null, message));
    return { byDomain: null, issues };
  }
}
