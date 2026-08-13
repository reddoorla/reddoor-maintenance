import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import * as models from "../../../src/prismic/models/index.js";

describe("prismic/models public surface", () => {
  it("exports the comparison core, the adapters, and the push", () => {
    expect(Object.keys(models).sort()).toEqual(
      [
        "CUSTOM_TYPES_API",
        "canon",
        "describeDiff",
        "diffModels",
        "localModels",
        "modelFilePath",
        "prismicTokenEnvName",
        "pushModels",
        "readPrismicConfig",
        "remoteModels",
        "resolvePrismicToken",
        "sameModel",
        "sendModel",
        "withRemoteScreenshots",
        "writeModelFile",
      ].sort(),
    );
  });

  // Tripwire. The Types API can delete (verified 204, zero residue), and the
  // single most important safety property in this design is that our code
  // cannot. If someone adds one, this test forces the conversation.
  //
  // NAME-BASED ALONE IS NOT A GUARD. The identical assertion in remote.test.ts
  // was proven insufficient by mutation on 2026-08-12: a reviewer wired a
  // complete, working DELETE into `sendModel` — an extra action in the union
  // plus `method: action === "delete" ? "DELETE" : "POST"` — and the whole suite
  // went green, tsc clean, with the test named "has no delete function at all"
  // reporting PASS. Inspecting exported NAMES cannot see a capability added
  // inside a function that already exists, which is exactly how it would really
  // arrive, because the writing function is already sitting there.
  //
  // So this surface check covers the export-shaped case only, and the capability
  // guard below covers everything else. Both are needed; neither is redundant
  // with the other. Do not delete either as duplicative.
  it("exports no delete capability", () => {
    expect(
      Object.keys(models).some((k) => /delete|remove|destroy|purge|drop|unregister/i.test(k)),
    ).toBe(false);
  });
});

/**
 * THE MODULE-WIDE CAPABILITY GUARD.
 *
 * It runs over EVERY file in `src/prismic/models/`, and it is the only copy.
 * The per-file guards that used to live in `push.test.ts` ("pushModels reaches
 * Prismic only through the injected send") and `write.test.ts` ("write.ts
 * channels") are now pointers to this one: two guards with a seam between them
 * is the shape that failed here twice, and the second one to be written is
 * always the one that never gets updated.
 *
 * ── WHY IT LOOKS LIKE THIS ──────────────────────────────────────────────────
 *
 * The no-delete guard has failed FOUR times in this project, each fix closing
 * exactly the channel the previous one missed:
 *
 *  1. An exported-NAME check (remote.test.ts). Blind to a working DELETE added
 *     INLINE inside `sendModel`. The suite went green with the test named "has
 *     no delete function at all" reporting PASS.
 *  2. A quoted-verb + STATIC-import check. Blind to
 *     `const { request } = await import("node:https")`. `await import()` is this
 *     codebase's dominant lazy-load idiom — 63 call sites across 12 files under
 *     `src/`, 26 of them in `src/cli/bin.ts` — so it was the likeliest channel
 *     on the list, not an exotic one.
 *  3. An AST allow-list over `push.ts` ALONE. Correct as far as it went, and it
 *     survived 12 attack shapes, but it left ONE hop: `./diff.js` is
 *     allow-listed, so IO added inside `diff.ts` and reached through
 *     `withRemoteScreenshots` looked clean from `push.ts`, and `diff.ts` had no
 *     guard of its own.
 *  4. An AST allow-list over SPECIFIERS. Defeated by
 *     `const { rm } = await import("node:fs/promises")` — a working recursive
 *     delete inside the very module that exists because remote-only models may
 *     never be deleted. The specifier walk DID see the dynamic import and
 *     recorded `"node:fs/promises"`, which is ALREADY ALLOWED (this module
 *     legitimately needs mkdir/readFile/writeFile), so `new Set(...)` deduped it
 *     away; the bindings walk only inspected `ts.isImportDeclaration`, so it
 *     never saw `rm`. Both assertions reported PASS.
 *
 * Two lessons, and every line below is one of them:
 *
 *  • ALLOW-LIST, NEVER DENY-LIST. The first three fixes each enumerated
 *    forbidden channels, and a new channel always existed. Enumerate what is
 *    ALLOWED instead, over the whole directory at once, so there is no seam
 *    between two guards and no unguarded file to hop to.
 *  • ALLOW-LISTING THE SOURCE IS NOT ALLOW-LISTING THE CAPABILITY.
 *    `node:fs/promises` must stay allowed, so a specifier allow-list can never
 *    express "may write files, may not delete them". The allow-list has to be
 *    over the BINDINGS actually obtained, by every mechanism — destructuring a
 *    dynamic import, member access on a namespace import, aliasing — and a
 *    binding the walk cannot statically resolve must FAIL, never be skipped.
 *
 * PARSED WITH THE AST, NOT REGEXED, and that is load-bearing rather than
 * stylistic. A guard like this has to QUOTE the constructs it forbids in order
 * to explain itself — the paragraphs above say `await import("node:https")` and
 * `rm` out loud — and an earlier draft had already dropped a `request\(` check
 * because it tripped over its own prose. `remote.ts`'s header legitimately
 * contains `DELETE /customtypes/{id}`: that sentence is the REASON this rule
 * exists, and a text ban would have failed on the commit that introduced it.
 * Syntax nodes cannot see inside a comment.
 *
 * ── THE HONEST LIMIT — READ THIS BEFORE CITING THE GUARD ─────────────────────
 *
 * A source-local guard can only see capabilities the source NAMES. A capability
 * handed in as a PARAMETER is invisible to it. `push.ts` already takes `send`
 * that way and `write.ts` takes `spawn`; a future `deps: { rm }` would pass
 * every assertion below while carrying a delete straight into the module. The
 * `spawn` sentinel below is the loudest single version of that class, not a
 * closure of it.
 *
 * So the claim this guard makes is exactly:
 *
 *     NO FILE IN THIS MODULE ACQUIRES A DELETE CAPABILITY.
 *
 * It is NOT "no delete can occur". What bounds the rest is the injection sites —
 * the CLI command and the tests, both in this repo and both reviewable. Do not
 * let a comment anywhere upgrade the claim: an overstated guarantee is how the
 * previous four versions of this guard got trusted past what they proved.
 *
 * ── PROVEN BY MUTATION ──────────────────────────────────────────────────────
 *
 * 2026-08-13. 31 attacks, 31 caught; 4 controls, 4 green.
 *
 * A MUTATION HARNESS CAN LIE, AND IT LIES TOWARD SUCCESS: the "17 of 17 caught"
 * report in this project was worthless because `--reporter=basic` does not exist
 * in vitest 4, so vitest exited before running anything and "the test failed"
 * and "the test never ran" produced the same observation. So each run here was
 * gated on FIVE things: `git diff --stat` (or `git status` for a created file)
 * proving the mutation reached disk; the process EXIT CODE; a `Tests …` summary
 * line existing at all; that summary reporting the expected total of tests
 * actually RUN; and the SPECIFIC NAMED test appearing in the FAIL list. Three
 * meta-controls confirmed the harness could still say no: a no-op comment edit
 * declared as an attack was reported ESCAPED, a mutation that changed nothing
 * was reported INVALID, and a real attack declared against the wrong test name
 * was reported ESCAPED rather than counted.
 *
 * The attacks: `const { rm } = await import("node:fs/promises")` (failure 4's
 * exact shape); `rm` added to the static import; `import * as fs from "node:fs"`
 * + `fs.promises.rm(…)`; `const fsp = await import("node:fs/promises")` +
 * `fsp.rm(…)`, in diff.ts; a `createRequire` route; a bare side-effect
 * `import "node:child_process"`; `import cp = require(…)`; `export * from
 * "node:fs/promises"` in index.ts; a specifier built by concatenation; a
 * specifier read from a variable; `new Function(…)`; `new (Function.constructor
 * as never)(…)`; `(0, eval)("…")`; `globalThis.fetch`; `globalThis["fe"+"tch"]`;
 * `process.binding("fs")`; `(await import(…)).rm`; `import(…).then(({ rm }) =>
 * …)`; `const { ["r" + "m"]: del } = await import(…)`; `const { mkdir: _m,
 * ...rest } = await import(…)`; `spawn("rm", ["-rf", …])`; a DELETE request in
 * remote.ts; `method: action === "delete" ? "DELETE" : "POST"` (failure 1's
 * exact shape); a delete-shaped name added to the public surface; `export * as
 * remote from "./remote.js"`; a whole new file `models/cleanup.ts` importing
 * `rm`; the same as `models/cleanup.mjs`; the same one directory down at
 * `models/util/nuke.ts`; a new file that acquires NOTHING (still undeclared,
 * still fails); and `readFile` taken by `push.ts` and by `diff.ts` — permitted
 * for the module, refused for the pure core, which is the property the retired
 * push.ts guard used to hold.
 *
 * Four CONTROLS must stay GREEN and do: an extra import of an already-allowed
 * BINDING (`dirname` into local.ts), an ordinary local-variable rename in
 * push.ts, a comment-only edit that writes `DELETE /customtypes/{id}` into a
 * file other than remote.ts, and an added type-only import between two core
 * files. A guard that fires on honest edits gets deleted by the next person in
 * a hurry, and then there is no guard at all.
 *
 * NOTE ON THE `typescript` IMPORT. It is already a devDependency used by
 * `pnpm typecheck`. This is the one test in the repo that imports it, and that
 * is deliberately a single module-wide precedent — which is precisely why this
 * lives in ONE test over the whole directory instead of three copies.
 */
