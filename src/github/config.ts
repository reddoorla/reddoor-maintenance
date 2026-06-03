export type GitHubConfig = {
  /** Broad PAT used by the tool's own `gh` calls (PRs, branch protection, secrets). */
  token: string;
  /** Narrow PAT stored per-repo as the RENOVATE_TOKEN secret. Falls back to `token`. */
  renovateToken: string;
};

/**
 * Read GitHub config from the environment (credentials.env is loaded into process.env by the CLI).
 * Returns null when GITHUB_TOKEN is unset — the signal that git/GitHub features aren't configured.
 * RENOVATE_TOKEN falls back to GITHUB_TOKEN when unset (a narrower token is recommended but optional).
 */
export function readGitHubConfig(): GitHubConfig | null {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return null;
  const renovateToken = process.env.RENOVATE_TOKEN?.trim() || token;
  return { token, renovateToken };
}
