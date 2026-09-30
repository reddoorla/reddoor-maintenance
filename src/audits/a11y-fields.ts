import type { AuditResult } from "../types.js";
import type { A11yCounts } from "../fleet/site-fields.js";

type A11yDetails = {
  totalViolations: number;
  byImpact: Partial<Record<"minor" | "moderate" | "serious" | "critical", number>>;
  routes?: { scanned?: unknown; total?: unknown };
};

const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

/** True when an a11y AuditResult carries real counts worth persisting.
 *  Mirrors the `hasRealScores` policy on lighthouse: write whenever real
 *  data exists, regardless of status (a "warn" or "fail" with concrete
 *  violation counts is exactly what the dashboard needs to track). */
export function hasA11yCounts(result: AuditResult): boolean {
  if (result.audit !== "a11y") return false;
  const details = result.details as A11yDetails | undefined;
  return typeof details?.totalViolations === "number";
}

/** The violation count plus the route coverage it was measured over (#910).
 *  A route count the details do not carry reads null, which the write-back
 *  stores as null, so a run that cannot say what it covered never inherits
 *  the previous run's coverage. */
export function a11yCountsFromResult(result: AuditResult): A11yCounts {
  if (result.audit !== "a11y") {
    throw new Error(`Expected an 'a11y' AuditResult, got '${result.audit}'`);
  }
  const details = result.details as A11yDetails | undefined;
  return {
    violations: details?.totalViolations ?? 0,
    routesScanned: count(details?.routes?.scanned),
    routesTotal: count(details?.routes?.total),
  };
}
