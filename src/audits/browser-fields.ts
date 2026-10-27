import type { AuditResult } from "../types.js";
import type { BrowserAuditFields } from "../fleet/site-fields.js";

type BrowserDetails = {
  desktopOk: boolean;
  mobileOk: boolean;
  linksOk: boolean | null;
  reachableOk: boolean | null;
  titleMetaOk: boolean | null;
  brokenLinks: number;
  checkedAt: string;
};

/** True when an AuditResult is a `browser` audit that actually ran (has a details payload — a
 *  "skip" for a site with no deployed URL has none). */
export function hasBrowserResult(result: AuditResult): boolean {
  if (result.audit !== "browser") return false;
  const d = result.details as BrowserDetails | undefined;
  return !!d && typeof d.checkedAt === "string";
}

/** true → pass, null → not measured, anything else (false, a missing key) → fail, as before. */
function verdictOf(v: boolean | null | undefined): boolean | null {
  return v === null ? null : v === true;
}

/** Extract the writable browser verdicts from a `browser` audit. */
export function browserFieldsFromAudit(result: AuditResult): BrowserAuditFields {
  if (result.audit !== "browser") {
    throw new Error(`Expected a 'browser' AuditResult, got '${result.audit}'`);
  }
  const d = result.details as BrowserDetails | undefined;
  return {
    desktopOk: d?.desktopOk === true,
    mobileOk: d?.mobileOk === true,
    // P1-78c: null (nothing sampled) stays null, "not measured"; only a stored false is a fail.
    linksOk: verdictOf(d?.linksOk),
    reachableOk: verdictOf(d?.reachableOk),
    titleMetaOk: verdictOf(d?.titleMetaOk),
    brokenLinks: typeof d?.brokenLinks === "number" ? d.brokenLinks : 0,
    checkedAt: typeof d?.checkedAt === "string" ? d.checkedAt : new Date().toISOString(),
  };
}
