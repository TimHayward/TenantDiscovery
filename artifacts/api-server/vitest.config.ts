import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Store and route tests each build their own isolated in-memory libSQL
    // database, but they share process-wide state (module singletons, env
    // overrides), so files run in separate forks rather than shared workers.
    pool: "forks",
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
