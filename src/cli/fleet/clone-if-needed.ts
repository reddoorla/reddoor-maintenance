import { stat, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
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
  const target = join(opts.workdir, name);
  await mkdir(opts.workdir, { recursive: true });

  if (await isNonEmptyDir(target)) {
    return { ...site, name, path: target };
  }

  const spawn = opts.spawn ?? defaultSpawn;
  const result = await spawn("git", ["clone", site.repoUrl, target], {
    cwd: opts.workdir,
    timeoutMs: 5 * 60_000,
  });
  if (result.code !== 0) {
    throw new Error(`git clone failed (code ${result.code}): ${result.stderr}`);
  }
  return { ...site, name, path: target };
}
