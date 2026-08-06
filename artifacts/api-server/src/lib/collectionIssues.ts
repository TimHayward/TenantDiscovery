import { ClientSecretCredential } from "@azure/identity";
import { getPermissionDefinition } from "@workspace/permissions-manifest";
import { withHostLimit } from "./concurrency.js";
import { getGraphCredentialValues } from "./graphClient.js";

export type CollectionIssueCategory =
  | "permission"
  | "license"
  | "notFound"
  | "throttled"
  | "upstream"
  | "unknown";

export interface IssueRequiredPermission {
  name: string;
  accessKind: "application" | "external-scope";
}

export interface CollectionIssue {
  source: string;
  status: number | null;
  category: CollectionIssueCategory;
  message: string;
  retryable: boolean;
  permissionRequired: boolean;
  /** Permissions that would unblock this source. Present only when category is "permission". */
  requiredPermissions?: IssueRequiredPermission[];
}

export interface JsonFetchResult<T> {
  data: T | null;
  issue: CollectionIssue | null;
}

interface TextFetchResult {
  text: string | null;
  issue: CollectionIssue | null;
}

export interface PagedFetchResult<T> {
  items: T[];
  issues: CollectionIssue[];
  partialData: boolean;
  permissionError: boolean;
}

/**
 * Everything a request needs beyond its URL. Collectors that talk to Microsoft
 * Graph use the `fetchGraph*` wrappers below and never construct one of these;
 * collectors that talk to another resource (Defender for Endpoint, for
 * instance) pass their own token scope here rather than hand-rolling a client.
 */
export interface ResourceRequestOptions {
  /** Token scope for the target resource, e.g. `https://api.securitycenter.microsoft.com/.default`. */
  scope: string;
  extraHeaders?: Record<string, string>;
  requiredPermissionNames?: string[];
}

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

/** Per-scope access-token cache so we can issue tokens for Graph and other resources (e.g. Exchange Online). */
const cachedTokens = new Map<string, { token: string; expiresOnTimestamp: number }>();

function getFetchTimeoutMs(): number {
  const configured = Number(process.env.GRAPH_FETCH_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 60_000;
}

const FETCH_TIMEOUT_MS = getFetchTimeoutMs();

function getMaxRetries(): number {
  const configured = Number(process.env.GRAPH_MAX_RETRIES);
  return Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : 3;
}

const MAX_RETRIES = getMaxRetries();
const MAX_RETRY_DELAY_MS = 30_000;
/**
 * Ceiling for a `Retry-After` the server actually sent. Capping a server value
 * at `MAX_RETRY_DELAY_MS` meant that when Graph asked for sixty seconds we
 * waited thirty and retried, which is not politeness, it is a second throttle.
 * The computed backoff keeps the lower cap, because that figure is our guess
 * rather than the server's instruction.
 */
const MAX_SERVER_RETRY_AFTER_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds. */
function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(headerValue);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

/** Exponential backoff with full jitter, capped. */
function backoffDelayMs(attempt: number): number {
  const ceiling = Math.min(MAX_RETRY_DELAY_MS, 500 * 2 ** attempt);
  return ceiling / 2 + Math.random() * (ceiling / 2);
}

/**
 * Fetch a bearer-authenticated resource with bounded retries, acquiring an
 * app-only token for the given scope. Retries throttling (429) and transient
 * upstream (5xx) responses honoring `Retry-After`, and transient
 * network/timeout errors with jittered backoff. Returns the final Response
 * (which may still be non-ok) or throws the last transport error.
 *
 * Exported so non-Graph collectors (e.g. Defender for Endpoint on
 * api.security.microsoft.com) share the same timeout/retry policy
 * (`GRAPH_FETCH_TIMEOUT_MS` / `GRAPH_MAX_RETRIES`) and the same per-host
 * concurrency budget.
 */
export function fetchResourceWithRetry(
  url: string,
  scope: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  // Every outbound collection request passes through here, which is why the
  // limiter is wired in at this point rather than at each call site.
  return withHostLimit(url, () => attemptResourceFetch(url, scope, extraHeaders));
}

async function attemptResourceFetch(
  url: string,
  scope: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      const token = await getAccessToken(scope);
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Accept-Language": "en-US",
          ...extraHeaders,
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      const retryable = resp.status === 429 || resp.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        const retryAfter = parseRetryAfterMs(resp.headers.get("retry-after"));
        // A server-provided wait is honoured up to two minutes. The computed
        // backoff carries its own jitter and its own lower cap.
        const delay = retryAfter !== null
          ? Math.min(MAX_SERVER_RETRY_AFTER_MS, retryAfter)
          : backoffDelayMs(attempt);
        await sleep(delay);
        continue;
      }
      return resp;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await sleep(backoffDelayMs(attempt));
        continue;
      }
      throw lastError;
    }
  }
}

