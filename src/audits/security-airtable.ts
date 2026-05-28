import type { AuditResult } from "../types.js";

type SecurityDetails = {
  counts: { low: number; moderate: number; high: number; critical: number };
};

/** True when a security AuditResult carries a counts object. Skipped runs
 *  (no pnpm + no npm) have no details and return false. */
export function hasSecurityCounts(result: AuditResult): boolean {
  if (result.audit !== "security") return false;
  const details = result.details as SecurityDetails | undefined;
  return !!details && typeof details.counts === "object";
}

export function securityCountsFromResult(
  result: AuditResult,
): { critical: number; high: number; moderate: number; low: number } {
  if (result.audit !== "security") {
    throw new Error(`Expected a 'security' AuditResult, got '${result.audit}'`);
  }
  const details = result.details as SecurityDetails | undefined;
  const c = details?.counts ?? { low: 0, moderate: 0, high: 0, critical: 0 };
  return { critical: c.critical, high: c.high, moderate: c.moderate, low: c.low };
}
