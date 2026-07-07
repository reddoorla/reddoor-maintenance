import type { AuditResult } from "../types.js";
import type { BrowserAuditFields } from "../reports/airtable/websites.js";

type BrowserDetails = {
  desktopOk: boolean;
  mobileOk: boolean;
  linksOk: boolean;
  reachableOk: boolean;
  titleMetaOk: boolean;
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

/** Extract the Airtable-writable browser verdicts from a `browser` audit. */
export function browserFieldsFromAudit(result: AuditResult): BrowserAuditFields {
  if (result.audit !== "browser") {
    throw new Error(`Expected a 'browser' AuditResult, got '${result.audit}'`);
  }
  const d = result.details as BrowserDetails | undefined;
  return {
    desktopOk: d?.desktopOk === true,
    mobileOk: d?.mobileOk === true,
    linksOk: d?.linksOk === true,
    reachableOk: d?.reachableOk === true,
    titleMetaOk: d?.titleMetaOk === true,
    brokenLinks: typeof d?.brokenLinks === "number" ? d.brokenLinks : 0,
    checkedAt: typeof d?.checkedAt === "string" ? d.checkedAt : new Date().toISOString(),
  };
}
