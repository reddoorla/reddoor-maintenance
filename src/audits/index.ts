import type { AuditName, AuditResult, Site } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { defaultSpawn } from "./util/spawn.js";
import type { SpawnFn } from "./util/spawn.js";
import { depsAudit } from "./deps.js";
import { lintAudit } from "./lint.js";
import { securityAudit } from "./security.js";
import { lighthouseAudit } from "./lighthouse.js";
import { a11yAudit } from "./a11y.js";
import { domainAudit } from "./domain.js";

const REGISTRY: Record<AuditName, (ctx: AuditContext) => Promise<AuditResult>> = {
  deps: depsAudit,
  lint: lintAudit,
  security: securityAudit,
  lighthouse: lighthouseAudit,
  a11y: a11yAudit,
  domain: domainAudit,
};

export const ALL_AUDIT_NAMES = Object.keys(REGISTRY) as AuditName[];

/** Default per-audit spawn timeout when running via runAudits (30 s). */
const DEFAULT_AUDIT_TIMEOUT_MS = 30_000;

function timedSpawn(timeoutMs: number): SpawnFn {
  return (cmd, args, opts = {}) =>
    defaultSpawn(cmd, args, { ...opts, timeoutMs: opts.timeoutMs ?? timeoutMs });
}

/** Single-audit runner with the same error-to-result conversion that
 *  `runAudits` applies. Exposed so the CLI can wrap each audit in its
 *  own progress task (listr2) and surface per-audit completion timing,
 *  while keeping audit implementations UI-free. */
export async function runOneAudit(site: Site, name: AuditName): Promise<AuditResult> {
  if (!(name in REGISTRY)) throw new Error(`unknown audit: ${name}`);
  const spawn = timedSpawn(DEFAULT_AUDIT_TIMEOUT_MS);
  // `||` not `??`: an empty-string slug (Airtable Name with no slug-able chars)
  // must fall back to the path, not render a blank `AuditResult.site` that would
  // then collapse fleet write-back grouping under the "" key.
  const label = site.name || site.path;
  try {
    return await REGISTRY[name]({ site, spawn });
  } catch (err) {
    return {
      audit: name,
      site: label,
      status: "fail",
      summary: `${name}: unexpected error — ${String(err)}`,
    };
  }
}

export async function runAudits(site: Site, which?: AuditName[]): Promise<AuditResult[]> {
  const names = which ?? ALL_AUDIT_NAMES;
  for (const n of names) {
    if (!(n in REGISTRY)) throw new Error(`unknown audit: ${n}`);
  }
  return Promise.all(names.map((n) => runOneAudit(site, n)));
}

export async function runAuditsAcross(sites: Site[], which?: AuditName[]): Promise<AuditResult[]> {
  const all = await Promise.all(sites.map((s) => runAudits(s, which)));
  return all.flat();
}

export { depsAudit, lintAudit, securityAudit, lighthouseAudit, a11yAudit };
