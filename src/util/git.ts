import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import type { Site } from "../types.js";

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return exec("git", args, { cwd, env: process.env });
}

export function branchName(recipe: string, when: Date = new Date()): string {
  // ISO with millisecond precision: 2026-05-20T10:30:00.123Z → 20260520T103000123Z.
  // Millis (vs. second-precision) shrinks the collision window for parallel runs.
  const compact = when.toISOString().replace(/[-:.]/g, "");
  return `maint/${recipe}-${compact}`;
}

export async function currentBranch(cwd: string): Promise<string> {
  const { stdout } = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return stdout.trim();
}

export async function isWorkingTreeClean(cwd: string): Promise<boolean> {
  const { stdout } = await git(cwd, ["status", "--porcelain"]);
  return stdout.trim().length === 0;
}

export async function createBranch(cwd: string, name: string): Promise<void> {
  await git(cwd, ["checkout", "-b", name]);
}

/** Check out an existing branch. Throws (via git) if the branch is missing or
 *  the checkout is blocked (e.g. uncommitted changes that would be overwritten). */
export async function checkoutBranch(cwd: string, name: string): Promise<void> {
  await git(cwd, ["checkout", name]);
}

/**
 * Force-check-out an existing branch, DISCARDING any uncommitted changes on the
 * current branch. Used by the recipe failure path to return the operator to
 * their original branch even when a recipe left the work-in-progress branch
 * dirty. Only ever called with the operator's ORIGINAL branch as `name`. Does
 * not run `git clean`, so untracked operator files are left untouched.
 */
export async function forceCheckoutBranch(cwd: string, name: string): Promise<void> {
  await git(cwd, ["checkout", "-f", name]);
}

/**
 * Delete a local branch with `-D` (force). Used by the recipe failure path to
 * remove the branch the recipe itself created so a re-run starts clean. Callers
 * MUST only ever pass the recipe-created branch here, never the operator's
 * original branch.
 */
export async function deleteBranch(cwd: string, name: string): Promise<void> {
  await git(cwd, ["branch", "-D", name]);
}

export async function stageAll(cwd: string): Promise<void> {
  await git(cwd, ["add", "-A"]);
}

export async function listTrackedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await git(cwd, ["ls-files"]);
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export async function removeFromIndex(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await git(cwd, ["rm", "-r", "--cached", "--", ...paths]);
}

/**
 * The subset of `paths` that is NOT in HEAD's tree — what a fresh clone would
 * NOT get. POSITIVE evidence: a path counts as installed only when it is FOUND
 * in `git ls-tree`'s output. `git add -A` honours .gitignore and exits 0 either
 * way, so "staging did not error" proves nothing about what landed.
 *
 * `-z`, because `ls-tree` C-quotes any path outside core.quotePath's safe set
 * (`"caf\303\251.txt"`), which would read as missing. NOT `--full-tree`:
 * without it `ls-tree` reports paths relative to `cwd`, the same base the
 * caller's relative paths use.
 *
 * A git failure (no HEAD yet, not a repo) yields an EMPTY tree, so every path
 * comes back missing. An error may only ever DENY.
 */
export async function pathsMissingFromHead(
  cwd: string,
  paths: readonly string[],
): Promise<string[]> {
  if (paths.length === 0) return [];
  let inTree: Set<string>;
  try {
    const { stdout } = await git(cwd, ["ls-tree", "-r", "-z", "--name-only", "HEAD"]);
    inTree = new Set(stdout.split("\0").filter((p) => p.length > 0));
  } catch {
    inTree = new Set();
  }
  return paths.filter((p) => !inTree.has(p));
}

/**
 * Why git is excluding `paths`: `<source>:<line>:<pattern>\t<path>` rows from
 * `git check-ignore -v --no-index`. A path with no row is absent for some other
 * reason (a nested repository, say) and the caller must say so rather than
 * guess. Never throws: check-ignore exits 1 when NOTHING matches and 128 on
 * error, and both must read as "no rule found" — the caller is already
 * reporting a failure and must not lose it to a second one.
 */
