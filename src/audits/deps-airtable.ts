import type { AuditResult } from "../types.js";
import type { DepsDriftEntry } from "./deps.js";

/** True when a deps AuditResult carries a drift-entry array. */
export function hasDepsCounts(result: AuditResult): boolean {
  if (result.audit !== "deps") return false;
  return Array.isArray(result.details);
}

export function depsCountsFromResult(
  result: AuditResult,
): { drifted: number; majorBehind: number } {
  if (result.audit !== "deps") {
    throw new Error(`Expected a 'deps' AuditResult, got '${result.audit}'`);
  }
  const entries = (result.details ?? []) as DepsDriftEntry[];
  // Parity with src/audits/deps.ts summary text: "drifted" = drift !== "same",
  // which intentionally includes "newer" (ahead of baseline). Refactor target
  // for a future "actionable drift only" signal; out of scope here.
  const drifted = entries.filter((e) => e.drift !== "same").length;
  const majorBehind = entries.filter((e) => e.drift === "major").length;
  return { drifted, majorBehind };
}
