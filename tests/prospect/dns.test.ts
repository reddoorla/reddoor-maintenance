import { describe, expect, it } from "vitest";
import { lookupDns, registrableDomain, type DnsDeps } from "../../src/prospect/dns.js";
import { dnsChecks } from "../../src/prospect/site-checks.js";

/** A resolver that answers exactly what a test tells it to, and throws the
 *  codes a real one throws. */
function deps(over: Partial<DnsDeps> = {}): DnsDeps {
  return {
    resolveTxt: async () => [],
    resolveMx: async () => [],
    rdap: async () => null,
    ...over,
  };
}

const notFound = (): never => {
  const e = new Error("queryTxt ENOTFOUND") as Error & { code: string };
  e.code = "ENOTFOUND";
  throw e;
};
const timedOut = (): never => {
  const e = new Error("queryTxt ETIMEOUT") as Error & { code: string };
  e.code = "ETIMEOUT";
  throw e;
};

describe("registrableDomain", () => {
  it("strips subdomains", () => {
    expect(registrableDomain("www.acme.com")).toBe("acme.com");
    expect(registrableDomain("shop.eu.acme.com")).toBe("acme.com");
  });

  it("keeps the second label on the public suffixes that need it", () => {
    // Looking up SPF at `uk` instead of `acme.co.uk` asks a meaningless
    // question and gets a meaningless answer.
    expect(registrableDomain("www.acme.co.uk")).toBe("acme.co.uk");
    expect(registrableDomain("acme.com.au")).toBe("acme.com.au");
  });

  it("returns null for something that is not a domain", () => {
    expect(registrableDomain("localhost")).toBeNull();
    expect(registrableDomain("")).toBeNull();
  });
});

describe("lookupDns — a resolver failure is never their missing record", () => {
  it("reads a timeout as unmeasured, not as 'no SPF'", async () => {
    // The one error this module exists to prevent: our network outage printed
    // as their security hole.
    const r = await lookupDns("https://acme.com", [], deps({ resolveTxt: timedOut }));
    expect(r.spf).toBeUndefined();
    expect(r.dmarc).toBeUndefined();
    expect(dnsChecks(r).find((c) => c.key === "dns-spf")?.status).toBe("unmeasured");
  });

  it("reads ENOTFOUND as a real answer of none", async () => {
    // The name resolved and carries no such record. That IS the finding.
    const r = await lookupDns("https://acme.com", [], deps({ resolveTxt: notFound }));
    expect(r.spf).toBeNull();
    expect(dnsChecks(r).find((c) => c.key === "dns-spf")?.status).toBe("fail");
  });

  it("is unmeasured when the origin has no registrable domain at all", async () => {
    const r = await lookupDns("https://localhost:3000", [], deps());
    expect(r.measured).toBe(false);
    for (const c of dnsChecks(r)) expect(c.status, c.key).toBe("unmeasured");
  });
});

