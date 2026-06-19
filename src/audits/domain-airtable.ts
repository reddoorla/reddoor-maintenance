import type { AuditResult } from "../types.js";
import type { DomainResult } from "../reports/airtable/websites.js";

type DomainDetails = { resolved: boolean; certDaysRemaining: number | null; checkedAt: string };

/** True when an AuditResult is a `domain` audit carrying a usable details payload (i.e. it
 *  actually ran — a "skip" for a site with no deployed URL has no details). */
export function hasDomainResult(result: AuditResult): boolean {
  if (result.audit !== "domain") return false;
  const d = result.details as DomainDetails | undefined;
  return !!d && typeof d.checkedAt === "string";
}

/** Extract the Airtable-writable domain result (cert days + checked-at) from a `domain` audit. */
export function domainResultFromAudit(result: AuditResult): DomainResult {
  if (result.audit !== "domain") {
    throw new Error(`Expected a 'domain' AuditResult, got '${result.audit}'`);
  }
  const d = result.details as DomainDetails | undefined;
  return {
    certDaysRemaining: typeof d?.certDaysRemaining === "number" ? d.certDaysRemaining : null,
    checkedAt: typeof d?.checkedAt === "string" ? d.checkedAt : new Date().toISOString(),
  };
}
