import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApiAuth, extractBearerToken, tokensMatch } from "../apiAuth.js";
import { createFixedWindowLimiter, type FixedWindowLimiter } from "../rateLimit.js";

const TOKEN = "GKVv3rQe0m_2n0tLvS9JzXpB1u5wYc7dQfHkR8aTgZE";

interface BuildOptions {
  getToken?: () => Promise<string | null>;
  limiter?: FixedWindowLimiter;
}

/**
 * The middleware mounted the way app.ts mounts it, on a throwaway app. Using
 * the real app would tie every assertion to the HOST the test process happens
 * to have, which is the one thing this middleware must not be ambiguous about.
 */
function buildApp(options: BuildOptions = {}): Express {
  const app = express();
  app.use("/api", createApiAuth({ getToken: options.getToken ?? (async () => TOKEN), ...options }));
  app.use("/api", express.json());
  app.get("/api/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/api/healthz/with-metadata", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/api/m365/users", (_req, res) => {
    res.json({ users: [] });
  });
  app.post("/api/onboarding/setup", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("tokensMatch", () => {
  it("accepts the exact token", () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
  });

  it("rejects a token that differs only in its last character", () => {
    expect(tokensMatch(`${TOKEN.slice(0, -1)}X`, TOKEN)).toBe(false);
  });

  it("rejects a correct prefix, so a shorter guess cannot pass", () => {
    expect(tokensMatch(TOKEN.slice(0, 8), TOKEN)).toBe(false);
  });

  it("compares tokens of unequal length without throwing", () => {
    // timingSafeEqual throws on unequal buffers; hashing first is what keeps
    // this from becoming a 500 that also leaks the expected length.
    expect(() => tokensMatch("a", TOKEN)).not.toThrow();
    expect(tokensMatch("a", TOKEN)).toBe(false);
  });
});

describe("extractBearerToken", () => {
  it("reads the token from a well-formed header", () => {
    expect(extractBearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
  });

  it("accepts the scheme in any case, as RFC 7235 requires", () => {
    expect(extractBearerToken(`bearer ${TOKEN}`)).toBe(TOKEN);
    expect(extractBearerToken(`BEARER ${TOKEN}`)).toBe(TOKEN);
  });

  it("rejects a missing, empty or non-bearer header", () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken("Bearer")).toBeNull();
    expect(extractBearerToken("Bearer   ")).toBeNull();
    expect(extractBearerToken(`Basic ${TOKEN}`)).toBeNull();
  });
});

describe("the API authentication middleware", () => {
  it("serves a data route when the correct token is presented", async () => {
    const response = await request(buildApp())
      .get("/api/m365/users")
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ users: [] });
  });

  it("refuses a data route with no Authorization header", async () => {
    const response = await request(buildApp()).get("/api/m365/users");

    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toContain("Bearer");
  });

  it("refuses a data route with a wrong token", async () => {
    const response = await request(buildApp())
      .get("/api/m365/users")
      .set("Authorization", "Bearer not-the-token");

    expect(response.status).toBe(401);
  });

  it("serves /api/healthz with no token, so a container probe still works", async () => {
    const response = await request(buildApp()).get("/api/healthz");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("does not extend the health exemption to the metadata variant", async () => {
    const response = await request(buildApp()).get("/api/healthz/with-metadata");

    expect(response.status).toBe(401);
  });

  it("treats a trailing slash on the health path as the same exemption", async () => {
    expect((await request(buildApp()).get("/api/healthz/")).status).toBe(200);
  });

  it("does not let a path that merely starts with the exempt one through", async () => {
    expect((await request(buildApp()).get("/api/healthzz")).status).toBe(401);
    expect((await request(buildApp()).get("/api/m365/users/")).status).toBe(401);
  });

  it("lets a CORS preflight through, which carries no Authorization header", async () => {
    const response = await request(buildApp()).options("/api/m365/users");

    expect(response.status).not.toBe(401);
  });

  it("fails closed with 503 when the binding demands a token and none is configured", async () => {
    const response = await request(buildApp({ getToken: async () => null }))
      .get("/api/m365/users")
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(503);
  });

  it("fails closed with 503 when the token cannot be read", async () => {
    const app = buildApp({
      getToken: async () => {
        throw new Error("settings file is corrupt");
      },
    });

    const response = await request(app).get("/api/m365/users");

    expect(response.status).toBe(503);
  });

  it("re-reads the token per request, so onboarding takes effect without a restart", async () => {
    let current: string | null = null;
    const app = buildApp({ getToken: async () => current });

    expect((await request(app).get("/api/m365/users").set("Authorization", `Bearer ${TOKEN}`)).status).toBe(503);

    current = TOKEN;

    expect((await request(app).get("/api/m365/users").set("Authorization", `Bearer ${TOKEN}`)).status).toBe(200);
  });

  it("never puts the expected or presented token into a response", async () => {
    const app = buildApp();

    const unauthorised = await request(app)
      .get("/api/m365/users")
      .set("Authorization", "Bearer wrong-guess");

    const serialised = JSON.stringify({
      body: unauthorised.body,
      headers: unauthorised.headers,
      text: unauthorised.text,
    });

    expect(serialised).not.toContain(TOKEN);
    expect(serialised).not.toContain("wrong-guess");
  });
});

