import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler } from "./middlewares/errorHandler.js";
import { isLoopbackHost } from "./lib/assertSafeBinding.js";
import { getApiAuthToken } from "./lib/setupConfig.js";
import { createApiAuth } from "./middlewares/apiAuth.js";

const app: Express = express();

// pino fixes its redaction paths when the logger is built, so the HTTP logger
// re-states the base paths alongside the API token ones rather than adding to
// them. The request serializer below already drops headers and bodies; this is
// the second line of defence for anything that logs a settings object.
const httpLogger = logger.child(
  {},
  {
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "req.body.clientSecret",
      "req.body.client_secret",
      "req.body.secret",
      "apiToken",
      "issuedApiToken",
      "*.apiToken",
      "*.issuedApiToken",
    ],
  },
);

// The API serves JSON only (no browser-rendered HTML), so the CSP/COEP
// defaults have nothing to protect and only risk breaking future routes;
// the remaining default headers (X-Content-Type-Options, HSTS, etc.) still apply.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

app.use(
  pinoHttp({
    logger: httpLogger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// The dashboard reaches the API through the Vite same-origin proxy, so CORS
// is unnecessary by default. A wildcard policy would let any website read
// tenant data through the user's browser; only allow origins explicitly
// listed in CORS_ALLOWED_ORIGINS (comma-separated).
const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (corsAllowedOrigins.length > 0) {
  app.use(cors({ origin: corsAllowedOrigins }));
}

// Loopback is the default and stays unauthenticated: the binding is the
// control there, and requiring a token would change the default developer
// experience for no gain. Off loopback the binding no longer protects
// anything, so a token is required. HOST is read exactly as index.ts reads it.
const bindHost = process.env.HOST?.trim() || "127.0.0.1";

if (!isLoopbackHost(bindHost)) {
  // Mounted ahead of the body parsers so an unauthenticated request is turned
  // away before its body is read.
  app.use("/api", createApiAuth({ getToken: getApiAuthToken }));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use(errorHandler);

export default app;
