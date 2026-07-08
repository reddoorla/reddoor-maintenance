import type { AuditResult } from "../types.js";
import type { FormE2eResult } from "../reports/airtable/websites.js";

type FormE2eDetails = { ok: "pass" | "fail" | null; formPresent: boolean; checkedAt: string };

/** True when an AuditResult is a `form-e2e` audit that actually RAN (has details
 *  with a checkedAt). Both a real verdict AND the no-form n/a case carry a checkedAt,
 *  so both persist; only a no-deployed-URL skip (no details) is preserved-prior. */
export function hasFormE2eResult(result: AuditResult): boolean {
  if (result.audit !== "form-e2e") return false;
  const d = result.details as FormE2eDetails | undefined;
  return !!d && typeof d.checkedAt === "string";
}

/** Extract the Airtable-writable form-e2e verdict (pass/fail/null + checked-at). */
export function formE2eResultFromAudit(result: AuditResult): FormE2eResult {
  if (result.audit !== "form-e2e") {
    throw new Error(`Expected a 'form-e2e' AuditResult, got '${result.audit}'`);
  }
  const d = result.details as FormE2eDetails | undefined;
  const ok = d?.ok === "pass" ? "pass" : d?.ok === "fail" ? "fail" : null;
  return {
    ok,
    checkedAt: typeof d?.checkedAt === "string" ? d.checkedAt : new Date().toISOString(),
  };
}
