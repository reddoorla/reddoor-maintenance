import type { AuditResult } from "../types.js";
import type { NetlifyDeployResult } from "../reports/airtable/websites.js";

type NetlifyDeployDetails = {
  state: string | null;
  deployedAt: string | null;
  logUrl: string | null;
  checkedAt: string;
};

/** True when an AuditResult is a `netlify-deploy` audit carrying a usable details
 *  payload (i.e. it actually ran — a "skip" for a site with no Netlify id / no
 *  token has no details). */
export function hasNetlifyDeployResult(result: AuditResult): boolean {
  if (result.audit !== "netlify-deploy") return false;
  const d = result.details as NetlifyDeployDetails | undefined;
  return !!d && typeof d.checkedAt === "string";
}

/** Extract the Airtable-writable deploy result (state + deployedAt + logUrl +
 *  checkedAt) from a `netlify-deploy` audit. */
export function netlifyDeployResultFromAudit(result: AuditResult): NetlifyDeployResult {
  if (result.audit !== "netlify-deploy") {
    throw new Error(`Expected a 'netlify-deploy' AuditResult, got '${result.audit}'`);
  }
  const d = result.details as NetlifyDeployDetails | undefined;
  return {
    state: typeof d?.state === "string" ? d.state : null,
    deployedAt: typeof d?.deployedAt === "string" ? d.deployedAt : null,
    logUrl: typeof d?.logUrl === "string" ? d.logUrl : null,
    checkedAt: typeof d?.checkedAt === "string" ? d.checkedAt : new Date().toISOString(),
  };
}
