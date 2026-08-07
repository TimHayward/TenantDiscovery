import { http, HttpResponse, delay, type HttpHandler, type JsonBodyType } from "msw";
import type { ZodTypeAny } from "zod";
import {
  GetM365CollectionStatusResponse,
  GetM365ConnectionTestResponse,
  GetM365DataSourcesResponse,
  GetM365LicensesWithMetadataResponse,
  GetM365OverviewResponse,
  GetM365OverviewWithMetadataResponse,
  GetM365ServiceHealthWithMetadataResponse,
  GetM365UsersResponse,
  GetOnboardingStatusResponse,
} from "@workspace/api-zod";
import {
  collectionStatusFixture,
  connectionTestFixture,
  dataSourcesFixture,
  onboardingStatusFixture,
  snapshot,
  withMetadata,
} from "./fixtures";

/**
 * The HTTP layer the dashboard tests run against.
 *
 * The generated React Query hooks are never mocked. Every test drives the real
 * `useGetM365...` hook, the real generated client and the real React Query
 * cache, and only the network beneath them is replaced. A hook mock would pass
 * whether or not the client still parses what the server sends; this does not.
 *
 * Every body is checked against the Zod schema generated from the same OpenAPI
 * document the client is generated from, at the moment the handler is built. A
 * fixture that has fallen behind the contract therefore fails at `server.use`
 * with the field named, rather than quietly rendering a component against a
 * shape the server can no longer produce.
 *
 * Note that those schemas are `zod.object`, so they reject a missing or
 * wrongly-typed field but tolerate an extra one. That is deliberate here: the
 * snapshots under `fixtures/` carry `partialData`, `permissionError` and
 * `collectionIssues`, which several routes return and the OpenAPI document does
 * not yet declare. Rejecting extras would fail on that divergence rather than
 * on a real regression. See the report's follow-ups.
 */

export interface Endpoint {
  readonly method: "get" | "post";
  readonly path: string;
  /** `null` where the OpenAPI document declares no response body schema. */
  readonly schema: ZodTypeAny | null;
}

/**
 * Every endpoint the tests touch, with the schema its body must satisfy.
 *
 * To add one: find the path in `lib/api-client-react/src/generated/api.ts`
 * (the `get<Operation>Url` helper), find the matching `...Response` schema in
 * `lib/api-zod/src/generated/api.ts`, and add an entry here. If it has a
 * fixture snapshot, add it to `defaultHandlers` too.
 */
export const endpoints = {
  overview: {
    method: "get",
    path: "/api/m365/overview",
    schema: GetM365OverviewResponse,
  },
  overviewWithMetadata: {
    method: "get",
    path: "/api/m365/overview/with-metadata",
    schema: GetM365OverviewWithMetadataResponse,
  },
  licensesWithMetadata: {
    method: "get",
    path: "/api/m365/licenses/with-metadata",
    schema: GetM365LicensesWithMetadataResponse,
  },
  serviceHealthWithMetadata: {
    method: "get",
    path: "/api/m365/service-health/with-metadata",
    schema: GetM365ServiceHealthWithMetadataResponse,
  },
  users: {
    method: "get",
    path: "/api/m365/users",
    schema: GetM365UsersResponse,
  },
  connectionTest: {
    method: "get",
    path: "/api/m365/connection-test",
    schema: GetM365ConnectionTestResponse,
  },
  collectionStatus: {
    method: "get",
    path: "/api/m365/collection-status",
    schema: GetM365CollectionStatusResponse,
  },
  dataSources: {
    method: "get",
    path: "/api/m365/data-sources",
    schema: GetM365DataSourcesResponse,
  },
  onboardingStatus: {
    method: "get",
    path: "/api/onboarding/status",
    schema: GetOnboardingStatusResponse,
  },
  // 202 Accepted with an acknowledgement body the OpenAPI document does not
  // model, so there is nothing to validate against.
  refresh: {
    method: "post",
    path: "/api/m365/refresh",
    schema: null,
  },
} as const satisfies Record<string, Endpoint>;

export type EndpointName = keyof typeof endpoints;

function validate(endpoint: Endpoint, body: unknown): void {
  if (endpoint.schema === null) return;

  const result = endpoint.schema.safeParse(body);
  if (result.success) return;

  const issues = result.error.issues
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `The fixture for ${endpoint.method.toUpperCase()} ${endpoint.path} does not ` +
      `satisfy its generated Zod schema:\n${issues}\n\n` +
      `Either the fixture is wrong, or the API contract has moved and the ` +
      `fixture has not followed it.`,
  );
}

/** A handler answering `endpoint` with `body` and 200. */
export function ok(endpoint: Endpoint, body: JsonBodyType): HttpHandler {
  validate(endpoint, body);
  return http[endpoint.method](endpoint.path, () => HttpResponse.json(body));
}

/** A handler answering `endpoint` with `status` and a problem-shaped body. */
export function failure(endpoint: Endpoint, status = 500, detail?: string): HttpHandler {
  return http[endpoint.method](endpoint.path, () =>
    HttpResponse.json(
      { title: "Request failed", detail: detail ?? `The test asked for ${status}.` },
      { status },
    ),
  );
}

/**
 * A handler that never answers, so the caller stays in its loading state for
 * the whole test. Preferable to a timer: there is no duration to tune and
 * nothing to leak once MSW is reset.
 */
export function pending(endpoint: Endpoint): HttpHandler {
  return http[endpoint.method](endpoint.path, async () => {
    await delay("infinite");
    return HttpResponse.json({});
  });
}

/**
 * The baseline: every endpoint above answered from the demonstration profile.
 *
 * A test overrides one of these with `server.use(ok(endpoints.x, ...))` rather
 * than rebuilding the set, so what a test says out loud is only what it varies.
 */
export function defaultHandlers(): HttpHandler[] {
  const overview = snapshot("m365-overview");
  const licenses = snapshot("m365-licenses");
  const serviceHealth = snapshot("m365-service-health");

  return [
    ok(endpoints.overview, overview),
    ok(endpoints.overviewWithMetadata, withMetadata(overview)),
    ok(endpoints.licensesWithMetadata, withMetadata(licenses)),
    ok(endpoints.serviceHealthWithMetadata, withMetadata(serviceHealth)),
    ok(endpoints.users, snapshot("m365-users")),
    ok(endpoints.connectionTest, connectionTestFixture),
    ok(endpoints.collectionStatus, collectionStatusFixture),
    ok(endpoints.dataSources, dataSourcesFixture),
    ok(endpoints.onboardingStatus, onboardingStatusFixture),
    http.post(endpoints.refresh.path, () =>
      HttpResponse.json({ status: "accepted" }, { status: 202 }),
    ),
  ];
}
