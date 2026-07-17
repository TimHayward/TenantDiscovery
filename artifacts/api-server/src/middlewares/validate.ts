import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodTypeAny } from "zod";

export interface ValidatedRequest<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
> {
  body: TBody;
  query: TQuery;
  params: TParams;
}

declare module "express-serve-static-core" {
  interface Request {
    valid?: ValidatedRequest;
  }
}

interface ValidateSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

const PARTS = ["params", "query", "body"] as const;

/**
 * Express 5 exposes `req.query`/`req.params` as getters with no setter, so the
 * parsed (and coerced) output is attached to `req.valid` instead of replacing
 * the raw properties. Route handlers read `req.valid.<part>`.
 */
export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const valid: ValidatedRequest = { body: undefined, query: undefined, params: undefined };

    for (const part of PARTS) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (!result.success) {
        res.status(400).json({
          error: `Invalid request ${part}`,
          issues: result.error.flatten(),
        });
        return;
      }
      valid[part] = result.data;
    }

    req.valid = valid;
    next();
  };
}
