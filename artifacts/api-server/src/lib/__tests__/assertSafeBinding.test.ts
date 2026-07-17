import { describe, expect, it } from "vitest";
import { assertSafeBinding, isLoopbackHost } from "../assertSafeBinding.js";

describe("isLoopbackHost", () => {
  it("recognizes loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
  });

  it("rejects non-loopback hosts", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.5")).toBe(false);
  });
});

describe("assertSafeBinding", () => {
  it("allows loopback hosts regardless of ALLOW_REMOTE", () => {
    expect(() => assertSafeBinding("127.0.0.1", {})).not.toThrow();
    expect(() => assertSafeBinding("localhost", { ALLOW_REMOTE: "false" })).not.toThrow();
  });

  it("refuses a non-loopback host without ALLOW_REMOTE=true", () => {
    expect(() => assertSafeBinding("0.0.0.0", {})).toThrow(/Refusing to bind/);
    expect(() => assertSafeBinding("0.0.0.0", { ALLOW_REMOTE: "false" })).toThrow(/Refusing to bind/);
    expect(() => assertSafeBinding("0.0.0.0", { ALLOW_REMOTE: "yes" })).toThrow(/Refusing to bind/);
  });

  it("allows a non-loopback host when ALLOW_REMOTE=true", () => {
    expect(() => assertSafeBinding("0.0.0.0", { ALLOW_REMOTE: "true" })).not.toThrow();
  });
});
