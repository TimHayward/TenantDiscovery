import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Store and route tests each build their own isolated in-memory libSQL
    // database, but they share process-wide state (module singletons, env
    // overrides), so files run in separate forks rather than shared workers.
    pool: "forks",
    // Above the default ten seconds. The route suites build a fresh in-memory
    // libSQL database and an Express app in a `beforeEach`, and a fork pays for
    // that setup per file. Alone that is comfortably under the default; under
    // `pnpm -r run test`, where these thirty files now run alongside the
    // dashboard's jsdom suite, the hook has been observed to exceed it and fail
    // a file that passes on its own -- the same contention the dashboard's
    // `testTimeout` comment describes, seen from the other side.
    //
    // This is a ceiling for a loaded machine, not a budget. A hook that
    // routinely approaches it is doing too much setup.
    hookTimeout: 30_000,
    env: {
      // pino would otherwise emit a request log line per supertest call and
      // spawn a pino-pretty worker thread for every test file.
      LOG_LEVEL: "silent",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/__tests__/**",
        "src/__fixtures__/**",
        // Bootstrap only: binds the socket and starts the refresh loop, so it
        // cannot be exercised without starting a real server.
        "src/index.ts",
      ],
      // No threshold is set deliberately. Coverage is reported so a human can
      // choose a floor once the current level has been reviewed.
    },
  },
});
