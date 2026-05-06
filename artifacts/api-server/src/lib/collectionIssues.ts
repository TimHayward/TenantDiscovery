import { ClientSecretCredential } from "@azure/identity";

export type CollectionIssueCategory =
  | "permission"
  | "license"
  | "notFound"
  | "throttled"
  | "upstream"
  | "unknown";

export interface CollectionIssue {
  source: string;
  status: number | null;
  category: CollectionIssueCategory;
  message: string;
  retryable: boolean;
  permissionRequired: boolean;
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

let cachedToken: { token: string; expiresOnTimestamp: number } | null = null;

function classifyStatus(status: number | null): CollectionIssueCategory {
  if (status === 401 || status === 403) return "permission";
  if (status === 402) return "license";
  if (status === 404) return "notFound";
  if (status === 429) return "throttled";
  if (status !== null && status >= 500) return "upstream";
  return "unknown";
}

function createIssue(
  source: string,
  status: number | null,
  message: string,
): CollectionIssue {
  const category = classifyStatus(status);
  return {
    source,
    status,
    category,
    message,
    retryable: category === "throttled" || category === "upstream",
    permissionRequired: category === "permission",
  };
}

export function createCollectionIssue(
  source: string,
  status: number | null,
  message: string,
): CollectionIssue {
  return createIssue(source, status, message);
}

async function getGraphAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresOnTimestamp - now > 60_000) {
    return cachedToken.token;
  }

  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET must be set.",
    );
  }

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const token = await credential.getToken("https://graph.microsoft.com/.default");

  if (!token?.token || !token.expiresOnTimestamp) {
    throw new Error("Failed to acquire Graph access token.");
  }

  cachedToken = {
    token: token.token,
    expiresOnTimestamp: token.expiresOnTimestamp,
  };

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
): Promise<JsonFetchResult<T>> {
  try {
    const token = await getGraphAccessToken();
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      const message = await readResponseError(resp);
      return {
        data: null,
        issue: createIssue(source, resp.status, message),
      };
    }

    const data = (await resp.json()) as T;
    return { data, issue: null };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected Graph request failure";
    return {
      data: null,
      issue: createIssue(source, null, message),
    };
  }
}

export async function fetchGraphText(
  url: string,
  source: string,
): Promise<TextFetchResult> {
  try {
    const token = await getGraphAccessToken();
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      const message = await readResponseError(resp);
      return {
        text: null,
        issue: createIssue(source, resp.status, message),
      };
    }

    const text = await resp.text();
    return { text, issue: null };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected Graph request failure";
    return {
      text: null,
      issue: createIssue(source, null, message),
    };
  }
}

export async function fetchAllGraphPages<T>(
  firstUrl: string,
  source: string,
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
