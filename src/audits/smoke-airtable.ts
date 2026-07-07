import type { AuditResult } from "../types.js";
import type { SmokeResult } from "../reports/airtable/websites.js";

type SmokeDetails = { ok: "pass" | "fail"; checkedAt: string };

/** True when an AuditResult is a `smoke` audit that actually ran (has details with
 *  a checkedAt — a "skip" for a missing `pnpm`/`test:smoke` script has none, so the
 *  writer preserves the prior verdict). */
export function hasSmokeResult(result: AuditResult): boolean {
  if (result.audit !== "smoke") return false;
  const d = result.details as SmokeDetails | undefined;
  return !!d && typeof d.checkedAt === "string";
}

/** Extract the Airtable-writable smoke verdict (pass/fail + checked-at). */
export function smokeResultFromAudit(result: AuditResult): SmokeResult {
  if (result.audit !== "smoke") {
    throw new Error(`Expected a 'smoke' AuditResult, got '${result.audit}'`);
  }
  const d = result.details as SmokeDetails | undefined;
  return {
    ok: d?.ok === "fail" ? "fail" : "pass",
    checkedAt: typeof d?.checkedAt === "string" ? d.checkedAt : new Date().toISOString(),
  };
}
