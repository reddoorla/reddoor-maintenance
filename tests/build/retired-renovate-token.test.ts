import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

/**
 * `RENOVATE_TOKEN` named the operator PAT that Renovate and the nightlies used
 * before the reddoor-renovate GitHub App took over (docs/runbooks/
 * renovate-app-identity.md, docs/runbooks/pat-retirement-2026-08.md). The PAT
 * is no longer used, and every live reader now takes the fleet token from
 * `GH_TOKEN` only.
 *
 * The name is retired rather than merely unused because it is dangerous to
 * half-keep: a reader that still falls back to it lets a stale secret quietly
 * revive the old identity, and a workflow that still passes the App token
 * under it hands the CLI NO token — which every fleet command treats as a
 * clean local-dev skip, exit 0. Both failures are silent.
 *
 * So the live surfaces — code that runs, and the workflows that run it — must
 * not name it. History (journals, dated docs, specs, CHANGELOG) is out of
 * scope by design and keeps its references.
 *
 * The ONE allowlisted file is the sync-configs compliance guard, which names
 * the retired identity precisely in order to reject it in site workflows. It is
 * pinned to an exact occurrence count, so a new reference smuggled into that
 * same file still fails here.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SCANNED = ["src", "netlify", ".github/workflows", "scripts"];
const NAME = "RENOVATE_TOKEN";
const ALLOWED: Record<string, number> = {
  "src/recipes/sync-configs/renovate-action.ts": 2,
};

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".netlify") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function occurrences(): Promise<{ scanned: number; hits: Map<string, number> }> {
  const hits = new Map<string, number>();
  let scanned = 0;
  for (const top of SCANNED) {
    for (const file of await filesUnder(join(ROOT, top))) {
      scanned++;
      // latin1: every byte maps to one char, so a stray non-UTF-8 byte can
      // never make the search silently blind (the grep-on-binary trap).
      const text = await readFile(file, "latin1");
      const count = text.split(NAME).length - 1;
      if (count > 0) hits.set(relative(ROOT, file).split("\\").join("/"), count);
    }
  }
  return { scanned, hits };
}

describe(`the retired ${NAME} name stays out of live code and workflows`, () => {
  it("scans real files, and sees the allowlisted compliance guard (positive control)", async () => {
    const { scanned, hits } = await occurrences();
    // An empty walk (wrong ROOT, renamed dir) would make the gate below pass
    // vacuously. The guard file MUST be found, with its known count.
    expect(scanned).toBeGreaterThan(100);
    for (const [file, count] of Object.entries(ALLOWED)) {
      expect(hits.get(file), file).toBe(count);
    }
  });

  it(`no file outside the allowlist names ${NAME}`, async () => {
    const { hits } = await occurrences();
    const offenders = [...hits]
      .filter(([file, count]) => ALLOWED[file] !== count)
      .map(([file, count]) => `${file} (${count})`);
    expect(offenders).toEqual([]);
  });
});
