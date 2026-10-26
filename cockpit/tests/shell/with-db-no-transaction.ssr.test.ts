import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `withDb` opens its `Db` with `concurrentReads`, which lifts Kysely's
 * connection mutex (`OpenDbOptions` in `src/db/client.ts`). A `transaction()`
 * on that `Db` would then go wrong on a local `file:`/`:memory:` client: the
 * transaction takes the client's connection away (`src/db/site-create.ts`), so
 * concurrent queries land on a fresh, for `:memory:` empty, database (#1656).
 *
 * Nothing under `withDb` opens one today; this turns the comment into a guard.
 * It walks the static and dynamic relative imports from every cockpit file that
 * calls `withDb` (the import graph, so it over-approximates what a callback can
 * reach) and fails if any reached file calls `.transaction(`.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const COCKPIT_SRC = join(REPO, "cockpit/src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const isFile = (p: string) => existsSync(p) && statSync(p).isFile();

/** A relative specifier to the file it names: `.js` written for a `.ts` source. */
function resolveSpecifier(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  const candidates = [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, join(base, "index.ts")];
  return candidates.find(isFile) ?? null;
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g;

/** Code without its comments, so a comment naming `transaction()` is no hit. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** Every file the import graph reaches from `roots`, roots included. */
function reached(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(ts|svelte)$/.test(file)) continue;
    for (const m of code(readFileSync(file, "utf8")).matchAll(SPECIFIER)) {
      const spec = m[1]!;
      // Assets, and SvelteKit's generated route types (types only, no code).
      if (/\.(css|json|svg|png)$/.test(spec) || /\/\$types$/.test(spec)) continue;
      const target = resolveSpecifier(file, spec);
      if (target === null) {
        throw new Error(`unresolved import ${spec} in ${relative(REPO, file)}`);
      }
      queue.push(target);
    }
  }
  return seen;
}

const opensTransaction = (file: string) =>
  /\.transaction\s*\(/.test(code(readFileSync(file, "utf8")));

const withDbCallers = walk(COCKPIT_SRC).filter(
  (f) =>
    /\.(ts|svelte)$/.test(f) && /\bwithDb\s*(<[^>]*>)?\s*\(/.test(code(readFileSync(f, "utf8"))),
);

describe("nothing under withDb opens a transaction on the concurrentReads Db (#1656)", () => {
  it("finds the withDb callers and walks into the shared src/ code they reach", () => {
    const rel = withDbCallers.map((f) => relative(REPO, f));
    expect(rel).toContain("cockpit/src/routes/+layout.server.ts");
    expect(rel).toContain("cockpit/src/routes/submissions/+page.server.ts");
    const all = [...reached(withDbCallers)].map((f) => relative(REPO, f));
    expect(all).toContain("src/db/client.ts");
  });

  it("the scan flags a file that opens a transaction (src/db/site-create.ts)", () => {
    const hits = [...reached([join(REPO, "src/db/site-create.ts")])].filter(opensTransaction);
    expect(hits.map((f) => relative(REPO, f))).toContain("src/db/site-create.ts");
  });

  it("no file reached from a withDb caller calls .transaction(", () => {
    const hits = [...reached(withDbCallers)].filter(opensTransaction);
    expect(hits.map((f) => relative(REPO, f))).toEqual([]);
  });
});