describe("rate limiting on the authentication path", () => {
  it("returns 429 with Retry-After once the window is used up", async () => {
    const app = buildApp({ limiter: createFixedWindowLimiter({ maxAttempts: 10, windowMs: 60_000 }) });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await request(app)
        .get("/api/m365/users")
        .set("Authorization", `Bearer wrong-${attempt}`);
      statuses.push(response.status);

      if (attempt === 10) {
        expect(response.status).toBe(429);
        expect(response.headers["retry-after"]).toBeDefined();
        expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
        expect(Number(response.headers["retry-after"])).toBeLessThanOrEqual(60);
      }
    }

    // Ten rejections, then the eleventh is refused without being checked.
    expect(statuses.slice(0, 10)).toEqual(Array<number>(10).fill(401));
    expect(statuses[10]).toBe(429);
  });

  it("refuses the correct token too while the window is exhausted", async () => {
    const app = buildApp({ limiter: createFixedWindowLimiter({ maxAttempts: 2 }) });

    await request(app).get("/api/m365/users").set("Authorization", "Bearer wrong");
    await request(app).get("/api/m365/users").set("Authorization", "Bearer wrong");

    const response = await request(app)
      .get("/api/m365/users")
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(429);
  });

  it("still answers the health probe while the window is exhausted", async () => {
    const app = buildApp({ limiter: createFixedWindowLimiter({ maxAttempts: 1 }) });

    await request(app).get("/api/m365/users").set("Authorization", "Bearer wrong");

    expect((await request(app).get("/api/healthz")).status).toBe(200);
  });

  it("clears the count after a success, so a typo does not accumulate", async () => {
    const app = buildApp({ limiter: createFixedWindowLimiter({ maxAttempts: 2 }) });

    await request(app).get("/api/m365/users").set("Authorization", "Bearer wrong");
    await request(app).get("/api/m365/users").set("Authorization", `Bearer ${TOKEN}`);

    // Without the reset, this second wrong guess would be the second of two.
    expect(
      (await request(app).get("/api/m365/users").set("Authorization", "Bearer wrong")).status,
    ).toBe(401);
  });
});

describe("the fixed-window limiter", () => {
  it("allows attempts again once the window has elapsed", () => {
    let clock = 1_000;
    const limiter = createFixedWindowLimiter({
      maxAttempts: 2,
      windowMs: 60_000,
      now: () => clock,
    });

    limiter.recordFailure("a");
    limiter.recordFailure("a");
    expect(limiter.check("a").limited).toBe(true);

    clock += 59_999;
    expect(limiter.check("a").limited).toBe(true);

    clock += 1;
    expect(limiter.check("a")).toEqual({ limited: false, retryAfterSeconds: 0 });
  });

  it("counts each client separately", () => {
    const limiter = createFixedWindowLimiter({ maxAttempts: 1 });

    limiter.recordFailure("10.0.0.1");

    expect(limiter.check("10.0.0.1").limited).toBe(true);
    expect(limiter.check("10.0.0.2").limited).toBe(false);
  });

  it("reports a Retry-After that shrinks as the window drains", () => {
    let clock = 0;
    const limiter = createFixedWindowLimiter({ maxAttempts: 1, windowMs: 60_000, now: () => clock });

    limiter.recordFailure("a");
    expect(limiter.check("a").retryAfterSeconds).toBe(60);

    clock += 30_000;
    expect(limiter.check("a").retryAfterSeconds).toBe(30);

    // Never advertises a zero-second wait while still limited.
    clock += 29_999;
    expect(limiter.check("a").retryAfterSeconds).toBe(1);
  });

  it("evicts old entries rather than growing without bound", () => {
    let clock = 0;
    const limiter = createFixedWindowLimiter({
      maxAttempts: 1,
      windowMs: 1_000,
      maxTrackedKeys: 10,
      now: () => clock,
    });

    for (let index = 0; index < 50; index += 1) {
      limiter.recordFailure(`client-${index}`);
      clock += 1;
    }

    // The most recent client is still counted despite the eviction sweep.
    expect(limiter.check("client-49").limited).toBe(true);
  });
});

describe("the middleware's use of the limiter", () => {
  it("does not count a request it never had to authenticate", async () => {
    const limiter = createFixedWindowLimiter();
    const recordFailure = vi.spyOn(limiter, "recordFailure");
    const app = buildApp({ limiter });

    await request(app).get("/api/healthz");
    await request(app).options("/api/m365/users");

    expect(recordFailure).not.toHaveBeenCalled();
  });
});
