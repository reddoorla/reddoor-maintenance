import { execFileSync } from "node:child_process";

export type GitHubConfig = {
  /** Broad PAT used by the tool's own `gh` calls (PRs, branch protection, secrets). */
  token: string;
  /** Narrow PAT stored per-repo as the RENOVATE_TOKEN secret. Falls back to `token`. */
  renovateToken: string;
};

/** The shape of `node:child_process`'s `execFileSync` that `ghAuthToken` needs —
 *  injectable so a test never shells out (and never depends on the runner's
 *  own keyring). */
export type ExecFileSyncFn = (
  cmd: string,
  args: readonly string[],
  opts: {
    env: NodeJS.ProcessEnv;
    encoding: "utf8";
    stdio: ["ignore", "pipe", "ignore"];
    timeout: number;
  },
) => string;

const defaultExecFileSync: ExecFileSyncFn = (cmd, args, opts) => execFileSync(cmd, [...args], opts);

/**
 * The token `gh` itself is logged in with (`gh auth token`), or null when `gh`
 * is missing, not logged in, or prints nothing. #665.
 *
 * Two traps, both from the issue:
 *
 * - `gh auth token` ECHOES `$GITHUB_TOKEN` / `$GH_TOKEN` back when either is
 *   set, so the child runs with both stripped. Without that a dead file token
 *   makes the good keyring token look dead as well — which is exactly how the
 *   original failure was misdiagnosed once.
 * - The token is NOT validated by pinging an endpoint. A fine-grained token can
 *   be refused by `/user` and still be fully working for the calls it is scoped
 *   to; "validating" it there would declare working tokens dead.
 *
 * stderr is discarded (gh prints its "not logged in" hint there) and the call
 * is bounded so a wedged keychain prompt cannot hang a recipe.
 */
export function ghAuthToken(exec: ExecFileSyncFn = defaultExecFileSync): string | null {
  const { GITHUB_TOKEN: _github, GH_TOKEN: _gh, ...env } = process.env;
  void _github;
  void _gh;
  try {
    const out = exec("gh", ["auth", "token"], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Read GitHub config from the environment (credentials.env is loaded into process.env by the CLI).
 *
 * `GITHUB_TOKEN` wins when set; when it is unset or blank the token comes from
 * `gh auth token` — the keyring `gh auth login` populated — so `GITHUB_TOKEN`
 * may be left OUT of `credentials.env` entirely, and should be: `gh.ts` hands
 * this token to `gh` as `GH_TOKEN`, so a set-but-dead file value actively
 * overrides a working keyring credential, and a file COPY of the keyring token
 * goes stale on the next `gh auth login/refresh/logout` (#665). Returns null
 * only when neither source has a token — the signal that git/GitHub features
 * aren't configured.
 *
 * `RENOVATE_TOKEN` falls back to the resolved token when unset (a narrower token
 * is recommended but optional).
 */
export function readGitHubConfig(
  opts: { execFileSync?: ExecFileSyncFn } = {},
): GitHubConfig | null {
  const token = process.env.GITHUB_TOKEN?.trim() || ghAuthToken(opts.execFileSync);
  if (!token) return null;
  const renovateToken = process.env.RENOVATE_TOKEN?.trim() || token;
  return { token, renovateToken };
}