export async function ignoreRulesFor(cwd: string, paths: readonly string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  let out: string;
  try {
    ({ stdout: out } = await git(cwd, ["check-ignore", "-v", "--no-index", "--", ...paths]));
  } catch (err) {
    out = (err as { stdout?: string }).stdout ?? "";
  }
  return out.split("\n").filter((l) => l.length > 0);
}

/**
 * Stages all current changes and commits with `message`. Returns the commit SHA,
 * or `null` if there was nothing to commit.
 */
export async function commit(cwd: string, message: string): Promise<string | null> {
  await stageAll(cwd);
  const { stdout: status } = await git(cwd, ["status", "--porcelain"]);
  if (status.trim().length === 0) return null;
  await git(cwd, ["commit", "-m", message]);
  const { stdout: sha } = await git(cwd, ["rev-parse", "HEAD"]);
  return sha.trim();
}

/**
 * Strict GitHub repo identity: exactly two `[A-Za-z0-9._-]` segments separated
 * by a single slash. Rejects a scheme, host, extra path segment, traversal
 * (`..`), whitespace, or an argv flag — anything that could retarget a `gh`
 * write at an unintended (attacker/typo-controlled) repo.
 */
export const OWNER_REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** True when `repo` is a clean `owner/repo` (see {@link OWNER_REPO_RE}). The
 *  explicit `..` reject covers traversal segments the char-class would otherwise
 *  admit (`.` is a legal repo char, so `../evil` matches the shape regex). */
export function isOwnerRepo(repo: string): boolean {
  if (repo.includes("..")) return false;
  return OWNER_REPO_RE.test(repo);
}

/**
 * True when two repo references name the same `owner/repo`. Each side may be a
 * full remote URL (https or scp-style), or already an `owner/repo`. Used to
 * verify an existing checkout's `origin` matches the site's expected repo
 * before reusing it. Returns false if either side is unparseable.
 */
export function sameOwnerRepo(a: string, b: string): boolean {
  const na = isOwnerRepo(a.trim()) ? a.trim() : parseOwnerRepo(a);
  const nb = isOwnerRepo(b.trim()) ? b.trim() : parseOwnerRepo(b);
  if (na === null || nb === null) return false;
  return na.toLowerCase() === nb.toLowerCase();
}

/**
 * The git remote hosts this project will derive a GitHub WRITE identity from.
 * The host is part of the identity: `https://gitlab.com/acme/site.git` names a
 * repository that exists on GitLab, and answering `acme/site` to a caller about
 * to write a repo secret on GitHub is a wrong-repo write, not a parse (#712).
 *
 * `ssh.github.com` is GitHub's documented port-443 SSH endpoint for networks
 * that block 22 — an origin real checkouts really carry; `www.github.com`
 * redirects to the apex and git follows it. Every other host resolves to
 * `null`, deliberately, so the caller refuses instead of guessing.
 */
const GITHUB_REMOTE_HOSTS = new Set(["github.com", "www.github.com", "ssh.github.com"]);

/**
 * Derive `owner/repo` from a GITHUB git remote URL (https, ssh, git:// or
 * scp-style). `null` when the remote is not a GitHub repository URL: another
 * host, a traversal segment, a nested or too-short path, a local filesystem
 * path, anything unparseable.
 *
 * PARSED, not pattern-matched (#712). The previous implementation stripped
 * `^https?://[^/]+/` — throwing the HOST away — and returned the last two path
 * segments of whatever remained, so each of these yielded a confident,
 * correctly-shaped GitHub write target for a repository the code was not in:
 * `https://gitlab.com/acme/site.git` -> `acme/site`;
 * `https://user@evil.example.com/attacker/target` -> `attacker/target`;
 * `https://github.com/ok/repo/../../evil/target` -> `evil/target`;
 * `https://github.com/ok/repo?x=/evil/other` -> `evil/other`;
 * `/Users/me/Documents/GitHub/reddoor-starter` -> `GitHub/reddoor-starter`.
 *
 * A `..` anywhere in the raw remote is REFUSED rather than resolved: `new URL`
 * (like curl, and so git-over-https) collapses `ok/repo/../../evil/target` to
 * `/evil/target`, while ssh hands the literal path to the server. The two
 * transports disagree about which repository the remote names, so neither
 * answer is proven — and `..` is already inadmissible in an identity this
 * project accepts (see {@link isOwnerRepo}).
 */
