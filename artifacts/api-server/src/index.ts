import app from "./app";
import { logger } from "./lib/logger";
import { start as startBackgroundRefresh } from "./lib/backgroundRefresh.js";

const rawPort = process.env["PORT"] ?? "5100";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

process.on("unhandledRejection", (reason: unknown) => {
  logger.error({ reason }, "Unhandled promise rejection – process will exit");
  process.exit(1);
});

process.on("uncaughtException", (err: Error) => {
  logger.error({ err }, "Uncaught exception – process will exit");
  process.exit(1);
});

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startBackgroundRefresh();
});