describe("lookupDns — the records themselves", () => {
  it("finds SPF and DMARC at the right names", async () => {
    const r = await lookupDns(
      "https://www.acme.com",
      [],
      deps({
        resolveTxt: async (name) =>
          name === "acme.com"
            ? [["v=spf1 include:_spf.google.com ~all"], ["google-site-verification=xyz"]]
            : name === "_dmarc.acme.com"
              ? [["v=DMARC1; p=quarantine; rua=mailto:d@acme.com"]]
              : [],
      }),
    );
    expect(r.spf).toContain("v=spf1");
    expect(r.dmarc).toContain("v=DMARC1");
  });

  it("joins a TXT record split across chunks", async () => {
    // A record over 255 bytes arrives as several strings and means nothing
    // until concatenated.
    const r = await lookupDns(
      "https://acme.com",
      [],
      deps({ resolveTxt: async () => [["v=spf1 include:a.example ", "include:b.example ~all"]] }),
    );
    expect(r.spf).toBe("v=spf1 include:a.example include:b.example ~all");
  });

  it("orders mail servers by preference", async () => {
    const r = await lookupDns(
      "https://acme.com",
      [],
      deps({
        resolveMx: async () => [
          { exchange: "ALT2.aspmx.l.google.com", priority: 20 },
          { exchange: "aspmx.l.google.com", priority: 1 },
        ],
      }),
    );
    expect(r.mx?.[0]).toBe("aspmx.l.google.com");
  });

  it("only looks up a contact domain that is not their own", async () => {
    const asked: string[] = [];
    const r = await lookupDns(
      "https://acme.com",
      ["hello@acme.com", "team@acme.com"],
      deps({
        resolveMx: async (n) => {
          asked.push(n);
          return [{ exchange: "mx.acme.com", priority: 10 }];
        },
      }),
    );
    // An address on their own domain is already answered by the MX check.
    expect(asked).toEqual(["acme.com"]);
    expect(r.contactMx).toBeNull();
    expect(dnsChecks(r).find((c) => c.key === "dns-contact-mx")?.status).toBe("not-applicable");
  });

  it("catches a published address on a domain that cannot receive mail", async () => {
    const r = await lookupDns(
      "https://acme.com",
      ["hello@old-agency.example"],
      deps({
        resolveMx: async (n) =>
          n === "acme.com" ? [{ exchange: "mx.acme.com", priority: 10 }] : notFound(),
      }),
    );
    expect(r.contactMx).toEqual({ domain: "old-agency.example", hasMx: false });
    expect(dnsChecks(r).find((c) => c.key === "dns-contact-mx")?.status).toBe("fail");
  });
});

describe("lookupDns — registration expiry", () => {
  const rdapWith = (date: string) => async () => ({
    events: [
      { eventAction: "registration", eventDate: "2015-01-01T00:00:00Z" },
      { eventAction: "expiration", eventDate: date },
    ],
  });

  it("passes a domain with a year left", async () => {
    const soon = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const r = await lookupDns("https://acme.com", [], deps({ rdap: rdapWith(soon) }));
    expect(dnsChecks(r).find((c) => c.key === "domain-expiry")?.status).toBe("pass");
  });

  it("fails a domain lapsing inside a month, and says how many days", async () => {
    const soon = new Date(Date.now() + 12 * 86_400_000).toISOString();
    const r = await lookupDns("https://acme.com", [], deps({ rdap: rdapWith(soon) }));
    const c = dnsChecks(r).find((k) => k.key === "domain-expiry");
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toMatch(/12 days/);
  });

  it("is unmeasured when the registry publishes no expiry, which many ccTLDs do not", async () => {
    const r = await lookupDns(
      "https://acme.co.uk",
      [],
      deps({
        rdap: async () => ({
          events: [{ eventAction: "registration", eventDate: "2015-01-01T00:00:00Z" }],
        }),
      }),
    );
    expect(r.expiresAt).toBeUndefined();
    expect(dnsChecks(r).find((c) => c.key === "domain-expiry")?.status).toBe("unmeasured");
  });

  it("is unmeasured when RDAP itself did not answer", async () => {
    const r = await lookupDns("https://acme.com", [], deps({ rdap: async () => null }));
    expect(dnsChecks(r).find((c) => c.key === "domain-expiry")?.status).toBe("unmeasured");
  });
});

describe("a domain doing everything right passes all five", () => {
  it("goes green", async () => {
    const r = await lookupDns(
      "https://acme.com",
      ["hello@acme.com"],
      deps({
        resolveTxt: async (name) =>
          name === "acme.com"
            ? [["v=spf1 include:_spf.google.com ~all"]]
            : [["v=DMARC1; p=reject; rua=mailto:dmarc@acme.com"]],
        resolveMx: async () => [{ exchange: "aspmx.l.google.com", priority: 1 }],
        rdap: async () => ({
          events: [
            {
              eventAction: "expiration",
              eventDate: new Date(Date.now() + 400 * 86_400_000).toISOString(),
            },
          ],
        }),
      }),
    );
    const checks = dnsChecks(r);
    expect(checks.filter((c) => c.status === "fail")).toEqual([]);
    // Four verdicts; the contact-address check is not-applicable because the
    // published address is on their own domain.
    expect(checks.filter((c) => c.status === "pass")).toHaveLength(4);
  });
});
