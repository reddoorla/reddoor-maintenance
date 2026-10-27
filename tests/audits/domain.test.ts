import { describe, it, expect } from "vitest";
import { checkDomain, domainAudit, type DomainDeps } from "../../src/audits/domain.js";

const NOW = new Date("2026-06-18T00:00:00.000Z");

function deps(over: Partial<DomainDeps> = {}): DomainDeps {
  return {
    lookup: async () => {},
    certValidTo: async () => new Date("2026-09-01T00:00:00.000Z"), // ~75 days out
    now: NOW,
    ...over,
  };
}

describe("checkDomain", () => {
  it("returns resolved + cert days remaining when DNS resolves and a cert is present", async () => {
    const r = await checkDomain("https://acme.example.com", deps());
    expect(r.resolved).toBe(true);
    expect(r.certDaysRemaining).toBe(75);
  });

  it("returns unresolved + null when DNS lookup throws", async () => {
    const r = await checkDomain(
      "https://nope.example.com",
      deps({
        lookup: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    );
    expect(r).toEqual({ resolved: false, certDaysRemaining: null });
  });

  it("returns resolved + null cert when no cert is available", async () => {
    const r = await checkDomain(
      "https://acme.example.com",
      deps({ certValidTo: async () => null }),
    );
    expect(r).toEqual({ resolved: true, certDaysRemaining: null });
  });

  it("treats a TLS error as no cert (null), not a throw", async () => {
    const r = await checkDomain(
      "https://acme.example.com",
      deps({
        certValidTo: async () => {
          throw new Error("tls handshake failed");
        },
      }),
    );
    expect(r.certDaysRemaining).toBeNull();
  });

  it("returns unresolved for an unparseable URL", async () => {
    const r = await checkDomain("not a url", deps());
    expect(r.resolved).toBe(false);
  });

  it("guards an Invalid Date cert (null, never NaN days)", async () => {
    const r = await checkDomain(
      "https://acme.example.com",
      deps({ certValidTo: async () => new Date("garbage") }),
    );
    expect(r.certDaysRemaining).toBeNull();
  });
});

describe("domainAudit", () => {
  const site = { path: "/tmp/acme", name: "acme", deployedUrl: "https://acme.example.com" };

  it("skips a site with no deployed URL", async () => {
    const r = await domainAudit({ site: { path: "/tmp/acme", name: "acme" }, now: NOW });
    expect(r.status).toBe("skip");
    expect(r.details).toBeUndefined();
  });

  it("passes + writes details when resolved with a comfortable cert", async () => {
    const r = await domainAudit({ site, now: NOW, domainDeps: deps() });
    expect(r.status).toBe("pass");
    expect(r.details).toMatchObject({ resolved: true, certDaysRemaining: 75 });
    expect((r.details as { checkedAt: string }).checkedAt).toBe(NOW.toISOString());
  });

  it("warns when the cert is near expiry", async () => {
    const r = await domainAudit({
      site,
      now: NOW,
      domainDeps: deps({ certValidTo: async () => new Date("2026-06-25T00:00:00.000Z") }), // 7d
    });
    expect(r.status).toBe("warn");
    expect(r.details).toMatchObject({ certDaysRemaining: 7 });
  });

  it("warns when the domain does not resolve", async () => {
    const r = await domainAudit({
      site,
      now: NOW,
      domainDeps: deps({
        lookup: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    });
    expect(r.status).toBe("warn");
    expect(r.details).toMatchObject({ resolved: false, certDaysRemaining: null });
  });
});
