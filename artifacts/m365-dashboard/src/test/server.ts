import { setupServer } from "msw/node";
import { defaultHandlers } from "./handlers";

/**
 * The one MSW server, started and reset by `setup.ts` for every test file.
 *
 * A test narrows it with `server.use(...)`; `setup.ts` calls `resetHandlers()`
 * afterwards, so an override never escapes the test that made it.
 */
export const server = setupServer(...defaultHandlers());

const recorded: Request[] = [];

// `request:start` fires for every request MSW observes, matched or not, which
// is what makes it the right place to assert from: a test that expects a
// request to a path with no handler sees the request *and* the unhandled-request
// error, rather than an empty list and no explanation.
server.events.on("request:start", ({ request }) => {
  recorded.push(request);
});

/** Every request MSW has seen since the current test began. */
export function observedRequests(): readonly Request[] {
  return recorded;
}

/**
 * The requests MSW has seen for one method and path, in order.
 *
 * Matching is on `pathname`, so a query string does not have to be repeated at
 * the call site; read it off the returned request when it matters.
 */
export function observedRequestsTo(method: string, pathname: string): Request[] {
  return recorded.filter(
    (request) =>
      request.method.toUpperCase() === method.toUpperCase() &&
      new URL(request.url).pathname === pathname,
  );
}

/** Called by `setup.ts` between tests. */
export function clearObservedRequests(): void {
  recorded.length = 0;
}

/**
 * jsdom supplies a `document` but no `fetch`, so the global `fetch` in a test
 * run is Node's. Node's rejects a relative URL, and every request this
 * application makes is relative (`/api/m365/overview`) because in a browser the
 * document's origin supplies the rest.
 *
 * Resolving relative inputs against `location.origin` is what closes that gap.
 * It has to wrap MSW's `fetch` rather than the other way round, because MSW
 * builds a `Request` from the input before it looks at any handler, and that
 * construction is itself what throws on a relative URL. So this is installed
 * *after* `server.listen()`.
 *
 * The alternative — calling `setBaseUrl()` from `@workspace/api-client-react` —
 * covers the generated client but not `lib/onboardingApi.ts` or
 * `DemoModeBanner`, which call `fetch` directly. This covers both.
 */
export function installRelativeUrlFetch(): () => void {
  const inner = globalThis.fetch;

  const wrapper: typeof fetch = (input, init) => {
    if (typeof input === "string" && input.startsWith("/")) {
      return inner(new URL(input, window.location.origin), init);
    }
    return inner(input, init);
  };

  globalThis.fetch = wrapper;
  return () => {
    globalThis.fetch = inner;
  };
}
