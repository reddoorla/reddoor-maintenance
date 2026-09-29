import type { AuditResult } from "../types.js";
import type { DepsDetails, DepsDriftEntry } from "./deps.js";

/** True when a deps AuditResult carries the structured details (an entries
 *  array, per {@link DepsDetails}). */
export function hasDepsCounts(result: AuditResult): boolean {
  if (result.audit !== "deps") return false;
  const d = result.details as Partial<DepsDetails> | undefined;
  return Array.isArray(d?.entries);
}

export function depsCountsFromResult(result: AuditResult): {
  drifted: number;
  majorBehind: number;
  outdated: number | null;
  majorOutdated: number | null;
} {
  if (result.audit !== "deps") {
    throw new Error(`Expected a 'deps' AuditResult, got '${result.audit}'`);
  }
  const details = (result.details ?? {}) as Partial<DepsDetails>;
  const entries = (details.entries ?? []) as DepsDriftEntry[];
  // "drifted" = drift !== "same", which intentionally includes "newer" (ahead of
  // baseline) — parity with the deps audit summary text.
  const drifted = entries.filter((e) => e.drift !== "same").length;
  const majorBehind = entries.filter((e) => e.drift === "major").length;
  // The real installed-version drift, distinct from declared-range drift. Null
  // when the audit couldn't determine it (no/stale lockfile) — kept null (not 0)
  // so the dashboard shows "—" rather than a misleading "clean".
  const outdated = details.outdated?.outdated ?? null;
  // How many of those outdated installs are a *major* behind the registry's
  // latest — surfaced separately from the total so the cockpit can show
  // "N major" available, distinct from the baseline-drift "major" count. Shares
  // the outdated signal's null-when-undetermined semantics.
  const majorOutdated = details.outdated?.major ?? null;
  return { drifted, majorBehind, outdated, majorOutdated };
}
