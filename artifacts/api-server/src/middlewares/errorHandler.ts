import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  req.log.error({ err }, "Unhandled API error");

  if (res.headersSent) {
    return;
  }

  res.status(500).json({ error: "Internal server error" });
};
