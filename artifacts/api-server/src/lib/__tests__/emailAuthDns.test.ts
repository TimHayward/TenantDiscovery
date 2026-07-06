import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupDomainEmailAuth } from "../dns/emailAuthDns";

/** Build a DoH JSON response for a given record type. */
function dohResponse(type: number, datas: string[], status = 0) {
  return {
    ok: true,
    json: async () => ({
      Status: status,
      Answer: datas.map((data) => ({ name: "x", type, data })),
    }),
  };
}

const TXT = 16;
const MX = 15;
const CNAME = 5;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lookupDomainEmailAuth", () => {
  it("detects SPF, DMARC, MX and DKIM CNAME from DoH answers", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes("_dmarc.") && url.includes("type=TXT")) {
        return dohResponse(TXT, ['"v=DMARC1; p=reject; rua=mailto:x@y.com"']) as any;
      }
      if (url.includes("type=TXT")) {
        return dohResponse(TXT, ['"v=spf1 include:spf.protection.outlook.com -all"']) as any;
      }
      if (url.includes("type=MX")) {
        return dohResponse(MX, ["0 x.mail.protection.outlook.com."]) as any;
      }
      if (url.includes("type=CNAME")) {
        return dohResponse(CNAME, ["selector1-domain._domainkey.tenant.onmicrosoft.com."]) as any;
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
      async () => dohResponse(TXT, [], 3) as any,
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
