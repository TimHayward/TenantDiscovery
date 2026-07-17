import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler } from "./middlewares/errorHandler.js";

const app: Express = express();

// The API serves JSON only (no browser-rendered HTML), so the CSP/COEP
// defaults have nothing to protect and only risk breaking future routes;
// the remaining default headers (X-Content-Type-Options, HSTS, etc.) still apply.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

app.use(
  pinoHttp({
    logger,
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use(errorHandler);

export default app;
