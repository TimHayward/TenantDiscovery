import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { clearObservedRequests, installRelativeUrlFetch, server } from "./server";

/**
 * The gaps jsdom leaves, and what this file does about each.
 *
 * jsdom implements the DOM but no layout engine and none of the observer APIs,
 * so several things a browser supplies are simply absent. Each stub below is
 * here because a real component in this repository needs it; none of them
 * changes behaviour a test then asserts on. See docs/testing-the-dashboard.md
 * for the longer account.
 */

// 1. ResizeObserver does not exist in jsdom. Recharts' ResponsiveContainer
//    constructs one unconditionally in an effect, so without this every chart
//    in the dashboard throws on mount. The observer never needs to fire,
//    because the container also reads its size directly (see 2).
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = NoopResizeObserver;

// 2. Every element measures 0 x 0 in jsdom, because there is no layout.
//    ResponsiveContainer renders nothing at all below a positive width, which
//    would make every chart assertion vacuous. Reporting a fixed viewport-sized
//    rectangle is what makes charts render. The numbers are arbitrary but must
//    be large enough that Recharts does not drop axis ticks.
const STUB_WIDTH = 1024;
const STUB_HEIGHT = 768;
Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
  return {
    width: STUB_WIDTH,
    height: STUB_HEIGHT,
    top: 0,
    left: 0,
    bottom: STUB_HEIGHT,
    right: STUB_WIDTH,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
};

// 3. scrollIntoView is unimplemented in jsdom and throws. CollapsibleSection
//    calls it when a `#section` deep link names it.
Element.prototype.scrollIntoView = function scrollIntoView(): void {};

// 4. matchMedia is unimplemented. next-themes reads it when `enableSystem` is
//    on, and `use-mobile` reads it on every render. Reporting "no match" gives
//    the desktop, light-theme branch, which is the one worth testing by default.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// Testing Library's default `findBy*` timeout is one second. The dashboard's
// tabs are behind `React.lazy`, so the first test in a file that renders one
// pays for loading and transforming the tab module and everything it imports
// (Recharts, TanStack Table) before anything can appear. On a cold module graph
// that exceeds a second, which made the first test in a file fail while the
// same assertion passed in the second. Five seconds is comfortably above the
// observed cost and still well below a hang.
configure({ asyncUtilTimeout: 5_000 });

// `onUnhandledRequest: "error"` is the point of the whole arrangement: a
// component that starts asking for something the handlers do not describe fails
// the test that added it, instead of rendering an error panel nobody asserts on.
let restoreFetch: () => void = () => {};
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  restoreFetch = installRelativeUrlFetch();
});

afterAll(() => {
  restoreFetch();
  server.close();
});

// Testing Library's automatic cleanup only registers itself when `afterEach` is
// a global, and this project runs vitest without globals. Unmounting by hand is
// the price: without it, one file's trees accumulate in the document and
// `getByText` starts finding two of everything.
afterEach(() => {
  cleanup();
  server.resetHandlers();
});

// CollapsibleSection persists its open/closed state per `storageKey`, so a test
// that collapses a section would otherwise change the starting state of the
// next test in the file. Clearing before each test makes order irrelevant, as
// does starting each test with an empty record of observed requests.
beforeEach(() => {
  localStorage.clear();
  clearObservedRequests();
});
