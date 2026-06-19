import { promises as dnsPromises } from "node:dns";
import tls from "node:tls";
import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { siteLabel } from "../util/site.js";

/** Result of probing a site's domain: did DNS resolve, and how many days until the TLS cert
 *  expires (null when unresolved or no usable cert). The auto-tick verdict is recomputed from
 *  the persisted fields — this is just the raw signal. */
export type DomainCheck = {
  resolved: boolean;
  certDaysRemaining: number | null;
};

/** Injected IO so the check is unit-testable without real DNS/TLS. `lookup` throws when the host
 *  doesn't resolve; `certValidTo` returns the cert's notAfter date, or null when there's none. */
export type DomainDeps = {
  lookup: (host: string) => Promise<void>;
  certValidTo: (host: string) => Promise<Date | null>;
  now: Date;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Probe one URL's domain: resolve DNS, then read the TLS certificate expiry. PURE given its deps.
 * Any failure degrades safely — an unresolvable host or a missing/unreadable cert yields
 * `certDaysRemaining: null` (which the auto-tick rule treats as "not provable", never a pass).
 */
export async function checkDomain(url: string, deps: DomainDeps): Promise<DomainCheck> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { resolved: false, certDaysRemaining: null };
  }
  try {
    await deps.lookup(host);
  } catch {
    return { resolved: false, certDaysRemaining: null };
  }
  let validTo: Date | null;
  try {
    validTo = await deps.certValidTo(host);
  } catch {
    validTo = null;
  }
  if (!validTo || Number.isNaN(validTo.getTime()))
    return { resolved: true, certDaysRemaining: null };
  return {
    resolved: true,
    certDaysRemaining: Math.floor((validTo.getTime() - deps.now.getTime()) / MS_PER_DAY),
  };
}

/** Real DNS + TLS. `certValidTo` opens a TLS socket (SNI = host), reads the peer cert's
 *  `valid_to`, and closes immediately — no HTTP request. */
export function defaultDomainDeps(now: Date): DomainDeps {
  return {
    lookup: async (host) => {
      await dnsPromises.lookup(host);
    },
    certValidTo: (host) =>
      new Promise<Date | null>((resolvePromise) => {
        // `rejectUnauthorized: true` is what makes this check HONEST and the green box truthful:
        // the secureConnect callback only fires on a trusted, host-matching (SNI), unexpired
        // chain — an expired / self-signed / untrusted-CA / SAN-mismatched cert fires "error"
        // → null → fail. The whole "valid cert" claim depends on this. NEVER set it false.
        // `socket.authorized` is asserted belt-and-suspenders before trusting `valid_to`.
        const socket = tls.connect(
          { host, port: 443, servername: host, timeout: 10_000, rejectUnauthorized: true },
          () => {
            const cert = socket.authorized ? socket.getPeerCertificate() : null;
            socket.end();
            const validTo = cert && cert.valid_to ? new Date(cert.valid_to) : null;
            resolvePromise(validTo);
          },
        );
        socket.on("error", () => resolvePromise(null));
        socket.on("timeout", () => {
          socket.destroy();
          resolvePromise(null);
        });
      }),
    now,
  };
}

/**
 * Audit a site's domain (DNS + TLS) against its deployed URL. Checkout-free — needs only
 * `site.deployedUrl`. Skips a site with no deployed URL. Writes `certDaysRemaining` + a checked-at
 * timestamp via the Airtable layer; the auto-tick rule decides pass/fail from those.
 */
export async function domainAudit(ctx: AuditContext): Promise<AuditResult> {
  const { site } = ctx;
  const label = siteLabel(site);
  if (!site.deployedUrl) {
    return { audit: "domain", site: label, status: "skip", summary: "no deployed URL" };
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
    ? "did not resolve"
    : check.certDaysRemaining === null
      ? "resolved, no usable TLS cert"
      : `resolved, cert ${check.certDaysRemaining}d remaining`;
  return {
    audit: "domain",
    site: label,
    status,
    summary,
    details: { resolved: check.resolved, certDaysRemaining: check.certDaysRemaining, checkedAt },
  };
}
