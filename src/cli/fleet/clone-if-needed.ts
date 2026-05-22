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

export async function cloneIfNeeded(site: Site, opts: CloneIfNeededOptions): Promise<Site> {
  if (await isNonEmptyDir(site.path)) return site;

  if (!site.repoUrl) {
    throw new Error(`site path does not exist (${site.path}) and no repoUrl is set — cannot clone`);
  }

  const name = site.name ?? deriveNameFromRepoUrl(site.repoUrl);
  assertSafeName(name);
  assertSafeRepoUrl(site.repoUrl);
  const target = join(opts.workdir, name);
  await mkdir(opts.workdir, { recursive: true });

  if (await isNonEmptyDir(target)) {
    return { ...site, name, path: target };
  }

  const spawn = opts.spawn ?? defaultSpawn;
  // `--` separator so git won't treat repoUrl as a flag if validation slips.
  const result = await spawn("git", ["clone", "--", site.repoUrl, target], {
    cwd: opts.workdir,
    timeoutMs: 5 * 60_000,
  });
  if (result.code !== 0) {
    throw new Error(`git clone failed (code ${result.code}): ${result.stderr}`);
  }
  return { ...site, name, path: target };
}
