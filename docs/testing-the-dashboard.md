# Testing the dashboard

The dashboard is tested with [Vitest](https://vitest.dev) in a jsdom
environment, [Testing Library](https://testing-library.com) for driving and
querying the DOM, and [MSW](https://mswjs.io) for the HTTP layer underneath the
generated API client.

```bash
pnpm --filter @workspace/m365-dashboard run test
pnpm --filter @workspace/m365-dashboard run test -- --coverage
```

The root `pnpm run test` recurses into every package that declares a `test`
script, so it runs this suite too, and so does CI.

This document is the convention, not a tour of what exists. Read it before
adding the first test to a component, because most of the decisions below were
made once and are cheaper to follow than to relitigate.

## Where tests go

A test lives in a `__tests__` directory beside the thing it tests, named
`<Subject>.test.tsx`. That is the api-server's convention and there was no
reason for the dashboard to have a different one.

```
src/components/DataTable.tsx
src/components/__tests__/DataTable.test.tsx
src/pages/tabs/OverviewTab.tsx
src/pages/tabs/__tests__/OverviewTab.test.tsx
```

Everything shared by tests lives in `src/test/`:

| File | What it is |
| --- | --- |
| `setup.ts` | Runs before every test file: jsdom stubs, MSW lifecycle, cleanup. |
| `server.ts` | The MSW server, the record of observed requests, the relative-URL `fetch` shim. |
| `handlers.ts` | The endpoint table, the schema validation, and the default handler set. |
| `fixtures.ts` | Reads the response bodies out of `fixtures/`, and builds the metadata envelope. |
| `render.tsx` | `renderWithProviders`, which mounts the providers `App.tsx` mounts. |
| `jsdomEnvironment.ts` | jsdom, with one correction. See "Traps" below. |

`vitest.config.ts` sits at the package root. It is standalone rather than a
merge of `vite.config.ts`, because that file carries the bundle-budget plugin,
the Replit dev plugins and a dev-server proxy, none of which a test run wants.

## Rendering

Use plain `render` from Testing Library for a component that asks for nothing
from a provider:

```tsx
render(<KPICard title="Total Users" value={250} />);
```

Use `renderWithProviders` as soon as anything in the tree uses React Query,
wouter, Radix's tooltip provider or `next-themes`:

```tsx
import { renderWithProviders } from "@/test/render";

renderWithProviders(<OverviewTab />);
renderWithProviders(<DashboardRoutes />, { path: "/tab/overview" });
```

It gives each render a fresh `QueryClient` with `retry: false` and a zero
`staleTime`, and an in-memory router rather than the jsdom document's history.
It returns `navigate` and `history` alongside the usual Testing Library result,
so a test can drive the router without clicking.

Do not share a `QueryClient` between tests in a file. The second test then
depends on what the first one cached, which is how a suite comes to pass in
order and fail alone.

## Stubbing the API

**The generated hooks are never mocked.** `useGetM365OverviewWithMetadata` and
its fifty siblings run for real; only the network beneath them is replaced. A
test that mocks the hook passes whether or not the generated client still parses
what the server sends, which is precisely the regression worth catching.

Every endpoint the tests touch is declared once in `src/test/handlers.ts`:

```ts
export const endpoints = {
  overviewWithMetadata: {
    method: "get",
    path: "/api/m365/overview/with-metadata",
    schema: GetM365OverviewWithMetadataResponse,
  },
  // ...
} as const satisfies Record<string, Endpoint>;
```

`defaultHandlers()` answers all of them from the `healthy-mid-market` profile
under `fixtures/`, and `setup.ts` installs that set for every test file. A test
that wants something different says only what it varies:

```ts
server.use(failure(endpoints.overviewWithMetadata, 500, "The metric store is unavailable."));
server.use(pending(endpoints.licensesWithMetadata));
server.use(ok(endpoints.licensesWithMetadata, withMetadata(withOverrides(licences, { licenses: [] }))));
```

`server.resetHandlers()` runs after each test, so an override never escapes the
test that made it.

### Adding a handler

1. Find the path. It is the `get<Operation>Url` helper in
   `lib/api-client-react/src/generated/api.ts`. Do not read it off the network
   tab or off a component; that is how a test ends up asserting against a path
   the client no longer uses.
2. Find the schema. It is the matching `<Operation>Response` export in
   `lib/api-zod/src/generated/api.ts`. Both files are generated from the same
   OpenAPI document, so they cannot disagree.
3. Add an entry to `endpoints`. Set `schema: null` only when the OpenAPI
   document genuinely declares no response body, and say why in a comment.
4. If a snapshot for it exists under `fixtures/<profile>/snapshots/`, add it to
   `defaultHandlers()` with `ok(endpoints.yourEndpoint, snapshot("m365-your-key"))`.

Response bodies come out of T10's demonstration profiles, not from bodies
written here. One set of example data, one place to maintain it, and the tests
show the same tenant that `DEMO_MODE=healthy-mid-market` shows.

### Why bodies are validated

`ok()` runs the body through the endpoint's Zod schema *when the handler is
built*, and throws with the offending field named if it does not fit:

```
The fixture for GET /api/m365/overview/with-metadata does not satisfy its
generated Zod schema:
  data.totalUsers: Expected number, received string
```

The failure therefore arrives at the `server.use` call in the test, not as a
mysterious error panel three assertions later. A suite built on response shapes
the server can no longer produce is worse than no suite, because it reports
health it has not checked.

One limit worth knowing: the generated schemas are `zod.object`, which rejects a
missing or wrongly-typed field but tolerates an extra one. That is deliberate.
Several routes return `partialData`, `permissionError` and `collectionIssues`
that the OpenAPI document does not declare, and the committed snapshots carry
them; a strict schema would fail on that divergence rather than on a regression.

### Asserting on requests

For anything that *causes* a request, assert on the request MSW received rather
than on a spy. A spy passes even when the client sends to the wrong path.

```ts
await user.click(screen.getByRole("button", { name: /Refresh Data/ }));

await waitFor(() => {
  expect(observedRequestsTo("POST", "/api/m365/refresh")).toHaveLength(1);
});
```

`observedRequestsTo` matches on method and `pathname`; read the query string off
the returned `Request` when it matters. The record is cleared before each test.

Counting requests is also the sharpest way to assert that something was *not*
remounted, because the test query client has a zero `staleTime` and `gcTime`, so
a remount always refetches:

```ts
expect(observedRequestsTo("GET", "/api/m365/overview/with-metadata")).toHaveLength(1);
```

Anchor such a count on a rendered *figure*, not on a heading. A heading appears
as soon as the tab mounts, which can be before its first request has left, and
the count is then a race.

## Driving a Radix component in jsdom

Radix primitives are keyboard-and-pointer driven, and several of them render
into a portal at the end of `document.body` rather than in place. Two rules
follow.

**Drive them with `userEvent`, not `fireEvent`.** Radix listens for
`pointerdown` as well as `click`, and manages focus between them. `fireEvent.click`
dispatches one event and leaves the component half-driven; `userEvent.click`
dispatches the whole sequence.

```ts
const user = userEvent.setup();
await user.click(screen.getByRole("switch", { name: "Hide free/developer SKUs" }));
```

**Query with `screen`, not with the container.** `screen` queries the whole
document, so it finds portalled content; `within(container)` does not.

```ts
await user.click(screen.getByRole("combobox"));       // opens a Select
await user.click(await screen.findByRole("option", { name: "Every 15 min" }));
```

Radix sets the right ARIA attributes, so query by role and state rather than by
text or class: `getByRole("switch", { name })` with `toBeChecked()`,
`getByRole("button", { expanded: true })`, `aria-sort` on a sortable header.
That is both more robust and a check that the component is accessible.

Note that `CollapsibleSection` in this repository is *not* a Radix component. It
is a hand-rolled toggle that unmounts its children when closed, so "closed" is
asserted as absence from the document:

```ts
expect(screen.queryByText("Key metrics")).not.toBeInTheDocument();
```

## Traps

Every one of these cost time to diagnose. They are all handled in `src/test/`,
so nothing below needs doing again; it is here so the next unfamiliar failure is
recognisable.

### jsdom has no layout, so Recharts renders nothing

`ResponsiveContainer` measures its parent with `getBoundingClientRect()` and
renders `null` at a non-positive width. Every element measures 0 x 0 in jsdom,
so without help every chart assertion is vacuous rather than failing.

`setup.ts` reports a fixed 1024 x 768 rectangle from
`Element.prototype.getBoundingClientRect`.

### jsdom has no ResizeObserver, so Recharts throws

`ResponsiveContainer` constructs one unconditionally in an effect, so a chart
tab crashes on mount rather than degrading. `setup.ts` installs a no-op
implementation. It never has to fire, because the container also reads its size
directly.

### jsdom's AbortSignal is not the one Node's fetch accepts

This is the expensive one, because the symptom names neither cause.

jsdom implements `AbortController` and `AbortSignal`, so setting up the
environment replaces Node's with jsdom's. jsdom does *not* implement `fetch`, so
the global `fetch` stays Node's (undici). React Query hands every query function
an `AbortSignal`, the generated client passes it to `fetch`, and undici compares
it against the class it captured at startup:

```
RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal.
```

In a component test that surfaces as an error panel, which reads like a bug in
the component.

`src/test/jsdomEnvironment.ts` is a thin custom environment that installs jsdom
and then puts Node's two constructors back. The alternative — stripping the
signal inside a `fetch` wrapper — would make every request in every test
uncancellable and quietly diverge from the browser.

### Node's fetch rejects a relative URL

Every request this application makes is relative, because in a browser the
document's origin supplies the rest. Node's `fetch` will not parse `/api/m365/overview`.

`installRelativeUrlFetch()` in `src/test/server.ts` resolves relative inputs
against `window.location.origin`. It has to wrap MSW's `fetch` rather than the
other way round, because MSW builds a `Request` before it consults any handler
and that construction is itself what throws — so it is installed *after*
`server.listen()`.

Calling `setBaseUrl()` from `@workspace/api-client-react` would have covered the
generated client but not `lib/onboardingApi.ts` or `DemoModeBanner`, which call
`fetch` directly.

### Testing Library's one-second default is too short for a lazy tab

Tab modules are behind `React.lazy`. The first test in a file that renders one
pays for loading and transforming that module and everything it imports —
Recharts, TanStack Table — before anything can appear, and that exceeds a
second on a cold module graph. The symptom is the first test in a file failing
while the identical assertion passes in the second.

`setup.ts` sets `asyncUtilTimeout` to five seconds.

### Testing Library does not clean up on its own here

Automatic cleanup registers itself only when `afterEach` is a global, and this
project runs vitest with `globals: false` (see below). `setup.ts` calls
`cleanup()` by hand. Without it, one file's trees accumulate in the document and
`getByText` starts finding two of everything.

### localStorage survives between tests

`CollapsibleSection` persists its open state per `storageKey`, and the licence
tab persists hidden SKUs. `setup.ts` clears `localStorage` before each test so
that test order cannot matter.

### `globals` is off, so import your matchers

`describe`, `it` and `expect` are imported from `vitest` in every test file. The
package's `tsconfig.json` fixes `types` to `node` and `vite/client`, and that
file is not the test harness's to edit, so ambient globals would not typecheck.
One import line per file is the whole cost.

## Do not do this

**Do not mock the generated hooks.** Not with `vi.mock("@workspace/api-client-react")`,
not by injecting a fake `useQuery`, not by passing data in as a prop the
component does not otherwise take. Mocking the hook removes the generated
client, its response parsing and the React Query cache from the test — which is
the majority of what can actually break — and replaces them with an assertion
that the component renders a literal you wrote two lines earlier. Change the
handler instead. If a case is hard to express as a response, that is usually a
sign the case cannot happen.

**Do not assert on class names.** `expect(el).toHaveClass("hidden")`,
`container.querySelector(".animate-pulse")` and their relatives couple the test
to Tailwind utilities that a restyling will change without changing behaviour,
and they pass just as happily when the class is present and inert. No stylesheet
is loaded in jsdom either, so a class name proves nothing about what a reader
would see. Assert on text, on role, on ARIA state, or on the element's presence
in the document.

The honest consequence: some things genuinely cannot be asserted here. An
inactive tab is hidden by a Tailwind `hidden` class, and nothing in jsdom can
tell that apart from visible. The keep-alive test therefore asserts that the tab
is still *mounted* and has not *refetched*, and says in a comment that
visibility is out of reach. Saying so is better than reaching for `toHaveClass`.

**Do not use `container.querySelector`.** If there is no role, no label and no
text to query by, the component has an accessibility gap; fix the component or
record it as a finding rather than routing around it in the test.

**Do not add a `waitFor` to make an intermittent failure go away.** Find what
the assertion should have been anchored on. A `waitFor` around a request count
that races is a test that will pass on a slow machine and lie on a fast one.

## Coverage

Coverage is measured with v8 and reported as `text` and `lcov` into
`./coverage`, matching the api-server. **No threshold is configured.**

At the time of writing, with seventeen tests, the dashboard's coverage is:

| Metric | Figure |
| --- | --- |
| Statements | 13.29% |
| Branches | 68.90% |
| Functions | 35.82% |
| Lines | 13.29% |

That is a low number and it is meant to be read as one. Thirteen per cent of a
20,000-line application is not "the dashboard is tested"; it is one tab of
sixteen, three shared components and the shell. The branch figure is high only
because the files that *are* touched are covered thoroughly while the fourteen
untouched tabs contribute no branches at all — it is not a second, kinder view
of the same thing.

**Proposed starting threshold: 12% statements, 12% lines, 30% functions, and no
branch threshold.**

The reasoning is that a threshold's only job at this stage is to stop the number
going backwards; it is not a target. Setting it a point or so below the measured
figure leaves room for a refactor that adds an untested file without failing the
build for it, while a deletion of tests, or a large new untested tab landing
without any, trips it. A branch threshold is left off because the figure is an
artefact of what is not measured yet and would move sharply — in either
direction — the moment a second tab is covered.

Raise it deliberately, in the same commit as the tests that earn the raise.
Choosing a subset of directories to measure so that the percentage looks
respectable is the one thing that would make this number worse than useless.