function graphFetchWithRetry(
  url: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return fetchResourceWithRetry(url, GRAPH_SCOPE, extraHeaders);
}

function classifyStatus(status: number | null): CollectionIssueCategory {
  if (status === 401 || status === 403) return "permission";
  if (status === 402) return "license";
  if (status === 404) return "notFound";
  if (status === 429) return "throttled";
  if (status !== null && status >= 500) return "upstream";
  return "unknown";
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function resolveRequiredPermissions(
  names?: string[],
): IssueRequiredPermission[] | undefined {
  if (!names?.length) return undefined;
  return names.map((name) => ({
    name,
    accessKind: getPermissionDefinition(name)?.accessKind ?? "application",
  }));
}

function createIssue(
  source: string,
  status: number | null,
  message: string,
  requiredPermissionNames?: string[],
): CollectionIssue {
  const category = classifyStatus(status);
  return {
    source,
    status,
    category,
    message,
    retryable: category === "throttled" || category === "upstream",
    permissionRequired: category === "permission",
    requiredPermissions:
      category === "permission" ? resolveRequiredPermissions(requiredPermissionNames) : undefined,
  };
}

export function createCollectionIssue(
  source: string,
  status: number | null,
  message: string,
  requiredPermissionNames?: string[],
): CollectionIssue {
  return createIssue(source, status, message, requiredPermissionNames);
}

/** Extract a human-readable message from a thrown Graph/SDK error. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected Graph client error";
}

/** Extract an HTTP status code from a thrown Graph/SDK error, if present. */
export function getErrorStatus(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number") return statusCode;
  }
  return null;
}

/** Acquire an app-only access token for the given resource scope, caching per scope. */
export async function getAccessToken(scope: string): Promise<string> {
  const now = Date.now();
  const cached = cachedTokens.get(scope);
  if (cached && cached.expiresOnTimestamp - now > 60_000) {
    return cached.token;
  }

  const { tenantId, clientId, clientSecret } = await getGraphCredentialValues();
  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const token = await credential.getToken(scope);

  if (!token?.token || !token.expiresOnTimestamp) {
    throw new Error(`Failed to acquire access token for scope ${scope}.`);
  }

  cachedTokens.set(scope, {
    token: token.token,
    expiresOnTimestamp: token.expiresOnTimestamp,
  });

  return token.token;
}

async function readResponseError(resp: Response): Promise<string> {
  try {
    const text = await resp.text();
    if (!text) return `Request failed with status ${resp.status}`;
    try {
      const parsed = JSON.parse(text);
      const parsedMessage =
        parsed?.error?.message ?? parsed?.message ?? parsed?.error_description;
      if (typeof parsedMessage === "string" && parsedMessage.trim()) {
        return parsedMessage;
      }
    } catch {
      // Fall through to raw text.
    }
    return text.slice(0, 300);
  } catch {
    return `Request failed with status ${resp.status}`;
  }
}

/** Turn a thrown transport error into the issue a collector should report. */
function issueFromThrownRequestError(
  error: unknown,
  source: string,
  requiredPermissionNames?: string[],
): CollectionIssue {
  const message = isAbortError(error)
    ? `${source} timed out after ${FETCH_TIMEOUT_MS / 1000}s`
    : error instanceof Error ? error.message : "Unexpected Graph request failure";
  const issue = createIssue(source, null, message, requiredPermissionNames);
  if (isAbortError(error)) {
    issue.category = "upstream";
    issue.retryable = true;
  }
  return issue;
}

