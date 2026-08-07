import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * The dashboard's test configuration.
 *
 * Deliberately standalone rather than a `mergeConfig` of `vite.config.ts`. That
 * file carries the bundle-budget plugin, the Replit dev plugins behind a
 * top-level `await import()`, and a dev-server proxy, none of which a test run
 * needs and the first of which reports on a build that never happens here. The
 * two things a test run does need from it — the `@` alias and the React
 * plugin — are short enough to restate.
 *
 * Where a choice matched the api-server's `vitest.config.ts` it was taken from
 * there, so there is one way of doing things: v8 coverage, `text` and `lcov`
 * reporters, `./coverage` as the directory, `__tests__` excluded from the
 * measured set, and no threshold until a human has looked at the number.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    // The dashboard, ui-kit and api-client-react each resolve React through
    // their own node_modules link. Two copies of React in one jsdom document
    // is an "invalid hook call" that reads as a bug in the component.
    dedupe: ["react", "react-dom"],
  },
  test: {
    // jsdom, plus one correction it needs to coexist with Node's fetch. See
    // src/test/jsdomEnvironment.ts for what and why.
    environment: "./src/test/jsdomEnvironment.ts",
    // No `globals: true`. The package's tsconfig fixes `types` to node and
    // vite/client, and tsconfig.json is not this task's to edit, so ambient
    // `describe`/`it`/`expect` would not typecheck. Every test file imports
    // them from "vitest" instead, which is explicit and costs one line.
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    // Component tests keep no process-wide state: each file gets a fresh
    // jsdom document and its own MSW server. Threads start faster than forks
    // and there is nothing here that needs process isolation.
    pool: "threads",
    // Well above the default five seconds, and above the `asyncUtilTimeout`
    // that `src/test/setup.ts` gives an individual `findBy*`.
    //
    // The cost being covered is the first render of a lazy tab: `React.lazy`
    // defers the tab module, so the first test in a file that renders one pays
    // to load and transform Recharts and TanStack Table before anything can
    // appear. Alone that is around two seconds; under `pnpm -r run test`, where
    // this package runs alongside the api-server's thirty files, it was
    // measured at over seven. Leaving the default in place meant a suite that
    // passed on its own and failed from the root, which is the worst of both.
    //
    // These are ceilings for a pathological case, not budgets to spend. A test
    // that routinely approaches them is doing something wrong.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/__tests__/**",
        "src/test/**",
        // Bootstrap only: mounts the React root into a real document.
        "src/main.tsx",
        // Generated shadcn/ui primitives, vendored rather than written here.
        "src/components/ui/**",
      ],
      // No threshold is set deliberately, matching the api-server. See
      // docs/testing-the-dashboard.md for the measured figure and the floor
      // proposed against it.
    },
  },
});
