import { promises as dnsPromises } from "node:dns";
import tls from "node:tls";
import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { siteLabel } from "../util/site.js";

/** Result of probing a site's domain: did DNS resolve, and how many days until the TLS cert
 *  expires (null when unresolved or no usable cert). The auto-tick verdict is recomputed from
 *  the persisted fields — this is just the raw signal. `reason` says why a probe failed
 *  (`dns ENOTFOUND`, `tls ECONNRESET`, `tls timeout after 10000ms`, …), null when it did not:
 *  run 42711182637 (2026-11-09) logged `domain warn msot` with no reason, and none survived. */
export type DomainCheck = {
  resolved: boolean;
  certDaysRemaining: number | null;
  reason: string | null;
  /** The transient failure a passing check needed one retry to get past, else null. */
  retriedAfter: string | null;
};

/** Injected IO so the check is unit-testable without real DNS/TLS. `lookup` throws when the host
 *  doesn't resolve; `certValidTo` returns the cert's notAfter date, or throws why it has none
 *  (null is still read as "no certificate returned"). */
export type DomainDeps = {
  lookup: (host: string) => Promise<void>;
  certValidTo: (host: string) => Promise<Date | null>;
  now: Date;
};

/** The TLS socket went idle for the whole budget: no handshake (or no TCP) answer at all. A
 *  distinct type so a timeout is never reported as a DNS failure or as an error code. */
export class DomainTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`timeout after ${timeoutMs}ms`);
    this.name = "DomainTimeoutError";
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TLS_TIMEOUT_MS = 10_000;

/** Network codes a second try can plausibly get past. A DNS answer, a refused port and every
 *  certificate verification error are deterministic and never retried (operator decision
 *  2026-11-10-0016, pick (c): one Broken off a single 10 s edge stall on 11-09 was a false alarm). */
const TRANSIENT_TLS_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNABORTED"]);

function isTransient(err: unknown): boolean {
  if (err instanceof DomainTimeoutError) return true;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && TRANSIENT_TLS_CODES.has(code);
}

/** One short token for a failure: the error's `code` when Node gave one, else its message. */
function why(stage: "dns" | "tls", err: unknown): string {
  if (err instanceof DomainTimeoutError) return `${stage} ${err.message}`;
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code) return `${stage} ${code}`;
  const message = err instanceof Error ? err.message : String(err);
  return `${stage} ${message || "unknown error"}`;
}

/**
 * Probe one URL's domain: resolve DNS, then read the TLS certificate expiry. PURE given its deps.
 * Any failure degrades safely — an unresolvable host or a missing/unreadable cert yields
 * `certDaysRemaining: null` (which the auto-tick rule treats as "not provable", never a pass) —
 * and keeps its reason.
 */
export async function checkDomain(url: string, deps: DomainDeps): Promise<DomainCheck> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { resolved: false, certDaysRemaining: null, reason: "invalid URL", retriedAfter: null };
  }
  try {
    await deps.lookup(host);
  } catch (err) {
    return {
      resolved: false,
      certDaysRemaining: null,
      reason: why("dns", err),
      retriedAfter: null,
    };
  }
  let validTo: Date | null;
  let retriedAfter: string | null = null;
  try {
    validTo = await deps.certValidTo(host);
  } catch (first) {
    if (!isTransient(first))
      return {
        resolved: true,
        certDaysRemaining: null,
        reason: why("tls", first),
        retriedAfter: null,
      };
    retriedAfter = why("tls", first);
    try {
      validTo = await deps.certValidTo(host);
    } catch (second) {
      return {
        resolved: true,
        certDaysRemaining: null,
        reason: `${retriedAfter}, then ${why("tls", second)}`,
        retriedAfter: null,
      };
    }
  }
  const failed = (reason: string): DomainCheck => ({
    resolved: true,
    certDaysRemaining: null,
    reason: retriedAfter ? `${retriedAfter}, then ${reason}` : reason,
    retriedAfter: null,
  });
  if (!validTo) return failed("tls no certificate returned");
  if (Number.isNaN(validTo.getTime())) return failed("tls certificate expiry unreadable");
  return {
    resolved: true,
    certDaysRemaining: Math.floor((validTo.getTime() - deps.now.getTime()) / MS_PER_DAY),
    reason: null,
    retriedAfter,
  };
}

