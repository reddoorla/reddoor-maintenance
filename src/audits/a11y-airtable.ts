import type { AuditResult } from "../types.js";

type A11yDetails = {
  totalViolations: number;
  byImpact: Partial<Record<"minor" | "moderate" | "serious" | "critical", number>>;
};

/** True when an a11y AuditResult carries real counts worth persisting.
 *  Mirrors the `hasRealScores` policy on lighthouse: write whenever real
 *  data exists, regardless of status (a "warn" or "fail" with concrete
 *  violation counts is exactly what the dashboard needs to track). */
export function hasA11yCounts(result: AuditResult): boolean {
  if (result.audit !== "a11y") return false;
  const details = result.details as A11yDetails | undefined;
  return typeof details?.totalViolations === "number";
}

export function a11yCountsFromResult(result: AuditResult): { violations: number } {
  if (result.audit !== "a11y") {
    throw new Error(`Expected an 'a11y' AuditResult, got '${result.audit}'`);
  }
  const details = result.details as A11yDetails | undefined;
  return { violations: details?.totalViolations ?? 0 };
}
