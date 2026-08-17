import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupDomainEmailAuth } from "../dns/emailAuthDns";

/**
 * Build a DoH JSON response for a given record type. Only the `ok` and `json`
 * members are populated — the lookup reads nothing else off the Response — so
 * the partial mock is widened to Response once here rather than at every call.
 */
function dohResponse(type: number, datas: string[], status = 0): Response {
  return {
    ok: true,
    json: async () => ({
      Status: status,
      Answer: datas.map((data) => ({ name: "x", type, data })),
    }),
  } as unknown as Response;
}

const TXT = 16;
const MX = 15;
const CNAME = 5;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lookupDomainEmailAuth", () => {
  it("detects SPF, DMARC, MX and DKIM CNAME from DoH answers", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("_dmarc.") && url.includes("type=TXT")) {
        return dohResponse(TXT, ['"v=DMARC1; p=reject; rua=mailto:x@y.com"']);
      }
      if (url.includes("type=TXT")) {
        return dohResponse(TXT, ['"v=spf1 include:spf.protection.outlook.com -all"']);
      }
      if (url.includes("type=MX")) {
        return dohResponse(MX, ["0 x.mail.protection.outlook.com."]);
      }
      if (url.includes("type=CNAME")) {
        return dohResponse(CNAME, ["selector1-domain._domainkey.tenant.onmicrosoft.com."]);
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await lookupDomainEmailAuth("example.com");

    expect(result.hasSpf).toBe(true);
    expect(result.spfRecord).toContain("v=spf1");
    expect(result.hasDmarc).toBe(true);
    expect(result.dmarcPolicy).toBe("reject");
    expect(result.mxConfigured).toBe(true);
    expect(result.hasDkimCname).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("reports nothing configured for NXDOMAIN without raising issues", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => dohResponse(TXT, [], 3),
    );

    const result = await lookupDomainEmailAuth("bare.example");

    expect(result.hasSpf).toBe(false);
    expect(result.hasDmarc).toBe(false);
    expect(result.mxConfigured).toBe(false);
    expect(result.hasDkimCname).toBe(false);
    expect(result.issues).toHaveLength(0);
  });

  it("records a CollectionIssue when all DoH providers fail", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("network down");
    });

    const result = await lookupDomainEmailAuth("broken.example");

    expect(result.hasSpf).toBe(false);
    // One issue per failed lookup (spf, dmarc, mx, 2x dkim selectors).
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.source.includes("spfLookup"))).toBe(true);
  });
});
