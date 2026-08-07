import { builtinEnvironments, type Environment } from "vitest/environments";

/**
 * jsdom, with the abort primitives left as Node's.
 *
 * The problem this solves is not obvious from the failure it causes. jsdom
 * implements `AbortController` and `AbortSignal`, so setting up the environment
 * replaces Node's with jsdom's. jsdom does *not* implement `fetch`, so the
 * global `fetch` in a test run stays Node's (undici). React Query hands every
 * query function an `AbortSignal`; the generated client passes it to `fetch`;
 * undici checks it against the `AbortSignal` it captured at startup, which is
 * Node's; and the request fails with
 *
 *   RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal.
 *
 * That surfaces as an error panel in a component test, which reads like a bug
 * in the component rather than a mismatch between two halves of the runtime.
 *
 * Restoring the two constructors after jsdom has been installed makes the
 * signal an instance of the class undici is comparing against. Nothing in this
 * application reads `AbortController` off `window` rather than off the global
 * scope, so there is no second behaviour to keep in step.
 *
 * The alternative, stripping the signal inside a `fetch` wrapper, would make
 * every request uncancellable in tests and quietly diverge from the browser.
 */
const jsdomWithNodeAbort: Environment = {
  name: "jsdom-node-abort",
  transformMode: "web",
  async setup(global, options) {
    const nodeAbortController = global.AbortController;
    const nodeAbortSignal = global.AbortSignal;

    const { teardown } = await builtinEnvironments.jsdom.setup(global, options);

    global.AbortController = nodeAbortController;
    global.AbortSignal = nodeAbortSignal;

    return { teardown };
  },
};

export default jsdomWithNodeAbort;
