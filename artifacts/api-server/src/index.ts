import app from "./app";
import { logger } from "./lib/logger";
import { start as startBackgroundRefresh } from "./lib/backgroundRefresh.js";
import { assertSafeBinding, isLoopbackHost } from "./lib/assertSafeBinding.js";

const rawPort = process.env["PORT"] ?? "5100";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Bind to loopback by default: the API is unauthenticated and holds Graph
// credentials, so it must not be reachable from the network unless explicitly
// opted in via HOST (e.g. HOST=0.0.0.0) AND ALLOW_REMOTE=true.
const host = process.env["HOST"]?.trim() || "127.0.0.1";

try {
  assertSafeBinding(host, process.env);
} catch (err) {
  logger.error({ err }, "Refusing to start with an unsafe network binding");
  process.exit(1);
}

if (!isLoopbackHost(host)) {
  logger.warn(
    { host },
    "API is bound to a non-loopback address with ALLOW_REMOTE=true — ensure the network path to this host is restricted",
  );
}

process.on("unhandledRejection", (reason: unknown) => {
  logger.error({ reason }, "Unhandled promise rejection – process will exit");
  process.exit(1);
});

process.on("uncaughtException", (err: Error) => {
  logger.error({ err }, "Uncaught exception – process will exit");
  process.exit(1);
});

app.listen(port, host, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, host }, "Server listening");
  startBackgroundRefresh();
});