/** Options for the real deps. Production passes none: port 443, a 10 s idle budget, and Node's
 *  default trust store. `port`, `timeoutMs` and `ca` exist so tests can point the real TLS code
 *  at a local server. `ca` REPLACES Node's default roots (it does not add to them), so it is for
 *  tests only; verification itself is never turned off. */
export type DomainDepsOptions = { port?: number; timeoutMs?: number; ca?: string };

/** Real DNS + TLS. `certValidTo` opens a TLS socket (SNI = host), reads the peer cert's
 *  `valid_to`, and closes immediately — no HTTP request. A failure rejects with the socket's
 *  error (its `code` is the reason) or a `DomainTimeoutError`. */
export function defaultDomainDeps(now: Date, opts: DomainDepsOptions = {}): DomainDeps {
  const port = opts.port ?? 443;
  const timeoutMs = opts.timeoutMs ?? TLS_TIMEOUT_MS;
  return {
    lookup: async (host) => {
      await dnsPromises.lookup(host);
    },
    certValidTo: (host) =>
      new Promise<Date | null>((resolvePromise, rejectPromise) => {
        // `rejectUnauthorized: true` is what makes this check HONEST and the green box truthful:
        // the secureConnect callback only fires on a trusted, host-matching (SNI), unexpired
        // chain — an expired / self-signed / untrusted-CA / SAN-mismatched cert fires "error"
        // → fail. The whole "valid cert" claim depends on this. NEVER set it false.
        // `socket.authorized` is asserted belt-and-suspenders before trusting `valid_to`.
        const socket = tls.connect(
          {
            host,
            port,
            servername: host,
            timeout: timeoutMs,
            rejectUnauthorized: true,
            ...(opts.ca ? { ca: opts.ca } : {}),
          },
          () => {
            if (!socket.authorized) {
              const code = String(socket.authorizationError ?? "unauthorized");
              socket.destroy();
              rejectPromise(Object.assign(new Error(code), { code }));
              return;
            }
            const cert = socket.getPeerCertificate();
            socket.end();
            resolvePromise(cert && cert.valid_to ? new Date(cert.valid_to) : null);
          },
        );
        socket.on("error", (err) => rejectPromise(err));
        socket.on("timeout", () => {
          socket.destroy();
          rejectPromise(new DomainTimeoutError(timeoutMs));
        });
      }),
    now,
  };
}

/**
 * Audit a site's domain (DNS + TLS) against its deployed URL. Checkout-free — needs only
 * `site.deployedUrl`. Skips a site with no deployed URL. Writes `certDaysRemaining` + a checked-at
 * timestamp via the write-back; the auto-tick rule decides pass/fail from those.
 */
export async function domainAudit(ctx: AuditContext): Promise<AuditResult> {
  const { site } = ctx;
  const label = siteLabel(site);
  if (!site.deployedUrl) {
    return {
      audit: "domain",
      site: label,
      status: "skip",
      summary: "no deployed URL",
      notApplicable: true,
    };
  }
  const now = ctx.now ?? new Date();
  const deps = ctx.domainDeps ?? defaultDomainDeps(now);
  const check = await checkDomain(site.deployedUrl, deps);
  const checkedAt = now.toISOString();
  const status: AuditResult["status"] =
    check.resolved && check.certDaysRemaining !== null && check.certDaysRemaining > 14
      ? "pass"
      : "warn";
  const summary = !check.resolved
    ? `did not resolve (${check.reason})`
    : check.certDaysRemaining === null
      ? `resolved, no usable TLS cert (${check.reason})`
      : `resolved, cert ${check.certDaysRemaining}d remaining` +
        (check.retriedAfter ? ` (passed on retry after ${check.retriedAfter})` : "");
  return {
    audit: "domain",
    site: label,
    status,
    summary,
    details: {
      resolved: check.resolved,
      certDaysRemaining: check.certDaysRemaining,
      reason: check.reason,
      retriedAfter: check.retriedAfter,
      checkedAt,
    },
  };
}
