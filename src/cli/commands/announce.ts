import { announce, type AnnounceResult, type AnnounceSiteResult } from "../../recipes/announce.js";

export type AnnounceCommandOptions = {
  cwd?: string;
};

function formatSiteResult(r: AnnounceSiteResult): string {
  if (r.status === "skipped-no-scores") return `[${r.site}] skipped-no-scores`;
  if (r.status === "error") return `[${r.site}] error: ${r.message}`;
  const note = r.recipientMissing ? " ⚠ recipient missing" : "";
  return `[${r.site}] ${r.status}${note}`;
}

export function formatAnnounceResult(result: AnnounceResult): string {
  if (result.results.length === 0) return "No maintenance sites to announce.";
  return result.results.map(formatSiteResult).join("\n");
}

/**
 * `announce [site]` — Airtable-driven and fleet-wide. Draft the monthly-report
 * announcement email for every `maintenance` site (or one, when `site` is given) into
 * the M3 approve queue. Never sends; the operator approves each draft and the next send
 * run delivers it. Reads the Lighthouse scores already stored on each Websites row —
 * no audits are run.
 */
export async function runAnnounceCommand(
  site: string | undefined,
  _opts: AnnounceCommandOptions,
): Promise<{ output: string; code: number }> {
  const result = await announce(site ? { site } : {});
  const hadError = result.results.some((r) => r.status === "error");
  return { output: formatAnnounceResult(result), code: hadError ? 1 : 0 };
}
