import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import {
  checkDomain,
  defaultDomainDeps,
  domainAudit,
  DomainTimeoutError,
  type DomainDeps,
} from "../../src/audits/domain.js";

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
    expect(r).toEqual({
      resolved: false,
      certDaysRemaining: null,
      reason: "dns ENOTFOUND",
      retriedAfter: null,
    });
  });

  it("returns resolved + null cert when no cert is available", async () => {
    const r = await checkDomain(
      "https://acme.example.com",
      deps({ certValidTo: async () => null }),
    );
    expect(r).toEqual({
      resolved: true,
      certDaysRemaining: null,
      reason: "tls no certificate returned",
      retriedAfter: null,
    });
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

// ---------------------------------------------------------------------------
// The failure reason (2026-11-09: run 42711182637 logged `domain warn msot` with no reason,
// and the reason could not be recovered afterwards). Each failure path says why, in the
// summary that the run log prints and in `details.reason`, through `domainAudit`.
// ---------------------------------------------------------------------------
describe("domainAudit records why the domain check failed", () => {
  const site = { path: "/tmp/acme", name: "acme", deployedUrl: "https://acme.example.com" };
  const codeErr = (message: string, code: string) => Object.assign(new Error(message), { code });

  it("a pass carries no reason", async () => {
    const r = await domainAudit({ site, now: NOW, domainDeps: deps() });
    expect(r.status).toBe("pass");
    expect(r.details).toMatchObject({ reason: null });
  });

  it("DNS failure: the lookup's error code", async () => {
    const r = await domainAudit({
      site,
      now: NOW,
      domainDeps: deps({
        lookup: async () => {
          throw codeErr("getaddrinfo ENOTFOUND acme.example.com", "ENOTFOUND");
        },
      }),
    });
    expect(r.status).toBe("warn");
    expect(r.summary).toBe("did not resolve (dns ENOTFOUND)");
    expect(r.details).toMatchObject({ resolved: false, reason: "dns ENOTFOUND" });
  });

  it("TLS error: the socket's error code", async () => {
    const r = await domainAudit({
      site,
      now: NOW,
      domainDeps: deps({
        certValidTo: async () => {
          throw codeErr("read ECONNRESET", "ECONNRESET");
        },
      }),
    });
    expect(r.status).toBe("warn");
    expect(r.summary).toBe("resolved, no usable TLS cert (tls ECONNRESET, then tls ECONNRESET)");
    expect(r.details).toMatchObject({
      resolved: true,
      certDaysRemaining: null,
      reason: "tls ECONNRESET, then tls ECONNRESET",
    });
  });

  it("TLS error without a code: the message", async () => {
    const r = await domainAudit({
      site,
      now: NOW,
      domainDeps: deps({
        certValidTo: async () => {
          throw new Error("tls handshake failed");
        },
      }),
    });
    expect(r.details).toMatchObject({ reason: "tls tls handshake failed" });
  });

  it("TLS timeout: resolved, and the reason says it timed out (never 'did not resolve')", async () => {
    const r = await domainAudit({
      site,
      now: NOW,
      domainDeps: deps({
        certValidTo: async () => {
          throw new DomainTimeoutError(10_000);
        },
      }),
    });
    expect(r.status).toBe("warn");
    expect(r.summary).toBe(
      "resolved, no usable TLS cert (tls timeout after 10000ms, then tls timeout after 10000ms)",
    );
    expect(r.summary).not.toContain("did not resolve");
    expect(r.details).toMatchObject({
      resolved: true,
      certDaysRemaining: null,
      reason: "tls timeout after 10000ms, then tls timeout after 10000ms",
    });
  });

  it("no certificate returned", async () => {
    const r = await domainAudit({
      site,
      now: NOW,
      domainDeps: deps({ certValidTo: async () => null }),
    });
    expect(r.summary).toBe("resolved, no usable TLS cert (tls no certificate returned)");
    expect(r.details).toMatchObject({ reason: "tls no certificate returned" });
  });

  it("an unreadable expiry date", async () => {
    const r = await domainAudit({
      site,
      now: NOW,
      domainDeps: deps({ certValidTo: async () => new Date("garbage") }),
    });
    expect(r.details).toMatchObject({ reason: "tls certificate expiry unreadable" });
  });

  it("an unparseable deployed URL", async () => {
    const r = await domainAudit({
      site: { ...site, deployedUrl: "not a url" },
      now: NOW,
      domainDeps: deps(),
    });
    expect(r.summary).toBe("did not resolve (invalid URL)");
    expect(r.details).toMatchObject({ resolved: false, reason: "invalid URL" });
  });

  it("a cert near expiry names the days, and is not a failure reason", async () => {
    const r = await domainAudit({
      site,
      now: NOW,
      domainDeps: deps({ certValidTo: async () => new Date("2026-06-25T00:00:00.000Z") }),
    });
    expect(r.status).toBe("warn");
    expect(r.summary).toBe("resolved, cert 7d remaining");
    expect(r.details).toMatchObject({ reason: null });
  });
});

// ---------------------------------------------------------------------------
// The real TLS deps against local servers, through `domainAudit`: the instrument must pass on
// a trusted cert, and fail closed (with the reason) on an untrusted one and on a silent peer.
// ---------------------------------------------------------------------------
describe("defaultDomainDeps against local TLS servers", () => {
  let dir: string;
  let key: string;
  let cert: string;
  const servers: Array<tls.Server | net.Server> = [];
  const sockets: net.Socket[] = [];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "domain-tls-"));
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "30",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
    key = readFileSync(join(dir, "key.pem"), "utf8");
    cert = readFileSync(join(dir, "cert.pem"), "utf8");
  });

  afterAll(async () => {
    for (const sock of sockets) sock.destroy();
    await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r(undefined)))));
    rmSync(dir, { recursive: true, force: true });
  });

  async function listen<S extends tls.Server | net.Server>(server: S): Promise<number> {
    servers.push(server);
    server.on("connection", (sock: net.Socket) => {
      sockets.push(sock);
      sock.on("error", () => {});
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    return (server.address() as net.AddressInfo).port;
  }
  const localSite = { path: "/tmp/local", name: "local", deployedUrl: "https://localhost/" };
  const now = new Date();

  it("positive control: a cert the client trusts passes", async () => {
    const port = await listen(tls.createServer({ key, cert }, (s) => s.end()));
    const r = await domainAudit({
      site: localSite,
      now,
      domainDeps: defaultDomainDeps(now, { port, ca: cert }),
    });
    expect(r.status).toBe("pass");
    expect(r.details).toMatchObject({ resolved: true, reason: null });
    expect((r.details as { certDaysRemaining: number }).certDaysRemaining).toBeGreaterThan(14);
  });

  it("an untrusted (self-signed) cert fails closed, with the verification code", async () => {
    const server = tls.createServer({ key, cert }, (s) => s.end());
    let connections = 0;
    server.on("connection", () => connections++);
    const port = await listen(server);
    const r = await domainAudit({
      site: localSite,
      now,
      domainDeps: defaultDomainDeps(now, { port }),
    });
    expect(r.status).toBe("warn");
    expect(r.details).toMatchObject({
      resolved: true,
      certDaysRemaining: null,
      reason: "tls DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    expect(r.summary).toBe("resolved, no usable TLS cert (tls DEPTH_ZERO_SELF_SIGNED_CERT)");
    expect(connections).toBe(1); // a certificate failure is never retried
  });

  it("a peer that accepts TCP and never answers TLS times out, named as a timeout", async () => {
    const port = await listen(net.createServer(() => {}));
    const r = await domainAudit({
      site: localSite,
      now,
      domainDeps: defaultDomainDeps(now, { port, timeoutMs: 300 }),
    });
    expect(r.status).toBe("warn");
    expect(r.details).toMatchObject({
      resolved: true,
      reason: "tls timeout after 300ms, then tls timeout after 300ms",
    });
  });

  it("asks Node to verify the chain itself (rejectUnauthorized stays true)", async () => {
    // The `socket.authorized` re-check also fails an untrusted cert closed, so the behavioural
    // test above survives this flag alone being turned off; this pins the flag directly.
    const port = await listen(tls.createServer({ key, cert }, (s) => s.end()));
    const spy = vi.spyOn(tls, "connect");
    try {
      await domainAudit({ site: localSite, now, domainDeps: defaultDomainDeps(now, { port }) });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![0]).toMatchObject({
        rejectUnauthorized: true,
        servername: "localhost",
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("a cert for another host fails closed, even from a trusted CA", async () => {
    // The cert names `localhost`; the site is `127.0.0.1`, so the SAN does not match.
    const port = await listen(tls.createServer({ key, cert }, (s) => s.end()));
    const r = await domainAudit({
      site: { ...localSite, deployedUrl: "https://127.0.0.1/" },
      now,
      domainDeps: defaultDomainDeps(now, { port, ca: cert }),
    });
    expect(r.status).toBe("warn");
    expect(r.details).toMatchObject({
      resolved: true,
      certDaysRemaining: null,
      reason: "tls ERR_TLS_CERT_ALTNAME_INVALID",
    });
  });

  it("real sockets: a silent peer twice fails with both timeouts", async () => {
    const port = await listen(net.createServer(() => {}));
    const r = await domainAudit({
      site: localSite,
      now,
      domainDeps: defaultDomainDeps(now, { port, timeoutMs: 200 }),
    });
    expect(r.status).toBe("warn");
    expect(r.details).toMatchObject({
      reason: "tls timeout after 200ms, then tls timeout after 200ms",
    });
  });

  it("real sockets: a reset on the first connection, then a trusted cert, passes on the retry", async () => {
    let n = 0;
    const server = tls.createServer({ key, cert }, (s) => s.end());
    server.prependListener("connection", (sock: net.Socket) => {
      if (n++ === 0) sock.resetAndDestroy();
    });
    const port = await listen(server);
    const r = await domainAudit({
      site: localSite,
      now,
      domainDeps: defaultDomainDeps(now, { port, ca: cert }),
    });
    expect(n).toBe(2);
    expect(r.status).toBe("pass");
    expect(r.details).toMatchObject({ reason: null });
    // A write racing the RST can surface as EPIPE on some kernels; both are transient.
    expect((r.details as { retriedAfter: string }).retriedAfter).toMatch(
      /^tls (ECONNRESET|EPIPE)$/,
    );
  });

  it("a refused connection carries its code", async () => {
    // Port 1 (tcpmux) is privileged and unused, so nothing else can grab it mid-test.
    const r = await domainAudit({
      site: localSite,
      now,
      domainDeps: defaultDomainDeps(now, { port: 1 }),
    });
    expect(r.details).toMatchObject({ resolved: true, reason: "tls ECONNREFUSED" });
  });
});

// ---------------------------------------------------------------------------
// One retry on a transient TLS failure (operator decision 2026-11-10-0016, pick (c)): a timeout
// or connection reset is tried once more; a DNS failure or a certificate verification error is
// never retried. The first failure is kept even when the retry passes.
// ---------------------------------------------------------------------------
describe("domainAudit retries a transient TLS failure once", () => {
  const site = { path: "/tmp/acme", name: "acme", deployedUrl: "https://acme.example.com" };
  const codeErr = (message: string, code: string) => Object.assign(new Error(message), { code });
  const GOOD = new Date("2026-09-01T00:00:00.000Z"); // 75 days after NOW

  /** A certValidTo that plays `outcomes` in order and counts its calls. */
  function scripted(...outcomes: Array<Error | Date>) {
    let calls = 0;
    const fn = async () => {
      const o = outcomes[Math.min(calls++, outcomes.length - 1)]!;
      if (o instanceof Error) throw o;
      return o;
    };
    return { fn, calls: () => calls };
  }

  it("a timeout then a good handshake passes, and says it needed the retry", async () => {
    const c = scripted(new DomainTimeoutError(10_000), GOOD);
    const r = await domainAudit({ site, now: NOW, domainDeps: deps({ certValidTo: c.fn }) });
    expect(c.calls()).toBe(2);
    expect(r.status).toBe("pass");
    expect(r.summary).toBe(
      "resolved, cert 75d remaining (passed on retry after tls timeout after 10000ms)",
    );
    expect(r.details).toMatchObject({
      resolved: true,
      certDaysRemaining: 75,
      reason: null,
      retriedAfter: "tls timeout after 10000ms",
    });
  });

  it("a connection reset then a good handshake passes on the retry", async () => {
    const c = scripted(codeErr("read ECONNRESET", "ECONNRESET"), GOOD);
    const r = await domainAudit({ site, now: NOW, domainDeps: deps({ certValidTo: c.fn }) });
    expect(c.calls()).toBe(2);
    expect(r.status).toBe("pass");
    expect(r.details).toMatchObject({ retriedAfter: "tls ECONNRESET" });
  });

  it("two timeouts fail, with both attempts in the reason, and no third try", async () => {
    const c = scripted(new DomainTimeoutError(10_000), new DomainTimeoutError(10_000), GOOD);
    const r = await domainAudit({ site, now: NOW, domainDeps: deps({ certValidTo: c.fn }) });
    expect(c.calls()).toBe(2);
    expect(r.status).toBe("warn");
    expect(r.details).toMatchObject({
      resolved: true,
      certDaysRemaining: null,
      reason: "tls timeout after 10000ms, then tls timeout after 10000ms",
    });
  });

  it("a certificate verification error is not retried", async () => {
    const c = scripted(codeErr("certificate has expired", "CERT_HAS_EXPIRED"), GOOD);
    const r = await domainAudit({ site, now: NOW, domainDeps: deps({ certValidTo: c.fn }) });
    expect(c.calls()).toBe(1);
    expect(r.status).toBe("warn");
    expect(r.details).toMatchObject({ reason: "tls CERT_HAS_EXPIRED", retriedAfter: null });
  });

  it("a refused connection is not retried", async () => {
    const c = scripted(codeErr("connect ECONNREFUSED", "ECONNREFUSED"), GOOD);
    const r = await domainAudit({ site, now: NOW, domainDeps: deps({ certValidTo: c.fn }) });
    expect(c.calls()).toBe(1);
    expect(r.details).toMatchObject({ reason: "tls ECONNREFUSED" });
  });

  it("a DNS failure is not retried", async () => {
    let lookups = 0;
    const c = scripted(GOOD);
    const r = await domainAudit({
      site,
      now: NOW,
      domainDeps: deps({
        lookup: async () => {
          lookups++;
          throw codeErr("getaddrinfo EAI_AGAIN acme.example.com", "EAI_AGAIN");
        },
        certValidTo: c.fn,
      }),
    });
    expect(lookups).toBe(1);
    expect(c.calls()).toBe(0);
    expect(r.details).toMatchObject({ resolved: false, reason: "dns EAI_AGAIN" });
  });

  it.each(["ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNABORTED"])(
    "%s is transient: retried once, and a good second handshake passes",
    async (code) => {
      const c = scripted(codeErr(`socket ${code}`, code), GOOD);
      const r = await domainAudit({ site, now: NOW, domainDeps: deps({ certValidTo: c.fn }) });
      expect(c.calls()).toBe(2);
      expect(r.status).toBe("pass");
      expect(r.details).toMatchObject({ retriedAfter: `tls ${code}` });
    },
  );

  it("a transient failure then no certificate names both, and fails", async () => {
    let calls = 0;
    const certValidTo = async () => {
      if (calls++ === 0) throw new DomainTimeoutError(10_000);
      return null;
    };
    const r = await domainAudit({ site, now: NOW, domainDeps: deps({ certValidTo }) });
    expect(calls).toBe(2);
    expect(r.status).toBe("warn");
    expect(r.details).toMatchObject({
      certDaysRemaining: null,
      reason: "tls timeout after 10000ms, then tls no certificate returned",
      retriedAfter: null,
    });
  });

  it("a first-try pass records no retry", async () => {
    const c = scripted(GOOD);
    const r = await domainAudit({ site, now: NOW, domainDeps: deps({ certValidTo: c.fn }) });
    expect(c.calls()).toBe(1);
    expect(r.summary).toBe("resolved, cert 75d remaining");
    expect(r.details).toMatchObject({ reason: null, retriedAfter: null });
  });
});
