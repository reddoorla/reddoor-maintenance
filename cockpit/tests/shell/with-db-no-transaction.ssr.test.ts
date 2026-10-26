import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * `withDb` opens its `Db` with `concurrentReads`, which lifts Kysely's
 * connection mutex (`OpenDbOptions` in `src/db/client.ts`). A `transaction()`
 * on that `Db` would then go wrong on a local `file:`/`:memory:` client: the
 * transaction takes the client's connection away (`src/db/site-create.ts`), so
 * concurrent queries land on a fresh, for `:memory:` empty, database (#1656).
 *
 * Nothing under `withDb` opens one today; this turns the comment into a guard.
 * It walks the static and dynamic imports from every cockpit file that calls
 * `withDb` (the import graph, so it over-approximates what a callback can
 * reach) and fails if any reached file calls `.transaction(`. Files are read
 * with TypeScript's parser, not regexes, so comments and strings are never
 * mistaken for code or the other way round (review round 1 of #1738: a `/*`
 * inside a `//` comment hid the code after it).
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

/** The script a file runs: a `.svelte` file's `<script>` blocks, else the file. */
function scriptOf(file: string, text: string): string {
  if (!file.endsWith(".svelte")) return text;
  return [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
}

const read = (file: string) => scriptOf(file, readFileSync(file, "utf8"));

const parse = (text: string) =>
  ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** Every module specifier the code imports or re-exports, statically or dynamically. */
function importsIn(text: string): string[] {
  return ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName);
}

/** Whether the code calls `<callee>(…)` where the callee matches. */
function calls(text: string, match: (callee: ts.Expression) => boolean): boolean {
  let hit = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && match(node.expression)) hit = true;
    if (!hit) ts.forEachChild(node, visit);
  };
  visit(parse(text));
  return hit;
}

/** Whether the code calls `<anything>.transaction(…)`. */
const callsTransaction = (text: string) =>
  calls(text, (c) => ts.isPropertyAccessExpression(c) && c.name.text === "transaction");

/** A specifier to the file it names (`.js` written for a `.ts` source, `$lib`
 *  as SvelteKit maps it); `"package"` for a package or a SvelteKit runtime
 *  module; `"skip"` for an asset or generated route types; `null` for anything
 *  else, which the walk refuses rather than skip silently. */
function resolveSpecifier(from: string, spec: string): string | "package" | "skip" | null {
  if (/\.(css|json|svg|png)$/.test(spec) || /(^|\/)\$types$/.test(spec)) return "skip";
  let base: string;
  if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(from), spec);
  else if (spec === "$lib" || spec.startsWith("$lib/"))
    base = join(COCKPIT_SRC, "lib", spec.slice("$lib".length));
  else if (/^\$(app|env)\//.test(spec)) return "package";
  else if (/^(node:)?[a-z0-9][\w.-]*(\/|$)/i.test(spec) || /^@[\w.-]+\/[\w.-]+/.test(spec))
    return "package";
  else return null;
  const candidates = [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, join(base, "index.ts")];
  return candidates.find(isFile) ?? null;
}

/** Every file the import graph reaches from `roots`, roots included. */
function reached(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(ts|svelte)$/.test(file)) continue;
    for (const spec of importsIn(read(file))) {
      const target = resolveSpecifier(file, spec);
      if (target === null) {
        throw new Error(`unresolved import ${spec} in ${relative(REPO, file)}`);
      }
      if (target !== "package" && target !== "skip") queue.push(target);
    }
  }
  return seen;
}

const opensTransaction = (file: string) => callsTransaction(read(file));

const withDbCallers = walk(COCKPIT_SRC).filter(
  (f) =>
    /\.(ts|svelte)$/.test(f) && calls(read(f), (c) => ts.isIdentifier(c) && c.text === "withDb"),
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

  // Review round 1 (#1738): a `/*` inside a line comment opened a fake block
  // that swallowed real code (src/alerts/attention.ts:5 hid its import).
  it("reads code after a line comment holding `/*`, and ignores comments and strings", () => {
    const text = [
      "// see `src/alerts/*`), then",
      'import type { T } from "../reports/types.js";',
      'import { x } from "$lib/x.js";',
      "export const t = (db: { transaction(): unknown }) => db.transaction();",
      "/* end */",
    ].join("\n");
    expect(importsIn(text)).toEqual(["../reports/types.js", "$lib/x.js"]);
    expect(callsTransaction(text)).toBe(true);
    const quiet = [
      "// db.transaction() in a comment",
      "/* db.transaction() in a block */",
      'const s = "db.transaction()";',
      "const u = `${s} db.transaction()`;",
    ].join("\n");
    expect(callsTransaction(quiet)).toBe(false);
  });

  it("follows the import in the real file that comment sits in (src/alerts/attention.ts)", () => {
    const deps = [...reached([join(REPO, "src/alerts/attention.ts")])].map((f) =>
      relative(REPO, f),
    );
    expect(deps).toContain("src/reports/types.ts");
  });

  it("refuses a specifier it cannot place, and passes packages", () => {
    const from = join(COCKPIT_SRC, "routes/+layout.server.ts");
    for (const spec of ["@/lib/x.js", "~/x", "/abs/x.js", "$alias/x", "./missing.js"]) {
      expect(resolveSpecifier(from, spec), spec).toBeNull();
    }
    for (const spec of ["@sveltejs/kit", "svelte/store", "node:fs", "$app/navigation", "$env/x"]) {
      expect(resolveSpecifier(from, spec), spec).toBe("package");
    }
    expect(resolveSpecifier(from, "$lib/server/db.js")).toBe(join(COCKPIT_SRC, "lib/server/db.ts"));
  });
});
