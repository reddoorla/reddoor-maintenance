import type { AuditResult, Site } from "../types.js";
import type { LighthouseScores } from "./types.js";

export type LighthouseDeps = {
  /** Runs the fleet's own Lighthouse audit against a synthetic `Site`. Swapped
   *  out in tests for a stub that never touches lhci/Chrome. */
  audit: (site: Site) => Promise<AuditResult>;
};

/** Real deps: the fleet audit's deployed-URL path (`src/audits/lighthouse.ts`)
 *  — with `deployedUrl` set it runs lhci against the live URL directly, no
 *  checkout, no dev server. Imported lazily so lhci/Chrome never load for a
 *  run that stubs this stage (or never reaches it). */
export function defaultLighthouseDeps(): LighthouseDeps {
  return {
    async audit(site) {
      const { lighthouseAudit } = await import("../audits/lighthouse.js");
      return lighthouseAudit({ site });
    },
  };
}

const CATEGORY_KEYS = {
  performance: "performance",
  accessibility: "accessibility",
  bestPractices: "best-practices",
  seo: "seo",
} as const;

/**
 * Run Lighthouse against `url` and translate the fleet audit's `AuditResult`
 * into the report's `LighthouseScores`.
 *
 * A "skip" status (npx/@lhci/cli unavailable) or every category coming back
 * null (lhci wrote no lhr-*.json — a slow or headless-hostile prospect site
 * failing all three collect runs, plausible enough on an unvetted
 * small-business site) means nothing was actually measured. Returning
 * normally in either case would let the pipeline's stage() wrapper record
 * `{ok:true, data:{...all null}}` — a report that reads as a real, blank
 * Lighthouse finding rather than "not measured". So this throws instead,
 * carrying the audit's own summary (already a sentence like "lighthouse: no
 * lhr-*.json written (exit 1)" or "npx/@lhci/cli not available"), and the
 * stage degrades to {ok:false, error} like every other isolated stage.
 *
 * A "fail" or "warn" status WITH real scores is a legitimate measured
 * result and must NOT throw — a low score is a finding, not an error.
 */
export async function runLighthouse(
  url: string,
  deps: LighthouseDeps = defaultLighthouseDeps(),
): Promise<LighthouseScores> {
  const site: Site = { path: "", name: new URL(url).hostname, deployedUrl: url };
  const result = await deps.audit(site);
  const summary = (result.details as { summary?: Record<string, number> } | undefined)?.summary;
  const score = (key: string): number | null =>
    summary && typeof summary[key] === "number" ? Math.round(summary[key] * 100) : null;

  const scores: LighthouseScores = {
    performance: score(CATEGORY_KEYS.performance),
    accessibility: score(CATEGORY_KEYS.accessibility),
    bestPractices: score(CATEGORY_KEYS.bestPractices),
    seo: score(CATEGORY_KEYS.seo),
    summary: result.summary,
    status: result.status,
  };

  const measuredNothing =
    result.status === "skip" ||
    (scores.performance === null &&
      scores.accessibility === null &&
      scores.bestPractices === null &&
      scores.seo === null);
  if (measuredNothing) throw new Error(result.summary);

  return scores;
}
