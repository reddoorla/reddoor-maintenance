import type { AuditResult } from "../types.js";
import { normalizeSecurityAdvisory, type SecurityAdvisory } from "../fleet/site-row.js";

type SecurityDetails = {
  counts: { low: number; moderate: number; high: number; critical: number };
  advisories?: unknown;
  partial?: boolean;
};

/** True when a security AuditResult carries a counts object. Skipped runs
 *  (no pnpm + no npm) have no details and return false. */
export function hasSecurityCounts(result: AuditResult): boolean {
  if (result.audit !== "security") return false;
  const details = result.details as SecurityDetails | undefined;
  return !!details && typeof details.counts === "object";
}

/** True when the counts cover only part of the tree: Dependabot's alerts on a site whose
 *  lockfile audit could not run (#1561). Such a run may raise stored counts, never lower them. */
export function isPartialSecurityResult(result: AuditResult): boolean {
  return (result.details as SecurityDetails | undefined)?.partial === true;
}

export function securityCountsFromResult(result: AuditResult): {
  critical: number;
  high: number;
  moderate: number;
  low: number;
} {
  if (result.audit !== "security") {
    throw new Error(`Expected a 'security' AuditResult, got '${result.audit}'`);
  }
  const details = result.details as SecurityDetails | undefined;
  const c = details?.counts ?? { low: 0, moderate: 0, high: 0, critical: 0 };
  return { critical: c.critical, high: c.high, moderate: c.moderate, low: c.low };
}

/** The known advisories behind the counts, normalized for persistence. Empty when the
 *  run was clean or carried no advisory detail (npm/pnpm sometimes omit it). Malformed
 *  entries are dropped via the shared `normalizeSecurityAdvisory`. */
export function advisoriesFromResult(result: AuditResult): SecurityAdvisory[] {
  if (result.audit !== "security") {
    throw new Error(`Expected a 'security' AuditResult, got '${result.audit}'`);
  }
  const details = result.details as SecurityDetails | undefined;
  const raw = details?.advisories;
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeSecurityAdvisory).filter((a): a is SecurityAdvisory => a !== null);
}