export function parseOwnerRepo(remoteUrl: string): string | null {
  const raw = remoteUrl.trim();
  if (raw.length === 0) return null;
  if (raw.includes("..")) return null;
  // scp-style `[user@]host:path` (git@github.com:owner/repo.git). The negative
  // lookahead keeps `https://…`, `ssh://…` and friends out of this branch —
  // their colon is followed by a slash.
  const scp = raw.match(/^(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9._-]+):(?!\/)(.+)$/);
  let url: URL;
  try {
    url = new URL(scp ? `ssh://${scp[1]!}/${scp[2]!}` : raw);
  } catch {
    return null; // not a URL at all — a local path, a typo, free text
  }
  if (!GITHUB_REMOTE_HOSTS.has(url.hostname.toLowerCase())) return null;
  // EXACTLY two segments. `/org/team/repo` is not a GitHub repository path, and
  // its last two name a repository that does not exist. `url.pathname` is the
  // path git resolves — a query string or fragment is not part of it.
  const segments = url.pathname
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean);
  if (segments.length !== 2) return null;
  const ownerRepo = `${segments[0]!}/${segments[1]!}`;
  // Percent-encoding and anything else outside the identity's character class
  // ends here rather than reaching a `gh` path.
  return isOwnerRepo(ownerRepo) ? ownerRepo : null;
}

/** `origin` remote URL for a checkout, trimmed. Throws (via git) if there's no origin. */
export async function getRemoteUrl(cwd: string): Promise<string> {
  const { stdout } = await git(cwd, ["remote", "get-url", "origin"]);
  return stdout.trim();
}

/** What `execFile` rejects with: `code` is git's exit status, or a string errno
 *  (`ENOENT`, `EACCES`) when the process could not be run at all. */
type GitFailure = { code?: number | string; stderr?: string };

/** No `origin` remote is configured — exit 2, `error: No such remote 'origin'`
 *  (measured, git 2.54). The one benign "nothing wired" failure. */
function isNoSuchRemote(err: unknown): boolean {
  const e = err as GitFailure;
  return e.code === 2 && /No such remote/i.test(e.stderr ?? "");
}

/** `cwd` is not inside a git work tree — exit 128, `fatal: not a git repository`
 *  (measured). Distinct from a dubious-ownership refusal, which also exits 128
 *  but says something else and is NOT benign. */
function isNotAWorkTree(err: unknown): boolean {
  const e = err as GitFailure;
  return e.code === 128 && /not a git repository/i.test(e.stderr ?? "");
}

/** Realpath'd `git rev-parse --show-toplevel` for `cwd`; `null` when `cwd` is
 *  not inside a work tree. Every OTHER git failure throws — see
 *  {@link resolveOwnerRepo} for why that distinction is load-bearing. */
async function repoToplevel(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await git(cwd, ["rev-parse", "--show-toplevel"]);
    return await realpath(stdout.trim());
  } catch (err) {
    if (isNotAWorkTree(err)) return null;
    throw err;
  }
}

