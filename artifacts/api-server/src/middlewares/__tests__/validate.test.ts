import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { GetM365FindingsQueryParams, PatchM365FindingBody, PatchM365FindingParams } from "@workspace/api-zod";
import { validate } from "../validate.js";

function mockReq(overrides: Partial<Request>): Request {
  return { body: {}, query: {}, params: {}, ...overrides } as Request;
}

function mockRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response["status"];
  res.json = vi.fn((payload: unknown) => {
    res.body = payload;
    return res;
  }) as unknown as Response["json"];
  return res;
}

describe("validate middleware", () => {
  it("calls next() and attaches parsed data when the request is valid", () => {
    const req = mockReq({ query: { severity: "high", status: "open" } });
    const res = mockRes();
    const next = vi.fn();

    validate({ query: GetM365FindingsQueryParams })(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.valid?.query).toEqual({ severity: "high", status: "open" });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 400 with flattened issues and does not call next() when invalid", () => {
    const req = mockReq({ query: { severity: "not-a-real-severity" } });
    const res = mockRes();
    const next = vi.fn();

    validate({ query: GetM365FindingsQueryParams })(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toMatchObject({ error: "Invalid request query" });
  });

  it("rejects an invalid body even when params are valid, without calling next()", () => {
    const req = mockReq({
      params: { fingerprint: "abc123" },
      body: { status: "not-a-real-status" },
    });
    const res = mockRes();
    const next = vi.fn();

    validate({ params: PatchM365FindingParams, body: PatchM365FindingBody })(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toMatchObject({ error: "Invalid request body" });
  });

  it("passes params and body through once both are valid", () => {
    const req = mockReq({
      params: { fingerprint: "abc123" },
      body: { status: "acknowledged", owner: "alice" },
    });
    const res = mockRes();
    const next = vi.fn();

    validate({ params: PatchM365FindingParams, body: PatchM365FindingBody })(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.valid?.params).toEqual({ fingerprint: "abc123" });
    expect(req.valid?.body).toEqual({ status: "acknowledged", owner: "alice" });
  });
});