describe("the module-wide capability guard", () => {
  const MODULE_DIR = new URL("../../../src/prismic/models/", import.meta.url);

  /** Extensions this guard knows how to PARSE. Anything else in the directory
   *  fails: `models/cleanup.mjs` would otherwise be a file the guard never
   *  looked at, which is failure 3 (the unguarded hop) wearing a new suffix. If
   *  a file that genuinely cannot carry code lands here — a README — add its
   *  extension to this list deliberately, and say why. */
  const PARSEABLE = [".ts"];

  /** Every file this guard expects to find, asserted EXACTLY. A new file in this
   *  directory is a new place for a capability to live, so it arrives with a
   *  line here and the review that implies — including one nested a directory
   *  down, which the collector below reaches. */
  const MODULE_FILES = [
    // the pure comparison core
    "canon.ts",
    "diff.ts",
    "push.ts",
    "token.ts",
    "types.ts",
    // the public surface
    "index.ts",
    // the adapters — the only files that touch the world
    "config.ts",
    "local.ts",
    "remote.ts",
    "write.ts",
  ];

  /**
   * THE PURE CORE IS CLOSED: these files may name ONLY each other. Not
   * `node:fs/promises`, not `node:path`, nothing outside this list — which is to
   * say they acquire no capability at all, not even a permitted one.
   *
   * This is the assertion retired from `push.test.ts` when that guard was folded
   * in here, and it is NOT redundant with the module-wide lists below. Those
   * lists are a UNION over the directory — `node:fs/promises` is on them because
   * `write.ts` genuinely needs it — so without this, `push.ts` could take
   * `writeFile` and pass every one of them. `pushModels` receives `send` as an
   * INJECTED dependency, so it needs no IO of its own AT ALL, and that is a
   * property worth keeping rather than a coincidence of today's imports.
   *
   * `diff.ts` is in here for the reason failure 3 exists: `push.ts` may name
   * `./diff.js`, so IO added inside `diff.ts` and reached through
   * `withRemoteScreenshots` would look clean from `push.ts`. A closed core
   * removes that hop by construction rather than by a second guard.
   *
   * Stated as closure rather than as a per-file list on purpose: a per-file list
   * is a place to quietly add one more specifier, and "the core names only the
   * core" is a sentence a reviewer can check against the table above in one
   * pass. It also stays green for the honest edit — one core file taking a type
   * from another — which is how a guard survives contact with a hurry.
   */
  const PURE_CORE = ["canon.ts", "diff.ts", "push.ts", "token.ts", "types.ts"];

  /**
   * THE CAPABILITY ALLOW-LIST: every module this directory may name, and what
   * each of them may HAND IT. One table, not two — the module list is derived
   * from these keys below, so a specifier can never be permitted in one place
   * and forgotten in the other. This is the assertion failure 4 proves cannot be
   * skipped: the specifier half alone can never say "may write, may not delete",
   * because the module genuinely needs `node:fs/promises`.
   *
   * A specifier with an EMPTY list may be named but must yield nothing at
   * runtime — it is imported type-only, and types are erased.
   */
  const ALLOWED_BINDINGS: Record<string, string[]> = {
    // Read, create, replace, and atomically move into place. What is refused is
    // any verb that REMOVES a path — rm, rmdir, unlink, truncate — because a
    // pull-down is the SAFE answer to a remote-only model, and the module that
    // answers it must not grow the ability the whole design forbids. `rename` is
    // the one verb here that can move bytes out from under a name, and it earns
    // its place: it is what makes the same-id refresh atomic, and it is only
    // ever called with a temp file this module just created as its source.
    //
    // This list is the UNION over the three adapters that read and write files
    // (config, local, write), and the union is deliberate: it means an adapter
    // taking a read verb another adapter already has is an ordinary edit rather
    // than a guard failure, which is what keeps this test from being deleted by
    // someone in a hurry. It costs the per-file precision of the retired
    // `write.ts` guard (write.ts could add `readdir` unnoticed) and buys nothing
    // back for delete, because no removing verb is on it at all. The files that
    // must acquire NOTHING are pinned separately, and exactly, in PURE_CORE.
    "node:fs/promises": [
      "lstat",
      "mkdir",
      "readFile",
      "readdir",
      "realpath",
      "rename",
      "stat",
      "writeFile",
    ],
    "node:path": ["dirname", "join", "posix", "relative", "sep"],
    // The intra-module edges, which double as a pin on the public surface:
    // `export { deleteModel } from "./remote.js"` fails here.
    "./canon.js": ["canon", "sameModel"],
    "./config.js": ["readPrismicConfig"],
    "./diff.js": ["describeDiff", "diffModels", "withRemoteScreenshots"],
    "./local.js": ["localModels"],
    "./push.js": ["pushModels"],
    "./remote.js": ["CUSTOM_TYPES_API", "remoteModels", "sendModel"],
    "./token.js": ["prismicTokenEnvName", "resolvePrismicToken"],
    "./write.js": ["modelFilePath", "writeModelFile"],
    "./types.js": [], // type-only, erased at runtime
    "../../audits/util/spawn.js": [], // type-only, erased at runtime
    "../../recipes/_prettier.js": ["formatWithPrettier"],
  };

  /** Derived, never maintained by hand: a channel exists exactly when the table
   *  above says what may come through it. */
  const ALLOWED_SPECIFIERS = Object.keys(ALLOWED_BINDINGS);

  /**
   * Ambient names any file here may reference. Requirement (d): this is stated
   * over FREE IDENTIFIERS — every name a file uses but does not itself declare —
   * and NOT over the roots of call chains. That distinction was earned:
   * `(0, eval)("…")` has a parenthesised comma expression as its callee, so a
   * root-of-chain walk sees no root at all and waves it through. A free
   * identifier has no such syntax-shaped hole: a name that is not declared here
   * and not on a list below fails however it is later spelled, called, aliased,
   * destructured or parenthesised.
   *
   * Everything here is INERT — pure data and control constructors that reach no
   * file, socket or subprocess, plus names that exist only in type space and are
   * erased before anything runs. `Function`, `eval`, `globalThis`, `process`,
   * `require`, `Buffer`, `Reflect` and `WebAssembly` are conspicuously absent,
   * and that absence is the point.
   */
  const INERT_AMBIENT = [
    "Array",
    "Boolean",
    "Error",
    "JSON",
    "Map",
    "Object",
    "Promise",
    "Set",
    "String",
    "undefined",
    // Type space only — erased by tsc, cannot carry a capability.
    "NodeJS", // NodeJS.ErrnoException
    "Partial",
    "Pick",
    "Record",
    // `as const`: the parser reports the assertion's type as a reference to an
    // identifier literally named `const`. A parse artefact, not a global.
    "const",
  ];

  /** Ambient names ONE file may reference, because it is the file whose job
   *  needs them. `fetch` lives here and nowhere else: `remote.ts` is the only
   *  file allowed to talk to the network at all. */
  const PER_FILE_AMBIENT: Record<string, string[]> = {
    "remote.ts": ["AbortSignal", "RequestInit", "Response", "fetch"],
  };

  /** Recorded in place of a module specifier the guard cannot reduce to a
   *  literal. `import(someVar)` must FAIL the allow-list, not vanish from it:
   *  "this guard cannot tell" is a failure, never a pass. */
  const UNRESOLVED_SPECIFIER = "<a module specifier this guard cannot resolve to a literal>";

  /** Case-INSENSITIVE on purpose: `fetch` uppercases the method itself, so
   *  `method: "delete"` is a real DELETE and `"DELETE"` is not the only
   *  spelling that reaches Prismic. */
  const VERB = /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/i;

  type Binding = { specifier: string; binding: string };
  type Extract = {
    file: string;
    specifiers: string[];
    bindings: Binding[];
    /** Spans of every construct the node walk recognised as naming a module —
     *  used by the independent token census. */
    spans: Array<{ start: number; end: number }>;
    importTokens: Array<{ text: string; line: number; pos: number }>;
    freeIdentifiers: string[];
    /** EVERY identifier the file contains, in any role — declarations included.
     *  Free-identifier resolution deliberately cannot see a name that is
     *  declared before it is used, so the `fetch` pin below reads this instead. */
    identifiers: string[];
    identifierCount: number;
    verbs: string[];
    methodValues: string[];
    directSpawnCalls: number;
  };

  /** Collect every file in the directory, recursively — a capability added in
   *  `models/util/nuke.ts` is a capability added to this module. */
  const files: Array<{ name: string; url: URL }> = [];
  const unparseable: string[] = [];
  const collect = (dir: URL, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.isDirectory()) {
        collect(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
        continue;
      }
      if (PARSEABLE.some((ext) => entry.name.endsWith(ext)))
        files.push({ name: `${prefix}${entry.name}`, url: new URL(entry.name, dir) });
      else unparseable.push(`${prefix}${entry.name}`);
    }
  };
  collect(MODULE_DIR, "");

  /**
   * Strip everything that changes only how an expression READS, never what it
   * IS: parentheses, a comma sequence's discarded left half, and the type
   * assertions (`as never`, `satisfies`, `!`, `<T>`) that an evasion needs in
   * order to get past `pnpm typecheck` in the first place. `(0, eval)` and
   * `(Function.constructor as never)` both reduce to what they really are.
   *
   * Found by mutation on the write.ts predecessor: without the assertion cases,
   * `new (Function.constructor as never)("…")` walked straight through.
   */
  const unwrap = (n: ts.Expression): ts.Expression => {
    let cur = n;
    for (;;) {
      if (ts.isParenthesizedExpression(cur)) cur = cur.expression;
      else if (ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression;
      else if (ts.isNonNullExpression(cur) || ts.isTypeAssertionExpression(cur))
        cur = cur.expression;
      else if (ts.isBinaryExpression(cur) && cur.operatorToken.kind === ts.SyntaxKind.CommaToken)
        cur = cur.right;
      else return cur;
    }
  };

  /** True for any call that hands back a whole module object. */
  const isModuleGetter = (n: ts.CallExpression): boolean => {
    const callee = unwrap(n.expression);
    if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;
    if (ts.isIdentifier(callee))
      return callee.text === "require" || callee.text === "createRequire";
    // process.getBuiltinModule("node:fs") and the legacy process.binding("fs").
    if (ts.isPropertyAccessExpression(callee))
      return callee.name.text === "getBuiltinModule" || callee.name.text === "binding";
    return false;
  };

  const literalSpecifier = (n: ts.Node | undefined): string =>
    n !== undefined && ts.isStringLiteralLike(n) ? n.text : UNRESOLVED_SPECIFIER;

  const extract = (file: string, source: string): Extract => {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const out: Extract = {
      file,
      specifiers: [],
      bindings: [],
      spans: [],
      importTokens: [],
      freeIdentifiers: [],
      identifiers: [],
      identifierCount: 0,
      verbs: [],
      methodValues: [],
      directSpawnCalls: 0,
    };
    /** Names that stand for a WHOLE module object — namespace import, default
     *  import of a CJS builtin, `import x = require()`, `const m = await
     *  import()`. Their uses are resolved in a second pass, because the
     *  capability is whatever comes off them. */
    const namespaces = new Map<string, { specifier: string; decl: ts.Node; uses: number }>();

    const each = (visit: (n: ts.Node) => void): void => {
      const walk = (n: ts.Node): void => {
        visit(n);
        ts.forEachChild(n, walk);
      };
      walk(sf);
    };

    const addSpan = (n: ts.Node): void =>
      void out.spans.push({ start: n.getStart(sf), end: n.getEnd() });
    const bind = (specifier: string, binding: string): void =>
      void out.bindings.push({ specifier, binding });

    /** `unwrap` over any node, not just a typed expression: every guard it uses
     *  is a kind test, so a key or an argument goes through it unharmed. */
    const unwrapNode = (n: ts.Node): ts.Node => unwrap(n as ts.Expression);

    /** The string a node reduces to STATICALLY, or `null` when it does not.
     *  `"POST"` and `` `POST` `` reduce; `` `${x}POST` ``, `verb`, `a + b` and
     *  `cond ? x : y` do not, and "does not" is a FAILURE below, never a skip. */
    const literalText = (n: ts.Node | undefined): string | null => {
      if (n === undefined) return null;
      const e = unwrapNode(n);
      return ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : null;
    };

    /**
     * Record ONE value that can reach a request `method`.
     *
     * Stated as an allow-list over VALUES, which is the whole of F1: the guard
     * does not enumerate the syntaxes an author might use to smuggle a verb in
     * (`init.method = x`, `{ ["method"]: x }`, `Object.defineProperty`, a
     * template, a variable) — it collects every write it can see and demands
     * that each one reduce statically to the literal `"POST"`. Anything it
     * cannot reduce is recorded as a sentence no allow-list contains, so "this
     * guard cannot tell" fails exactly like "this is a DELETE".
     */
    const recordMethod = (value: ts.Node | undefined, how: string): void => {
      const lit = literalText(value);
      if (lit !== null) {
        out.methodValues.push(lit);
        return;
      }
      const kind = value === undefined ? "not visible here" : ts.SyntaxKind[unwrapNode(value).kind];
      out.methodValues.push(`<a method ${how}, ${kind}: this guard cannot reduce it to a literal>`);
    };

    /** A property name as the string it really is, or `null` when the guard
     *  cannot reduce it — a computed key over anything but a string literal, or
     *  a private name. `null` is a FAILURE: `{ [k]: "delete" }` must not pass by
     *  being unreadable. */
    const literalKey = (name: ts.PropertyName): string | null => {
      if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name))
        return name.text;
      if (ts.isComputedPropertyName(name)) return literalText(name.expression);
      return null;
    };

    /** Where a dynamically obtained module object ENDS UP. Anything this cannot
     *  follow is recorded as a sentinel that no allow-list can contain. */
    const recordDynamicBinding = (call: ts.CallExpression, specifier: string): void => {
      // `await import(…)` — step over the await to reach the real consumer.
      const value: ts.Node = ts.isAwaitExpression(call.parent) ? call.parent : call;
      const parent = value.parent;
      if (ts.isVariableDeclaration(parent) && parent.initializer === value) {
        const name = parent.name;
        if (ts.isIdentifier(name)) {
          namespaces.set(name.text, { specifier, decl: name, uses: 0 });
          return;
        }
        if (ts.isObjectBindingPattern(name)) {
          for (const el of name.elements) {
            if (el.dotDotDotToken !== undefined) {
              bind(specifier, "<a rest element over a whole module object>");
              continue;
            }
            const key = el.propertyName ?? el.name;
            bind(
              specifier,
              ts.isIdentifier(key) || ts.isStringLiteralLike(key)
                ? key.text
                : "<a computed key destructured off a module object>",
            );
          }
          return;
        }
        bind(specifier, "<a module object bound by an array pattern>");
        return;
      }
      // `(await import(…)).rm` — one property off the module object.
      if (ts.isPropertyAccessExpression(parent) && parent.expression === value) {
        bind(specifier, parent.name.text);
        return;
      }
      // `.then(({ rm }) => …)`, passed as an argument, assigned to a property,
      // returned — all real ways to take a module somewhere this cannot follow.
      bind(specifier, "<a module object obtained in a shape this guard cannot follow>");
    };

    each((n) => {
      // ── (a) every module specifier, by every mechanism ──────────────────
      if (ts.isImportDeclaration(n)) {
        addSpan(n);
        const specifier = literalSpecifier(n.moduleSpecifier);
        out.specifiers.push(specifier);
        const clause = n.importClause;
        // `import type { X }` is erased before anything runs; it cannot carry a
        // capability. The SPECIFIER is still recorded above.
        if (clause !== undefined && !clause.isTypeOnly) {
          // A default import of a CJS builtin (`import fs from "node:fs"`) and a
          // namespace import both hand over the whole module under one name.
          if (clause.name)
            namespaces.set(clause.name.text, { specifier, decl: clause.name, uses: 0 });
          const bound = clause.namedBindings;
          if (bound && ts.isNamespaceImport(bound))
            namespaces.set(bound.name.text, { specifier, decl: bound.name, uses: 0 });
          if (bound && ts.isNamedImports(bound))
            for (const el of bound.elements)
              // `import { rm as keep }` records `rm`: the capability, not the alias.
              if (!el.isTypeOnly) bind(specifier, (el.propertyName ?? el.name).text);
        }
        return;
      }
      if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
        // `export … from "x"` is an import channel too: it evaluates the module
        // AND re-exposes what it names.
        addSpan(n);
        const specifier = literalSpecifier(n.moduleSpecifier);
        out.specifiers.push(specifier);
        if (n.isTypeOnly) return;
        const clause = n.exportClause;
        if (clause === undefined) {
          bind(specifier, "<export * — every export of the module, whatever they become>");
          return;
        }
        if (ts.isNamespaceExport(clause)) {
          bind(specifier, "<export * as ns — the whole module object, re-exported>");
          return;
        }
        for (const el of clause.elements)
          if (!el.isTypeOnly) bind(specifier, (el.propertyName ?? el.name).text);
        return;
      }
      if (ts.isImportEqualsDeclaration(n)) {
        addSpan(n);
        const specifier = ts.isExternalModuleReference(n.moduleReference)
          ? literalSpecifier(n.moduleReference.expression)
          : UNRESOLVED_SPECIFIER;
        out.specifiers.push(specifier);
        namespaces.set(n.name.text, { specifier, decl: n.name, uses: 0 });
        return;
      }
      if (ts.isImportTypeNode(n)) {
        // `typeof import("x")` / `import("x").Foo` — type space, erased.
        addSpan(n);
        out.specifiers.push(
          ts.isLiteralTypeNode(n.argument)
            ? literalSpecifier(n.argument.literal)
            : UNRESOLVED_SPECIFIER,
        );
        return;
      }
      if (ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword) {
        // `import.meta` names no module, but it IS a channel — `import.meta.url`
        // is half of the `createRequire` idiom and `import.meta.resolve` is the
        // other half. No file here needs it, so it fails as an unlisted
        // specifier rather than passing as nothing.
        addSpan(n);
        out.specifiers.push("<import.meta>");
        return;
      }
      if (ts.isCallExpression(n)) {
        if (isModuleGetter(n)) {
          addSpan(n);
          const specifier = literalSpecifier(n.arguments[0]);
          out.specifiers.push(specifier);
          recordDynamicBinding(n, specifier);
        }
        // The loudest single hole this guard does NOT close: `spawn` arrives as
        // a PARAMETER, and `spawn("rm", ["-rf", …])` reaches every verb the
        // allow-list refuses without naming a module. `write.ts` never calls it
        // directly — it hands it to `formatWithPrettier` — so requiring that
        // stays honest and makes any future direct use a conversation rather
        // than a silent capability.
        const callee = unwrap(n.expression);
        if (ts.isIdentifier(callee) && callee.text === "spawn") out.directSpawnCalls += 1;
      }
      // ── (e) HTTP verbs and request methods ──────────────────────────────
      // CASE-INSENSITIVE, and over template PARTS as well as string literals.
      // `fetch` byte-uppercases the method before it goes on the wire, so
      // `"delete"` is a real DELETE; and `` `${""}DELETE` `` puts the verb in a
      // TemplateTail, which `isStringLiteralLike` does not cover. Both escaped
      // the 2026-08-13 red team.
      const literalLike =
        ts.isStringLiteralLike(n) ||
        n.kind === ts.SyntaxKind.TemplateHead ||
        n.kind === ts.SyntaxKind.TemplateMiddle ||
        n.kind === ts.SyntaxKind.TemplateTail;
      if (literalLike && VERB.test((n as ts.LiteralLikeNode).text))
        out.verbs.push((n as ts.LiteralLikeNode).text);

      // Every construct that can WRITE a request method. Reads are deliberately
      // not collected — `init.method ?? "GET"` in remote.ts's error path is a
      // read and must stay green — so this is keyed on assignment position.
      if (ts.isPropertyAssignment(n)) {
        const key = literalKey(n.name);
        // An unreadable key MIGHT be "method"; that is a failure, not a skip.
        if (key === null) recordMethod(undefined, "under a key this guard cannot read");
        else if (key === "method") recordMethod(n.initializer, "in an object literal");
      }
      if (ts.isShorthandPropertyAssignment(n) && n.name.text === "method")
        recordMethod(undefined, "as a shorthand property, whose value is elsewhere");
      // `init.method = …`, `init["method"] = …`, and every compound form of
      // both. A compound operator (`+=`, `??=`) never yields the RHS, so its
      // value is unreducible by construction.
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        const lhs = unwrapNode(n.left);
        const target = ts.isPropertyAccessExpression(lhs)
          ? lhs.name.text
          : ts.isElementAccessExpression(lhs)
            ? // A computed target might BE "method": unreadable is a failure.
              (literalText(lhs.argumentExpression) ?? "method")
            : null;
        if (target === "method")
          recordMethod(
            n.operatorToken.kind === ts.SyntaxKind.EqualsToken ? n.right : undefined,
            "assigned onto an existing object",
          );
      }
      // `Object.defineProperty(init, "method", …)`, `Reflect.set(init, "method",
      // …)`, or any other call handed the property NAME as a literal. The guard
      // does not model what these calls do; carrying that string into a call is
      // enough to fail.
      if (ts.isCallExpression(n) && n.arguments.some((a) => literalText(a) === "method"))
        recordMethod(undefined, "passed as a property name to a call");
    });

    // ── second pass: every USE of a name that stands for a whole module ────
    each((n) => {
      if (!ts.isIdentifier(n)) return;
      const ns = namespaces.get(n.text);
      if (ns === undefined || ns.decl === n) return;
      ns.uses += 1;
      const p = n.parent;
      // `fs.rm(…)` resolves to `rm`. `fs["r" + "m"]`, `fs` handed to a function,
      // `{ ...fs }` — none of those do.
      if (ts.isPropertyAccessExpression(p) && p.expression === n) bind(ns.specifier, p.name.text);
      else bind(ns.specifier, `<an unresolvable use of the module object bound to "${n.text}">`);
    });
    for (const [name, ns] of namespaces)
      if (ns.uses === 0)
        // Acquiring every verb and using none is still acquiring every verb.
        bind(ns.specifier, `<the whole module object, bound to "${name}" and never resolved>`);

    // ── (b) the independent token census ──────────────────────────────────
    // Deliberately NOT the node walk: the walk enumerates node kinds and can
    // therefore be incomplete, so anything it missed shows up here as a token
    // sitting inside no recognised construct. A hole in the extractor must fail
    // AS a hole, not pass as a clean file.
    const IMPORTY = new Set(["import", "require", "createRequire"]);
    const eachToken = (n: ts.Node): void => {
      const kids = n.getChildren(sf);
      if (kids.length > 0) {
        for (const c of kids) eachToken(c);
        return;
      }
      const text = n.getText(sf);
      if (!IMPORTY.has(text)) return;
      const pos = n.getStart(sf);
      out.importTokens.push({ text, pos, line: sf.getLineAndCharacterOfPosition(pos).line + 1 });
    };
    eachToken(sf);

    /** Whether this identifier is a NAME rather than a use of one — `e.status`'s
     *  `status`, a declaration's own name, an object key. Shorthand is checked
     *  first because `{ fetch }` genuinely IS a reference to `fetch`, and the
     *  catch-all below would otherwise read it as a key. */
    const isName = (n: ts.Identifier): boolean => {
      const p: ts.Node | undefined = n.parent;
      if (!p) return true;
      if (ts.isShorthandPropertyAssignment(p)) return false;
      if (ts.isPropertyAccessExpression(p)) return p.name === n;
      if (ts.isQualifiedName(p)) return p.right === n;
      if (ts.isBindingElement(p) && p.propertyName === n) return true;
      if ((ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) && p.propertyName === n) return true;
      return "name" in p && (p as { name?: ts.Node }).name === n;
    };
    /**
     * ── (d) FREE IDENTIFIERS, RESOLVED PER SCOPE ──────────────────────────
     *
     * The set of declared names used to be FILE-WIDE, and that was an unlock
     * rather than a hole: ONE parameter named `fetch`, anywhere in a file, put
     * that string into the set and unfiltered EVERY use of the global `fetch`
     * in that file — including inside the pure core. It arrives on an
     * honest-looking edit, because `fetch?: typeof fetch` is this repo's own DI
     * idiom (`src/forms/{client,turnstile,mailchimp,webhook,endpoint,action}.ts`
     * all take it that way), and combined with the method axis above it put a
     * Types-API DELETE inside `write.ts` in the 2026-08-13 red team. The same
     * unlock existed for `process`, `globalThis`, `Function` and `Reflect`.
     *
     * So a name is resolved against the scopes that actually ENCLOSE its use: a
     * stack over the source file, blocks, every function-like construct, catch
     * clauses, the three `for` forms, classes and the type-parameter carriers,
     * with `var` and function declarations hoisted to the nearest FUNCTION
     * scope rather than the block they were written in. A use is free only when
     * no enclosing scope declares it.
     *
     * References are collected with the scope they sit in and resolved AFTER
     * the walk, so a name declared later in a scope still resolves for a use
     * earlier in it — which is what hoisting and mutual recursion need.
     *
     * WHAT THIS DOES NOT DO: it shrinks the blast radius of an injected name
     * from the whole file to the one function that takes it. It does not close
     * the injected-capability class — inside that function the parameter still
     * shadows the global and the guard cannot see what the caller passed. See
     * the header.
     */
    type Scope = { parent: Scope | null; fn: boolean; names: Set<string> };
    const fileScope: Scope = { parent: null, fn: true, names: new Set() };
    /** Where `var` and function declarations land: the nearest FUNCTION scope,
     *  never the block they were written in. */
    const hoistTarget = (s: Scope): Scope => (s.fn ? s : hoistTarget(s.parent ?? fileScope));
    const declareIn = (scope: Scope, name: ts.Node | undefined): void => {
      if (name === undefined) return;
      if (ts.isIdentifier(name)) {
        scope.names.add(name.text);
        return;
      }
      if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name))
        for (const el of name.elements) if (ts.isBindingElement(el)) declareIn(scope, el.name);
    };
    const isFunctionLike = (n: ts.Node): boolean =>
      ts.isFunctionDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isConstructorDeclaration(n) ||
      ts.isGetAccessorDeclaration(n) ||
      ts.isSetAccessorDeclaration(n) ||
      ts.isFunctionTypeNode(n) ||
      ts.isConstructorTypeNode(n) ||
      ts.isMethodSignature(n) ||
      ts.isCallSignatureDeclaration(n) ||
      ts.isConstructSignatureDeclaration(n);
    /** Every construct that introduces a lexical scope. Anything not listed
     *  here shares its parent's scope, which is the conservative direction: a
     *  declaration then reads as VISIBLE too widely, so a use resolves rather
     *  than being reported free — the mistake this list can make is a false
     *  PASS on a shadowed name, never a false failure on honest code. Blocks
     *  and the `for` forms are listed precisely because `let`/`const` in them
     *  are not visible outside. */
    const opensScope = (n: ts.Node): boolean =>
      isFunctionLike(n) ||
      ts.isBlock(n) ||
      ts.isModuleBlock(n) ||
      ts.isCaseBlock(n) ||
      ts.isCatchClause(n) ||
      ts.isForStatement(n) ||
      ts.isForInStatement(n) ||
      ts.isForOfStatement(n) ||
      ts.isClassDeclaration(n) ||
      ts.isClassExpression(n) ||
      ts.isTypeAliasDeclaration(n) ||
      ts.isInterfaceDeclaration(n) ||
      ts.isConditionalTypeNode(n) ||
      ts.isMappedTypeNode(n);

    const refs: Array<{ name: string; scope: Scope }> = [];
    const identifiers = new Set<string>();
    const walkScoped = (n: ts.Node, outer: Scope): void => {
      // 1. What this node declares in the scope it SITS IN.
      if (ts.isVariableDeclaration(n)) {
        const list = n.parent;
        const blockScoped =
          ts.isVariableDeclarationList(list) &&
          (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0;
        declareIn(blockScoped ? outer : hoistTarget(outer), n.name);
      } else if (ts.isFunctionDeclaration(n)) declareIn(hoistTarget(outer), n.name);
      else if (
        ts.isClassDeclaration(n) ||
        ts.isTypeAliasDeclaration(n) ||
        ts.isInterfaceDeclaration(n) ||
        ts.isEnumDeclaration(n) ||
        ts.isModuleDeclaration(n)
      )
        declareIn(outer, n.name);
      else if (ts.isImportClause(n)) {
        declareIn(fileScope, n.name);
        const bound = n.namedBindings;
        if (bound && ts.isNamespaceImport(bound)) fileScope.names.add(bound.name.text);
        if (bound && ts.isNamedImports(bound))
          for (const el of bound.elements) fileScope.names.add(el.name.text);
      } else if (ts.isImportEqualsDeclaration(n)) declareIn(fileScope, n.name);

      // 2. The scope this node OPENS, and what belongs to that scope: its
      //    parameters, its type parameters, a catch binding, and the name a
      //    class or function expression gives itself.
      const inner: Scope = opensScope(n)
        ? { parent: outer, fn: isFunctionLike(n), names: new Set() }
        : outer;
      if (ts.isCatchClause(n)) declareIn(inner, n.variableDeclaration?.name);
      if (ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isFunctionExpression(n))
        declareIn(inner, n.name);
      for (const p of (n as { parameters?: readonly ts.ParameterDeclaration[] }).parameters ?? [])
        declareIn(inner, p.name);
      for (const t of (n as { typeParameters?: readonly ts.TypeParameterDeclaration[] })
        .typeParameters ?? [])
        declareIn(inner, t.name);
      if (ts.isMappedTypeNode(n)) declareIn(inner, n.typeParameter.name);
      if (ts.isInferTypeNode(n)) declareIn(outer, n.typeParameter.name);

      // 3. Uses.
      if (ts.isIdentifier(n)) {
        out.identifierCount += 1;
        identifiers.add(n.text);
        if (!isName(n)) refs.push({ name: n.text, scope: outer });
      }

      ts.forEachChild(n, (c) => walkScoped(c, inner));
    };
    walkScoped(sf, fileScope);

    const resolves = (name: string, scope: Scope): boolean => {
      for (let s: Scope | null = scope; s !== null; s = s.parent)
        if (s.names.has(name)) return true;
      return false;
    };
    out.freeIdentifiers = [
      ...new Set(refs.filter((r) => !resolves(r.name, r.scope)).map((r) => r.name)),
    ].sort();
    out.identifiers = [...identifiers].sort();

    return out;
  };

  const extracted = files.map(({ name, url }) => extract(name, readFileSync(url, "utf-8")));

  // ── (c) FAIL CLOSED ─────────────────────────────────────────────────────
  // A walk that silently stopped matching — a TypeScript upgrade renaming a node
  // predicate, a refactor moving the imports, a directory read that returned
  // nothing — would otherwise report empty sets, and an empty set trivially
  // satisfies every allow-list below. A guard that examines nothing is worse
  // than no guard, because it also stops anyone from writing a real one.
  it("examines every file in the module, and fails closed if it examined nothing", () => {
    // Every file in the directory is one this guard PARSED. A capability added
    // in `models/cleanup.mjs` must not be a capability nobody looked at.
    expect(unparseable).toEqual([]);
    // …and every file it parsed is one somebody declared. `models/cleanup.ts`
    // and `models/util/nuke.ts` both fail here before any allow-list runs.
    expect(files.map((f) => f.name).sort()).toEqual([...MODULE_FILES].sort());
    expect(files.length).toBeGreaterThan(0);
    expect(extracted.flatMap((e) => e.specifiers).length).toBeGreaterThan(0);
    expect(extracted.flatMap((e) => e.bindings).length).toBeGreaterThan(0);
    expect(extracted.flatMap((e) => e.importTokens).length).toBeGreaterThan(0);
    expect(extracted.reduce((n, e) => n + e.identifierCount, 0)).toBeGreaterThan(0);
    // Each individual file was really parsed, not silently skipped.
    for (const e of extracted) expect(`${e.file}: ${e.identifierCount}`).not.toBe(`${e.file}: 0`);
  });

  it("names only the modules on its allow-list, by ANY mechanism", () => {
    const offending = extracted.flatMap((e) =>
      e.specifiers.filter((s) => !ALLOWED_SPECIFIERS.includes(s)).map((s) => `${e.file}: ${s}`),
    );
    expect([...new Set(offending)].sort()).toEqual([]);
  });

  // The property retired from push.test.ts, kept because the module-wide lists
  // are a union and a union cannot express it. See PURE_CORE above.
  it("keeps the comparison core pure — it names nothing outside itself", () => {
    // A rename would otherwise turn this rule into a rule about nothing.
    expect(PURE_CORE.filter((f) => !files.some((seen) => seen.name === f))).toEqual([]);
    /** `"./canon.js"` -> `"canon.ts"`. Anything that is not a sibling `.js`
     *  specifier — a bare package, a `node:` builtin, a parent directory, an
     *  unresolvable sentinel — resolves to nothing and fails. */
    const sibling = (specifier: string): string | null => {
      const m = /^\.\/([^/]+)\.js$/.exec(specifier);
      return m?.[1] === undefined ? null : `${m[1]}.ts`;
    };
    const offending = extracted
      .filter((e) => PURE_CORE.includes(e.file))
      .flatMap((e) =>
        e.specifiers
          .filter((s) => {
            const target = sibling(s);
            return target === null || !PURE_CORE.includes(target);
          })
          .map((s) => `${e.file}: ${s}`),
      );
    expect([...new Set(offending)].sort()).toEqual([]);
  });

  it("leaves no import or require token unaccounted for by the extractor", () => {
    const unaccounted = extracted.flatMap((e) =>
      e.importTokens
        .filter((t) => !e.spans.some((s) => t.pos >= s.start && t.pos < s.end))
        .map((t) => `${e.file}:${t.line} ${t.text}`),
    );
    expect(unaccounted).toEqual([]);
  });

  // THE ASSERTION FAILURE 4 EXISTS FOR. `node:fs/promises` stays allowed above;
  // what it may YIELD is what this pins.
  it("grants no file in the module any capability beyond its allow-list", () => {
    const offending = extracted.flatMap((e) =>
      e.bindings
        .filter((b) => !(ALLOWED_BINDINGS[b.specifier] ?? []).includes(b.binding))
        .map((b) => `${e.file}: ${b.specifier} → ${b.binding}`),
    );
    expect([...new Set(offending)].sort()).toEqual([]);
  });

  it("references no ambient name outside the inert set — and only remote.ts may name fetch", () => {
    const offending = extracted.flatMap((e) => {
      const allowed = new Set([...INERT_AMBIENT, ...(PER_FILE_AMBIENT[e.file] ?? [])]);
      return e.freeIdentifiers.filter((f) => !allowed.has(f)).map((f) => `${e.file}: ${f}`);
    });
    expect(offending.sort()).toEqual([]);
  });

  /**
   * The companion to per-scope resolution, and honestly a NAME PIN rather than a
   * capability rule: `fetch` may not appear in any file but `remote.ts`, in ANY
   * role — as a parameter, a property, a type, a local, anything.
   *
   * It exists because scope resolution alone cannot see the shape that actually
   * escaped: `fetch?: typeof fetch` is this repo's own DI idiom in six
   * `src/forms/*` files, so it arrives looking like house style, and once a
   * function takes it the uses inside that function resolve to the parameter and
   * are invisible to the assertion above. Pinning the NAME catches the plausible
   * instance; it does not close the class, because the same capability injected
   * as `deps.http` or typed `FetchLike` names nothing this can see. That is the
   * injected-capability limit stated in the header, not a gap this test forgot.
   */
  it("names fetch in no file but remote.ts, in any role at all", () => {
    const offending = extracted
      .filter((e) => e.file !== "remote.ts" && e.identifiers.includes("fetch"))
      .map((e) => e.file);
    expect(offending).toEqual([]);
    // …and remote.ts really does name it, so a rename cannot turn this rule into
    // a rule about nothing.
    expect(extracted.find((e) => e.file === "remote.ts")?.identifiers).toContain("fetch");
  });

  // Kept on remote.ts's reasoning: Prismic removes a model with
  // `DELETE /customtypes/{id}` and no other way, so no DELETE verb means no
  // delete capability. This one CANNOT fail closed — zero quoted verbs is the
  // correct and current state of eight of the nine files — which is why it is
  // the companion to the allow-lists above rather than the guard itself.
  //
  // The comparison is case-SENSITIVE while the collector is case-INSENSITIVE,
  // and the asymmetry is the point: a lowercase `"delete"` is collected and then
  // fails, because the only two values this module may write are the exact
  // literals it writes today.
  it("writes no HTTP verb but GET and POST, in a literal or a template part", () => {
    const verbs = extracted.flatMap((e) =>
      e.verbs.filter((v) => v !== "GET" && v !== "POST").map((v) => `${e.file}: ${v}`),
    );
    expect(verbs).toEqual([]);
  });

  /**
   * THE METHOD AXIS — the highest-risk single line in the module.
   *
   * `remote.ts` is the one file that holds `fetch`, the write token, and the
   * `/customtypes/{id}` URL, so a request method is the only route in this
   * module to an IRREVERSIBLE Prismic-side delete. Six shapes escaped the
   * 2026-08-13 red team here, all of them ordinary TypeScript: `init.method =
   * "delete"` after the literal was built, `{ ["method"]: "delete" }`,
   * `Object.defineProperty(init, "method", …)`, `` `${""}DELETE` ``, and
   * `init.method = action`.
   *
   * So this is stated as an allow-list over VALUES, exactly like the bindings
   * table: every value that can reach a request `method` must reduce statically
   * to the string literal `"POST"`. The collector above enumerates the WRITE
   * POSITIONS it understands and records a sentence for every one it does not,
   * which means an unlisted syntax fails as an unreadable write rather than
   * passing as no write at all.
   *
   * THE COUNT IS PINNED, and zero is a FAILURE. An extractor that quietly stops
   * matching — a renamed predicate after a TypeScript upgrade, a refactor that
   * moves the request builder — reports an empty list, and an empty list
   * satisfies "every method is POST" trivially. The module has exactly one
   * method write today (`remote.ts`'s `sendModel`, ~line 275); if that becomes
   * zero, or a second file starts building requests, this reds and somebody
   * looks.
   */
  it("writes exactly ONE request method in the module: the POST literal in remote.ts", () => {
    const byFile = Object.fromEntries(
      extracted.filter((e) => e.methodValues.length > 0).map((e) => [e.file, e.methodValues]),
    );
    expect(byFile).toEqual({ "remote.ts": ["POST"] });
  });

  it("calls no injected process-spawner directly", () => {
    const offending = extracted
      .filter((e) => e.directSpawnCalls > 0)
      .map((e) => `${e.file}: ${e.directSpawnCalls}`);
    expect(offending).toEqual([]);
  });
});
