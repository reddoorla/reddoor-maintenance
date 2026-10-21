import type { AuditResult } from "../types.js";
import {
  MAX_STORED_LOCKFILE_ADVISORIES,
  normalizeSecurityAdvisory,
  type SecurityAdvisory,
  type SecurityLockfileAudit,
} from "../fleet/site-row.js";

type SecurityDetails = {
  counts: { low: number; moderate: number; high: number; critical: number };
  advisories?: unknown;
  partial?: boolean;
  lockfileAudit?: { counts: SecurityDetails["counts"]; advisories: unknown[] };
};

/** True when the result is Dependabot's alone, from a night the lockfile audit was needed but
 *  could not run (#1654): `planAuditWrite` merges it with the stored lockfile result. */
export function isPartialSecurityResult(result: AuditResult): boolean {
  return (result.details as SecurityDetails | undefined)?.partial === true;
}

/** pnpm's own result on a full merged night, ready to store (#1654), or undefined on any other
 *  night. Past `MAX_STORED_LOCKFILE_ADVISORIES` the list is cut and marked `truncated`. */
export function lockfileAuditFromResult(result: AuditResult): SecurityLockfileAudit | undefined {
  const view = (result.details as SecurityDetails | undefined)?.lockfileAudit;
  if (!view) return undefined;
  const advisories = view.advisories
    .map(normalizeSecurityAdvisory)
    .filter((a): a is SecurityAdvisory => a !== null);
  const c = view.counts;
  return {
    counts: { critical: c.critical, high: c.high, moderate: c.moderate, low: c.low },
    advisories: advisories.slice(0, MAX_STORED_LOCKFILE_ADVISORIES),
    truncated: advisories.length > MAX_STORED_LOCKFILE_ADVISORIES,
  };
}

/** True when a security AuditResult carries a counts object. Skipped runs
 *  (no pnpm + no npm) have no details and return false. */
export function hasSecurityCounts(result: AuditResult): boolean {
  if (result.audit !== "security") return false;
  const details = result.details as SecurityDetails | undefined;
  return !!details && typeof details.counts === "object";
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
