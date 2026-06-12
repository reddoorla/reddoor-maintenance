import type { Site } from "../types.js";
import type { CiState, PullRequestSummary } from "../github/gh.js";
import { isFailingRenovatePR } from "../alerts/renovate.js";

/** One swept row, ready for the Airtable writer (slug-keyed by `site`). */
export type GitHubSignalsRow = {
  site: string; // the site name/slug the writer matches on
  repo: string; // owner/repo
  renovateFailingCis: number;
  ciState: CiState;
  lastCommitAt: string | null;
};

/** Injected GitHub reads (so the sweep is pure + testable). */
export type GitHubSignalsDeps = {
  openPullRequests: (repo: string) => Promise<PullRequestSummary[]>;
  defaultBranchStatus: (repo: string) => Promise<{ ciState: CiState; lastCommitAt: string | null }>;
};

/** Per repo-backed site: count its failing Renovate PRs + read its default-branch
 *  status. Sites without `gitRepo` are skipped (not errors). A repo whose probe
 *  throws is reported via `onSkip` and produces no row — one GitHub hiccup never
 *  sinks the sweep (mirrors `collectRenovateFailures`). PURE over `deps`. */
export async function collectGitHubSignals(
  sites: Site[],
  deps: GitHubSignalsDeps,
  onSkip: (s: { repo: string }) => void = () => {},
): Promise<GitHubSignalsRow[]> {
  const rows: GitHubSignalsRow[] = [];
  for (const s of sites) {
    const repo = s.gitRepo;
    if (!repo) continue;
    const name = s.name;
    if (!name) continue;
    try {
      const prs = await deps.openPullRequests(repo);
      const status = await deps.defaultBranchStatus(repo);
      rows.push({
        site: name,
        repo,
        renovateFailingCis: prs.filter(isFailingRenovatePR).length,
        ciState: status.ciState,
        lastCommitAt: status.lastCommitAt,
      });
    } catch {
      onSkip({ repo });
    }
  }
  return rows;
}