/**
 * Resolve the `owner/repo` a recipe will act on, and PROVE it rather than infer
 * it. An explicit `site.gitRepo` (Airtable, or a JSON inventory) wins;
 * otherwise it is derived from the checkout's `origin`.
 *
 * Returns `null` for the two states that genuinely mean "nothing is wired
 * here": `site.path` is not inside a git work tree, and the work tree has no
 * `origin`. Everything else THROWS, naming both sides, because callers write
 * repo secrets, branch-protection rulesets and pull requests at this identity
 * — a wrong one is not cosmetic (#712):
 *
 *  - a value that is present but is not a clean `owner/repo`;
 *  - an `origin` that is not a GitHub repository URL. A GitLab or impostor host
 *    answered with a GitHub write target is the core of this class;
 *  - a `site.path` that is not the ROOT of its work tree. `git remote get-url`
 *    walks UP, so a site directory with no clone in it yet — exactly what the
 *    positional `/new-site` route points at — resolved to whatever repository
 *    happened to enclose it. Run a recipe against such a directory from under
 *    the maintenance checkout and the token secret plus a ruleset landed on
 *    `reddoorla/reddoor-maintenance`. No attacker required; a wrong `cd` was
 *    enough. The cost is that "run me from a subdirectory" now refuses instead
 *    of guessing — the refusal names the root, so the fix is one `cd`, or an
 *    explicit identity;
 *  - any git failure that is not one of the two benign shapes above. "There is
 *    no remote" and "git could not run" used to be the same answer to the
 *    caller, so `selfUpdating` printed "add an origin remote" for a missing
 *    binary, an unreadable path and a dubious-ownership refusal alike.
 *
 * Extracted from `self-updating`'s private `resolveRepo` because `prismic-ci`
 * read `site.gitRepo` directly and therefore refused every POSITIONAL run with
 * "no Git repo on this site" — `localPath()` (src/inventory/local.ts:11) builds
 * `{ path, name }` and nothing else. A site being bootstrapped is exactly the
 * case that has no Airtable row yet (`--fleet airtable` filters pre-launch
 * statuses), so the positional path is the ONLY one `/new-site` can use.
 */
export async function resolveOwnerRepo(site: Site): Promise<string | null> {
  // Trimmed: a hand-typed Airtable cell with a trailing space is a typo, not a
  // malformed identity, and a blank cell means "unset" — fall through to origin
  // rather than fail closed with an alarming refusal.
  const declared = site.gitRepo?.trim();
  if (declared) {
    if (!isOwnerRepo(declared)) {
      throw new Error(
        `refusing to act on malformed repo identity: expected "owner/repo", got ${JSON.stringify(site.gitRepo)}`,
      );
    }
    return declared;
  }

  const toplevel = await repoToplevel(site.path);
  if (toplevel === null) return null; // not a work tree — nothing here to derive from
  if ((await realpath(site.path)) !== toplevel) {
    let enclosing = "";
    try {
      const id = parseOwnerRepo(await getRemoteUrl(site.path));
      if (id !== null) enclosing = ` — ${id}`;
    } catch {
      // Naming the enclosing repository is a courtesy. Failing to name it is
      // not a reason to stop refusing.
    }
    throw new Error(
      `refusing to derive a write identity from ${JSON.stringify(site.path)}: it is not the root ` +
        `of a git repository. git walks up to the checkout at ${toplevel}${enclosing}, which is ` +
        `not the directory that was asked about — cd to the repository root, or set the repo ` +
        `identity explicitly.`,
    );
  }

  let originUrl: string;
  try {
    originUrl = await getRemoteUrl(site.path);
  } catch (err) {
    if (isNoSuchRemote(err)) return null; // the one benign "nothing wired" failure
    throw err;
  }
  const fromOrigin = parseOwnerRepo(originUrl);
  if (fromOrigin === null) {
    throw new Error(
      `could not determine a GitHub owner/repo from origin ${JSON.stringify(originUrl)} — ` +
        `expected https://github.com/<owner>/<repo>, git@github.com:<owner>/<repo> or ` +
        `ssh://git@github.com/<owner>/<repo>; refusing to guess a write identity`,
    );
  }
  return fromOrigin;
}

/** Push a branch to origin, setting upstream. Throws on non-zero (execFile rejects). */
export async function push(cwd: string, branch: string): Promise<void> {
  await git(cwd, ["push", "-u", "origin", branch]);
}
