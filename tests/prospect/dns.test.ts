import { describe, expect, it } from "vitest";
import {
  CONTROL_MX_DOMAIN,
  defaultDnsDeps,
  dohDnsBackend,
  lookupDns,
  registrableDomain,
  type DnsBackend,
  type DnsDeps,
} from "../../src/prospect/dns.js";
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

  it("never claims the domain renews, because the registry does not publish that", async () => {
    // The failure mode this guards: we print "renews 2027-01-01", the client
    // reads it as confirmation auto-renew is on, and it is not. Registries
    // publish an expiry; renewal intent is between the owner and the registrar.
    const far = new Date(Date.now() + 400 * 86_400_000).toISOString();
    const c = dnsChecks(
      await lookupDns("https://acme.com", [], deps({ rdap: rdapWith(far) })),
    ).find((k) => k.key === "domain-expiry");
    expect(c?.status).toBe("pass");
    // Scoped to the claim, not the explanation: the `why` says in so many words
    // that renewal is the thing we cannot see, and must keep saying it.
    expect(c?.evidence).not.toMatch(/renew/i);
  });

  it("says a lapsed registration has lapsed, not that it expires in -40 days", async () => {
    const past = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const c = dnsChecks(
      await lookupDns("https://acme.com", [], deps({ rdap: rdapWith(past) })),
    ).find((k) => k.key === "domain-expiry");
    expect(c?.status).toBe("fail");
    expect(c?.evidence).toMatch(/lapsed on/);
    expect(c?.evidence).not.toMatch(/-\d+ days/);
  });

  it("tells the reader we cannot see auto-renew, so a close date is not a verdict", async () => {
    // Our own domain sits three days out with auto-renew on. If the report
    // called that a fault, the first thing the client checks would be the one
    // thing we got wrong.
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const c = dnsChecks(
      await lookupDns("https://acme.com", [], deps({ rdap: rdapWith(soon) })),
    ).find((k) => k.key === "domain-expiry");
    expect(c?.why).toMatch(/automatically is not|confirm at your registrar/i);
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

describe("defaultDnsDeps — the resolver proves itself before a 'none' counts", () => {
  // What a cloud session's resolver did on 2026-11-04: ENODATA for every
  // name, gmail.com included. ENODATA is the code for "no such record", so
  // medicalsolutionsoftx.com was reported with no MX and no SPF while
  // dns.google answered both.
  const emptyForEveryName: DnsBackend = {
    resolveTxt: async (n) => {
      throw Object.assign(new Error(`queryTxt ENODATA ${n}`), { code: "ENODATA" });
    },
    resolveMx: async (n) => {
      throw Object.assign(new Error(`queryMx ENODATA ${n}`), { code: "ENODATA" });
    },
  };
  // A working resolver for a world holding the control and MSOT's real records.
  const world: Record<string, { mx?: { exchange: string; priority: number }[]; txt?: string[][] }> =
    {
      "gmail.com": { mx: [{ exchange: "gmail-smtp-in.l.google.com", priority: 5 }] },
      "medicalsolutionsoftx.com": {
        mx: [{ exchange: "medicalsolutionsoftx-com.mail.protection.outlook.com", priority: 0 }],
        txt: [
          ["v=spf1 include:spf.protection.outlook.com include:_spf.google.com -all"],
          ["MS=ms31337619"],
        ],
      },
      "nomail.example": {},
    };
  const working: DnsBackend = {
    resolveTxt: async (n) => {
      const r = world[n]?.txt;
      if (r) return r;
      throw Object.assign(new Error(`ENODATA ${n}`), { code: "ENODATA" });
    },
    resolveMx: async (n) => {
      const r = world[n]?.mx;
      if (r) return r;
      throw Object.assign(new Error(`ENODATA ${n}`), { code: "ENODATA" });
    },
  };
  const withBackends = (backends: DnsBackend[]): DnsDeps => ({
    ...defaultDnsDeps(backends),
    rdap: async () => null,
  });
  const status = (r: Awaited<ReturnType<typeof lookupDns>>, key: string) =>
    dnsChecks(r).find((c) => c.key === key)?.status;

  it("reports 'couldn't check', never 'missing', when the resolver fails the control", async () => {
    const r = await lookupDns(
      "https://medicalsolutionsoftx.com/",
      [],
      withBackends([emptyForEveryName]),
    );
    expect(r.mx).toBeUndefined();
    expect(r.spf).toBeUndefined();
    expect(r.dmarc).toBeUndefined();
    expect(status(r, "dns-mx")).toBe("unmeasured");
    expect(status(r, "dns-spf")).toBe("unmeasured");
    expect(status(r, "dns-dmarc")).toBe("unmeasured");
  });

  it("does not let a failed control mark a contact address as unable to receive mail", async () => {
    const r = await lookupDns(
      "https://medicalsolutionsoftx.com/",
      ["info@old-agency.example"],
      withBackends([emptyForEveryName]),
    );
    expect(r.contactMx).toBeUndefined();
    expect(status(r, "dns-contact-mx")).toBe("unmeasured");
  });

  it("falls through to the next resolver that passes the control", async () => {
    const r = await lookupDns(
      "https://medicalsolutionsoftx.com/",
      [],
      withBackends([emptyForEveryName, working]),
    );
    expect(r.mx).toEqual(["medicalsolutionsoftx-com.mail.protection.outlook.com"]);
    expect(r.spf).toMatch(/^v=spf1 include:spf\.protection\.outlook\.com/);
    expect(status(r, "dns-mx")).toBe("pass");
    expect(status(r, "dns-spf")).toBe("pass");
  });

  it("still reports a real absence once the resolver has proven itself", async () => {
    // The fix must not turn every missing record into "couldn't check".
    const r = await lookupDns("https://nomail.example/", [], withBackends([working]));
    expect(r.mx).toEqual([]);
    expect(r.spf).toBeNull();
    expect(status(r, "dns-mx")).toBe("fail");
    expect(status(r, "dns-spf")).toBe("fail");
  });

  it("asks the control once per audit, not once per question", async () => {
    const asked: string[] = [];
    const counting: DnsBackend = {
      resolveTxt: working.resolveTxt,
      resolveMx: async (n) => {
        asked.push(n);
        return working.resolveMx(n);
      },
    };
    await lookupDns(
      "https://medicalsolutionsoftx.com/",
      ["a@nomail.example"],
      withBackends([counting]),
    );
    expect(asked.filter((n) => n === CONTROL_MX_DOMAIN)).toHaveLength(1);
  });
});

describe("dohDnsBackend — Google's JSON answers, read as Node's codes", () => {
  const fakeFetch =
    (byUrl: (url: string) => unknown, ok = true): typeof fetch =>
    async (input) =>
      ({ ok, json: async () => byUrl(String(input)) }) as Response;
  const code = (p: Promise<unknown>) =>
    p.then(
      () => "resolved",
      (e: { code?: string }) => e.code,
    );

  it("reads MX and TXT answers", async () => {
    const doh = dohDnsBackend(
      fakeFetch((url) =>
        url.includes("type=15")
          ? {
              Status: 0,
              Answer: [
                { type: 5, data: "alias.example." },
                { type: 15, data: "0 medicalsolutionsoftx-com.mail.protection.outlook.com." },
              ],
            }
          : {
              Status: 0,
              Answer: [{ type: 16, data: '"v=spf1 include:a.example " "-all"' }],
            },
      ),
    );
    expect(await doh.resolveMx("medicalsolutionsoftx.com")).toEqual([
      { exchange: "medicalsolutionsoftx-com.mail.protection.outlook.com", priority: 0 },
    ]);
    expect(await doh.resolveTxt("x.example")).toEqual([["v=spf1 include:a.example -all"]]);
  });

  it("NOERROR with no answer is ENODATA, NXDOMAIN is ENOTFOUND", async () => {
    expect(await code(dohDnsBackend(fakeFetch(() => ({ Status: 0 }))).resolveMx("a.example"))).toBe(
      "ENODATA",
    );
    expect(await code(dohDnsBackend(fakeFetch(() => ({ Status: 3 }))).resolveMx("a.example"))).toBe(
      "ENOTFOUND",
    );
  });

  it("a SERVFAIL, an HTTP error or a dead network is a failure to ask, never a 'none'", async () => {
    const asNone = new Set(["ENODATA", "ENOTFOUND"]);
    const servfail = dohDnsBackend(fakeFetch(() => ({ Status: 2 })));
    const http500 = dohDnsBackend(fakeFetch(() => ({}), false));
    const offline = dohDnsBackend(async () => {
      throw new TypeError("fetch failed");
    });
    for (const b of [servfail, http500, offline]) {
      expect(asNone.has(String(await code(b.resolveMx("a.example"))))).toBe(false);
      expect(asNone.has(String(await code(b.resolveTxt("a.example"))))).toBe(false);
    }
  });
});
