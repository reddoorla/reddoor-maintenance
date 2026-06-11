import type { PullRequestSummary } from "../github/gh.js";
import type { Site } from "../types.js";

/**
 * Renovate cuts branches like `renovate/npm-vite-7.x` (and `renovate-major-*`
 * for grouped majors). Match both shapes so a failing update PR is caught
 * regardless of grouping.
 */
const RENOVATE_HEAD_PREFIXES = ["renovate/", "renovate-"];

export function isRenovatePR(pr: Pick<PullRequestSummary, "headRef">): boolean {
  return RENOVATE_HEAD_PREFIXES.some((p) => pr.headRef.startsWith(p));
}

export function isFailingRenovatePR(pr: PullRequestSummary): boolean {
  return isRenovatePR(pr) && pr.ciState === "failing";
}

/** One fleet alert: a Renovate update PR that is red on CI. */
export type RenovateFailureFinding = {
  /** Human-facing site label (Airtable display name, falling back to slug). */
  site: string;
  /** `owner/repo`. */
  repo: string;
  pr: PullRequestSummary;
};

export type RenovateFailuresResult = {
  findings: RenovateFailureFinding[];
  /** Repos whose PRs could not be fetched — surfaced, never silently dropped. */
  skipped: string[];
};

/** Probe a single repo for its open PRs (injected so the sweep is testable). */
export type OpenPullRequestsProbe = (repo: string) => Promise<PullRequestSummary[]>;

function siteLabel(site: Site): string {
  const display = site.meta?.["displayName"];
  return typeof display === "string" && display.length > 0 ? display : (site.name ?? "unknown");
}

/**
 * Sweep the fleet for Renovate PRs that are failing CI. Sites without a known
 * `gitRepo` are out of scope (not errors); a repo whose probe throws is added
 * to `skipped` so a single GitHub hiccup never sinks the whole sweep or hides
 * a gap behind a clean-looking result.
 */
export async function collectRenovateFailures(
  sites: Site[],
  probe: OpenPullRequestsProbe,
): Promise<RenovateFailuresResult> {
  const findings: RenovateFailureFinding[] = [];
  const skipped: string[] = [];

  for (const site of sites) {
    const repo = site.gitRepo;
    if (!repo) continue;

    let prs: PullRequestSummary[];
    try {
      prs = await probe(repo);
    } catch {
      skipped.push(repo);
      continue;
    }

    for (const pr of prs) {
      if (isFailingRenovatePR(pr)) {
        findings.push({ site: siteLabel(site), repo, pr });
      }
    }
  }

  return { findings, skipped };
}