/**
 * Fetch and parse JSON from any bearer-authenticated resource, capturing the
 * failure as a `CollectionIssue` rather than throwing.
 *
 * This is the variant `fetchGraphJson` is built on. Collectors on a host other
 * than Microsoft Graph call it with their own scope, so they inherit the
 * timeout, the retry policy, the per-host concurrency budget and the issue
 * capture instead of hand-rolling any of them.
 */
export async function fetchResourceJson<T>(
  url: string,
  source: string,
  options: ResourceRequestOptions,
): Promise<JsonFetchResult<T>> {
  try {
    const resp = await fetchResourceWithRetry(url, options.scope, options.extraHeaders);

    if (!resp.ok) {
      const message = await readResponseError(resp);
      return {
        data: null,
        issue: createIssue(source, resp.status, message, options.requiredPermissionNames),
      };
    }

    const data = (await resp.json()) as T;
    return { data, issue: null };
  } catch (error) {
    return {
      data: null,
      issue: issueFromThrownRequestError(error, source, options.requiredPermissionNames),
    };
  }
}

export function fetchGraphJson<T>(
  url: string,
  source: string,
  extraHeaders?: Record<string, string>,
  requiredPermissionNames?: string[],
): Promise<JsonFetchResult<T>> {
  return fetchResourceJson<T>(url, source, {
    scope: GRAPH_SCOPE,
    extraHeaders,
    requiredPermissionNames,
  });
}

export async function fetchGraphText(
  url: string,
  source: string,
  requiredPermissionNames?: string[],
): Promise<TextFetchResult> {
  try {
    const resp = await fetchResourceWithRetry(url, GRAPH_SCOPE);

    if (!resp.ok) {
      const message = await readResponseError(resp);
      return {
        text: null,
        issue: createIssue(source, resp.status, message, requiredPermissionNames),
      };
    }

    const text = await resp.text();
    return { text, issue: null };
  } catch (error) {
    return { text: null, issue: issueFromThrownRequestError(error, source, requiredPermissionNames) };
  }
}

interface ResourcePage<T> {
  value?: T[];
  "@odata.nextLink"?: string;
  /** Defender for Endpoint spells its continuation token without the OData prefix. */
  nextLink?: string;
}

/**
 * Follow a paged collection on any bearer-authenticated resource to the end,
 * stopping at the first page that fails and reporting what was collected so far.
 *
 * This is the variant `fetchAllGraphPages` is built on; see `fetchResourceJson`
 * for why non-Graph collectors should use it rather than paginating themselves.
 */
export async function fetchAllResourcePages<T>(
  firstUrl: string,
  source: string,
  options: ResourceRequestOptions,
): Promise<PagedFetchResult<T>> {
  const items: T[] = [];
  const issues: CollectionIssue[] = [];
  let url: string | null = firstUrl;
  let pageNumber = 0;

  while (url) {
    pageNumber += 1;
    const pageSource = `${source}:page${pageNumber}`;
    const pageResult: JsonFetchResult<ResourcePage<T>> = await fetchResourceJson<ResourcePage<T>>(
      url,
      pageSource,
      options,
    );

    if (pageResult.issue) {
      issues.push(pageResult.issue);
      break;
    }

    const pageItems = pageResult.data?.value;
    if (!Array.isArray(pageItems)) {
      issues.push(
        createIssue(pageSource, null, "Graph page response did not include a value array."),
      );
      break;
    }

    items.push(...pageItems);
    url = pageResult.data?.["@odata.nextLink"] ?? pageResult.data?.nextLink ?? null;
  }

  const permissionError = issues.some((issue) => issue.permissionRequired);
  const partialData = issues.length > 0;

  return {
    items,
    issues,
    partialData,
    permissionError,
  };
}

export function fetchAllGraphPages<T>(
  firstUrl: string,
  source: string,
  requiredPermissionNames?: string[],
): Promise<PagedFetchResult<T>> {
  return fetchAllResourcePages<T>(firstUrl, source, {
    scope: GRAPH_SCOPE,
    requiredPermissionNames,
  });
}

export function isPermissionIssue(issue: CollectionIssue): boolean {
  return issue.permissionRequired;
}
