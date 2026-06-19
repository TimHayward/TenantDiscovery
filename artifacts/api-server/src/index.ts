import app from "./app";
import { logger } from "./lib/logger";
import { start as startBackgroundRefresh } from "./lib/backgroundRefresh.js";

const rawPort = process.env["PORT"] ?? "5100";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Bind to loopback by default: the API is unauthenticated and holds Graph
// credentials, so it must not be reachable from the network unless explicitly
// opted in via HOST (e.g. HOST=0.0.0.0).
const host = process.env["HOST"]?.trim() || "127.0.0.1";

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
