import { describe, expect, it } from "vitest";
import { isExchangeCertAuthConfigured } from "../exchangeOnline";

describe("isExchangeCertAuthConfigured", () => {
  it("is false under the current client-secret-only credential support", () => {
    // App-only Exchange Online access requires certificate-based auth (backlog 6.1),
    // which the graph client doesn't build yet — collectExchange must gate the
    // guaranteed-failing DKIM call on this rather than calling it unconditionally.
    expect(isExchangeCertAuthConfigured()).toBe(false);
  });
});
