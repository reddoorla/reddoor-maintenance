import { stat, readdir, mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Site } from "../../types.js";
import { defaultSpawn, type SpawnFn } from "../../audits/util/spawn.js";

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
  if (await isNonEmptyDir(site.path)) return site;

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
    return { ...site, name, path: target };
  }

  const spawn = opts.spawn ?? defaultSpawn;
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
