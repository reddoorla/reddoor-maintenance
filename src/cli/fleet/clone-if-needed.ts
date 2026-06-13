import { stat, readdir, mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Site } from "../../types.js";
import { defaultSpawn, type SpawnFn } from "../../audits/util/spawn.js";
import { sameOwnerRepo } from "../../util/git.js";

export type CloneIfNeededOptions = {
  workdir: string;
  spawn?: SpawnFn;
};

function deriveNameFromRepoUrl(repoUrl: string): string {
  const slash = repoUrl.split("/").pop() ?? repoUrl;
  return slash.replace(/\.git$/, "");
}

/** Reject names that would let an inventory entry write outside `workdir`. */
function assertSafeName(name: string): void {
  if (isAbsolute(name)) {
    throw new Error(`unsafe site name (absolute path not allowed): ${name}`);
  }
  if (name.includes("/") || name.includes("\\")) {
    throw new Error(`unsafe site name (path separator not allowed): ${name}`);
  }
  if (name.split(/[\\/]/).some((seg) => seg === "..")) {
    throw new Error(`unsafe site name (traversal segment not allowed): ${name}`);
  }
}

/**
 * Reject repo URLs that don't look like a normal clone target. Without this,
 * a `repoUrl` starting with `-` would be interpreted by git as a flag
 * (CVE-2017-1000117 family) — e.g. `--upload-pack=…` allows arbitrary command
 * execution. Inventory files are usually trusted, but `.mjs`/`.js` inventories
 * could pull from environments or external sources, so harden the boundary.
 *
 * Accepts: `https://`, `http://`, `ssh://`, `git://`, `file://`, and
 * `[user@]host:path` shorthand (e.g. `git@github.com:org/repo.git`).
 */
function assertSafeRepoUrl(repoUrl: string): void {
  if (
    !/^(https?|ssh|git|file):\/\//.test(repoUrl) &&
    !/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:/.test(repoUrl)
  ) {
    throw new Error(
      `unsafe repoUrl: must start with a scheme (https://, ssh://, git://, file://) ` +
        `or use scp-style "user@host:path" (got: ${JSON.stringify(repoUrl)})`,
    );
  }
}

async function isNonEmptyDir(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    if (!s.isDirectory()) return false;
    const entries = await readdir(path);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * The repo identity (`owner/repo` or a clone URL) the site is *expected* to be.
 * `gitRepo` (Airtable's `owner/repo`) is canonical; fall back to `repoUrl`.
 * `undefined` when the inventory carries neither — there's nothing to verify
 * against, so a reused checkout can't be checked (we keep current behavior).
 */
function expectedRepoRef(site: Site): string | undefined {
  return site.gitRepo ?? site.repoUrl ?? undefined;
}

/**
 * Verify an existing checkout at `path` is the SAME repo as the site expects.
 * The `siteSlug` that derives the path is lossy (distinct site names can
 * collapse to one slug → one path), so without this a fleet run could read,
 * audit, or commit against the WRONG repo's working tree.
 *
 * Reads `git -C <path> remote get-url origin` (via the injected spawn so tests
 * can fake it) and compares `owner/repo` on both sides, normalizing scheme,
 * host, `.git`, and case. Throws on a mismatch — never silently proceeds.
 * No-ops when the site carries no expected identity, or the dir isn't a git
 * checkout (no origin) — those are handled by the normal clone path.
 */
async function assertCheckoutMatches(site: Site, path: string, spawn: SpawnFn): Promise<void> {
  const expected = expectedRepoRef(site);
  if (!expected) return; // nothing to verify against

  const r = await spawn("git", ["-C", path, "remote", "get-url", "origin"], {
    timeoutMs: 30_000,
  });
  // Not a git checkout / no origin remote → can't verify; let the clone path
  // (or the caller) deal with a non-repo directory rather than guessing.
  if (r.code !== 0) return;
  const origin = r.stdout.trim();
  if (origin.length === 0) return;

  if (!sameOwnerRepo(origin, expected)) {
    throw new Error(
      `checkout at ${path} is the wrong repo: origin is ${JSON.stringify(origin)} ` +
        `but site expects ${JSON.stringify(expected)} (slug collision?) — refusing to reuse it`,
    );
  }
}

/** GitHub repo identity `owner/repo`: exactly two `[\w.-]` segments. Constrained
 *  so it can't smuggle a scheme, host, extra path segment, traversal, or an argv
 *  flag into the derived clone URL below. */
const GIT_REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/**
 * Resolve the URL to clone from. An explicit `repoUrl` wins; otherwise derive
 * one from `gitRepo` (`owner/repo` → `https://github.com/owner/repo.git`). The
 * Airtable inventory deliberately sets `gitRepo` and NOT `repoUrl` (a clone
 * source must never be the production `url`), so without this derivation every
 * checkout-based fleet recipe throws on the first site with an empty workdir.
 *
 * Returns `undefined` when neither is set; throws on a malformed `gitRepo`.
 */
function resolveCloneUrl(site: Site): string | undefined {
  if (site.repoUrl) return site.repoUrl;
  if (!site.gitRepo) return undefined;
  if (!GIT_REPO_RE.test(site.gitRepo)) {
    throw new Error(`unsafe gitRepo: expected "owner/repo" (got: ${JSON.stringify(site.gitRepo)})`);
  }
  return `https://github.com/${site.gitRepo}.git`;
}

export async function cloneIfNeeded(site: Site, opts: CloneIfNeededOptions): Promise<Site> {
  const spawn = opts.spawn ?? defaultSpawn;

  if (await isNonEmptyDir(site.path)) {
    // Reusing an existing checkout: confirm it's actually this site's repo
    // before any audit/recipe operates on it (slug collisions can point two
    // sites at the same path). Throws on mismatch.
    await assertCheckoutMatches(site, site.path, spawn);
    return site;
  }

  const repoUrl = resolveCloneUrl(site);
  if (!repoUrl) {
    throw new Error(
      `site path does not exist (${site.path}) and no repoUrl or gitRepo is set — cannot clone`,
    );
  }

  const name = site.name ?? deriveNameFromRepoUrl(repoUrl);
  assertSafeName(name);
  assertSafeRepoUrl(repoUrl);
  const target = join(opts.workdir, name);
  await mkdir(opts.workdir, { recursive: true });

  if (await isNonEmptyDir(target)) {
    // Same guard for the workdir/<name> reuse path.
    await assertCheckoutMatches(site, target, spawn);
    return { ...site, name, path: target };
  }

  // `--` separator so git won't treat repoUrl as a flag if validation slips.
  const result = await spawn("git", ["clone", "--", repoUrl, target], {
    cwd: opts.workdir,
    timeoutMs: 5 * 60_000,
  });
  if (result.code !== 0) {
    throw new Error(`git clone failed (code ${result.code}): ${result.stderr}`);
  }
  return { ...site, name, path: target };
}
