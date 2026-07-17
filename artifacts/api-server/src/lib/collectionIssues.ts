import { ClientSecretCredential } from "@azure/identity";
import { getPermissionDefinition } from "@workspace/permissions-manifest";
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

interface JsonFetchResult<T> {
  data: T | null;
  issue: CollectionIssue | null;
}

interface TextFetchResult {
  text: string | null;
  issue: CollectionIssue | null;
}

interface PagedFetchResult<T> {
  items: T[];
  issues: CollectionIssue[];
  partialData: boolean;
  permissionError: boolean;
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
 * (`GRAPH_FETCH_TIMEOUT_MS` / `GRAPH_MAX_RETRIES`).
 */
export async function fetchResourceWithRetry(
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
        const delay = Math.min(MAX_RETRY_DELAY_MS, retryAfter ?? backoffDelayMs(attempt));
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

export async function fetchGraphJson<T>(
  url: string,
  source: string,
  extraHeaders?: Record<string, string>,
  requiredPermissionNames?: string[],
): Promise<JsonFetchResult<T>> {
  try {
    const resp = await graphFetchWithRetry(url, extraHeaders);

    if (!resp.ok) {
      const message = await readResponseError(resp);
      return {
        data: null,
        issue: createIssue(source, resp.status, message, requiredPermissionNames),
      };
    }

    const data = (await resp.json()) as T;
    return { data, issue: null };
  } catch (error) {
    const message = isAbortError(error)
      ? `${source} timed out after ${FETCH_TIMEOUT_MS / 1000}s`
      : error instanceof Error ? error.message : "Unexpected Graph request failure";
    const issue = createIssue(source, null, message, requiredPermissionNames);
    if (isAbortError(error)) {
      issue.category = "upstream";
      issue.retryable = true;
    }
    return { data: null, issue };
  }
}

export async function fetchGraphText(
  url: string,
  source: string,
  requiredPermissionNames?: string[],
): Promise<TextFetchResult> {
  try {
    const resp = await graphFetchWithRetry(url);

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
    const message = isAbortError(error)
      ? `${source} timed out after ${FETCH_TIMEOUT_MS / 1000}s`
      : error instanceof Error ? error.message : "Unexpected Graph request failure";
    const issue = createIssue(source, null, message, requiredPermissionNames);
    if (isAbortError(error)) {
      issue.category = "upstream";
      issue.retryable = true;
    }
    return { text: null, issue };
  }
}

export async function fetchAllGraphPages<T>(
  firstUrl: string,
  source: string,
  requiredPermissionNames?: string[],
): Promise<PagedFetchResult<T>> {
  const items: T[] = [];
  const issues: CollectionIssue[] = [];
  let url: string | null = firstUrl;
  let pageNumber = 0;

  while (url) {
    pageNumber += 1;
    const pageSource = `${source}:page${pageNumber}`;
    const pageResult: JsonFetchResult<{ value?: T[]; "@odata.nextLink"?: string }> =
      await fetchGraphJson<{ value?: T[]; "@odata.nextLink"?: string }>(
        url,
        pageSource,
        undefined,
        requiredPermissionNames,
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
    url = pageResult.data?.["@odata.nextLink"] ?? null;
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

export function isPermissionIssue(issue: CollectionIssue): boolean {
  return issue.permissionRequired;
}
