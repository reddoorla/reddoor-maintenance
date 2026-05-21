import type { AuditName, AuditResult, Site } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { defaultSpawn } from "./util/spawn.js";
import type { SpawnFn } from "./util/spawn.js";
import { depsAudit } from "./deps.js";
import { lintAudit } from "./lint.js";
import { securityAudit } from "./security.js";
import { lighthouseAudit } from "./lighthouse.js";
import { a11yAudit } from "./a11y.js";

const REGISTRY: Record<AuditName, (ctx: AuditContext) => Promise<AuditResult>> = {
  deps: depsAudit,
  lint: lintAudit,
  security: securityAudit,
  lighthouse: lighthouseAudit,
  a11y: a11yAudit,
};

export const ALL_AUDIT_NAMES = Object.keys(REGISTRY) as AuditName[];

/** Default per-audit spawn timeout when running via runAudits (30 s). */
const DEFAULT_AUDIT_TIMEOUT_MS = 30_000;

function timedSpawn(timeoutMs: number): SpawnFn {
  return (cmd, args, opts = {}) =>
    defaultSpawn(cmd, args, { ...opts, timeoutMs: opts.timeoutMs ?? timeoutMs });
}

export async function runAudits(site: Site, which?: AuditName[]): Promise<AuditResult[]> {
  const names = which ?? ALL_AUDIT_NAMES;
  for (const n of names) {
    if (!(n in REGISTRY)) throw new Error(`unknown audit: ${n}`);
  }
  const spawn = timedSpawn(DEFAULT_AUDIT_TIMEOUT_MS);
  const label = site.name ?? site.path;
  return Promise.all(
    names.map((n) =>
      REGISTRY[n]({ site, spawn }).catch(
        (err): AuditResult => ({
          audit: n,
          site: label,
          status: "fail",
          summary: `${n}: unexpected error — ${String(err)}`,
        }),
      ),
    ),
  );
}

export async function runAuditsAcross(sites: Site[], which?: AuditName[]): Promise<AuditResult[]> {
  const all = await Promise.all(sites.map((s) => runAudits(s, which)));
  return all.flat();
}

export { depsAudit, lintAudit, securityAudit, lighthouseAudit, a11yAudit };
