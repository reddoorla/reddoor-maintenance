import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

// #539 Phase 6, step 1 (#646): the Turso store must not need the Airtable layer
// at RUNTIME. `src/db/fleet-state.ts` used to value-import `canonicalizeStatus`,
// `parseNotifyRouting`, `toVerdict` & co. from `src/reports/airtable/`, and those
// run inside `rowFromJoined` on every lead read — so deleting that directory
// (step 6) would have broken Turso-only reads. The helpers now live outside it
// (`src/fleet/site-status.ts`, `src/fleet/site-row.ts`, `src/reports/report-row.ts`).
//
// A TYPE import is fine: it is erased at build time and cannot break a read. What
// this pins is the runtime edge.

const ROOT = resolve(__dirname, "../..");
const AIRTABLE_DIR = join(ROOT, "src/reports/airtable") + "/";

/** The src/db files Phase 6 step 6 deletes outright. They are ABOUT Airtable,
 *  so they may keep talking to it until they go. Everything else in src/db may not. */
const DOOMED_WITH_THE_LAYER = new Set(["import-airtable.ts", "sync.ts", "parity.ts"]);

/** Runtime (non-erased) module specifiers of a TS source: value imports,
 *  re-exports, and dynamic `import("…")`. An import is erased when it is
 *  `import type`, or when every named binding is `type`-qualified and there is
 *  no default/namespace binding (isolatedModules + esbuild drop it). */
export function runtimeSpecifiers(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const erased =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined &&
            clause.namedBindings !== undefined &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every((e) => e.isTypeOnly)));
      if (!erased) out.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const erased =
        node.isTypeOnly ||
        (node.exportClause !== undefined &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length > 0 &&
          node.exportClause.elements.every((e) => e.isTypeOnly));
      if (!erased) out.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Resolve a relative NodeNext specifier (`./x.js`) to the .ts source on disk. */
function resolveRelative(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.mjs$/, ".mts"),
    base,
    `${base}.ts`,
    join(base, "index.ts"),
  ];
  return candidates.find((c) => existsSync(c) && c.endsWith("ts")) ?? null;
}

function runtimeClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of runtimeSpecifiers(file, readFileSync(file, "utf-8"))) {
      const target = resolveRelative(file, spec);
      if (target !== null) stack.push(target);
    }
  }
  return seen;
}

describe("the instrument classifies imports correctly (controls)", () => {
  // Prove the scanner can see what it is meant to see before trusting a green.
  const src = [
    `import { a } from "../reports/airtable/value.js";`,
    `import type { B } from "../reports/airtable/type-only.js";`,
    `import { type C } from "../reports/airtable/inline-type-only.js";`,
    `import { type D, e } from "../reports/airtable/mixed.js";`,
    `import * as ns from "../reports/airtable/namespace.js";`,
    `export { f } from "../reports/airtable/reexport.js";`,
    `export type { G } from "../reports/airtable/type-reexport.js";`,
    `const h = () => import("../reports/airtable/dynamic.js");`,
  ].join("\n");

  it("flags value, mixed, namespace, re-export and dynamic imports; ignores erased ones", () => {
    expect(runtimeSpecifiers("control.ts", src)).toEqual([
      "../reports/airtable/value.js",
      "../reports/airtable/mixed.js",
      "../reports/airtable/namespace.js",
      "../reports/airtable/reexport.js",
      "../reports/airtable/dynamic.js",
    ]);
  });

  it("resolves a real runtime closure (fleet-state reaches its own schema-adjacent modules)", () => {
    const closure = runtimeClosure(join(ROOT, "src/db/fleet-state.ts"));
    // A closure of one file would make the airtable assertion below vacuous.
    expect(closure.has(join(ROOT, "src/reports/checklist.ts"))).toBe(true);
  });
});

describe("src/db has no runtime dependency on src/reports/airtable/ (#646 step 1)", () => {
  const dbDir = join(ROOT, "src/db");
  const files = readdirSync(dbDir).filter((f) => f.endsWith(".ts"));

  it("every surviving src/db module has no value import from the Airtable layer", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (DOOMED_WITH_THE_LAYER.has(f)) continue;
      const file = join(dbDir, f);
      for (const spec of runtimeSpecifiers(file, readFileSync(file, "utf-8"))) {
        const target = resolveRelative(file, spec);
        if (target !== null && target.startsWith(AIRTABLE_DIR)) {
          offenders.push(`src/db/${f} → ${relative(ROOT, target)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the lead-read module's whole runtime import closure stays out of the Airtable layer", () => {
    const reached = [...runtimeClosure(join(ROOT, "src/db/fleet-state.ts"))]
      .filter((f) => f.startsWith(AIRTABLE_DIR))
      .map((f) => relative(ROOT, f));
    expect(reached).toEqual([]);
  });
});
