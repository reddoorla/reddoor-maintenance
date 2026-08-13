import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, it, expect, vi } from "vitest";
import { pushModels, type SendFn } from "../../../src/prismic/models/push.js";
import type {
  LocalEntry,
  ModelDiff,
  ModelKind,
  PrismicModel,
  RemoteEntry,
} from "../../../src/prismic/models/types.js";

const localEntry = (
  kind: ModelKind,
  id: string,
  model: Partial<PrismicModel> = {},
): LocalEntry => ({
  kind,
  id,
  model: { ...model, id },
  path: `${kind}/${id}`,
});
const remoteEntry = (
  kind: ModelKind,
  id: string,
  model: Partial<PrismicModel> = {},
): RemoteEntry => ({
  kind,
  id,
  model: { ...model, id },
});

const emptyDiff = (): ModelDiff => ({ toCreate: [], toUpdate: [], unchanged: [], remoteOnly: [] });

/** The first variation's `imageUrl` in a model that just went on the wire.
 *  Goes through `unknown` rather than asserting a shape onto `PrismicModel`:
 *  that type is `Record<string, unknown>` on purpose (it must round-trip fields
 *  Prismic has that this code does not know about), so a direct
 *  `as { variations: ... }` is a TS2352 "neither type sufficiently overlaps"
 *  error — which vitest, not being a typechecker, runs straight past. */
const firstShot = (model: PrismicModel): unknown =>
  (model.variations as Array<Record<string, unknown>> | undefined)?.[0]?.imageUrl;

/** A `send` that throws whatever it is given — the only way to reach the catch.
 *  Takes `unknown` because the point of two of the tests below is that a
 *  rejection is NOT guaranteed to be an Error. */
const throws = (thrown: unknown): SendFn =>
  vi.fn(async () => {
    throw thrown;
  });

describe("pushModels", () => {
  it("sends nothing when apply is false, but still reports what it would send", async () => {
    const send = vi.fn<SendFn>();
    const diff = emptyDiff();
    diff.toCreate.push(localEntry("slice", "hero"));
    const report = await pushModels(diff, { apply: false, send });
    expect(send).not.toHaveBeenCalled();
    expect(report.mode).toBe("dry");
    expect(report.sent).toEqual([{ kind: "slice", id: "hero", action: "insert" }]);
  });

  // An in-sync repo is the COMMON case — the nightly sweep hits it on every site
  // that has not changed — so "nothing to do" must be an ordinary empty report,
  // never a throw and never a missing `mode`.
  it("reports an empty run for an in-sync diff", async () => {
    const send = vi.fn<SendFn>();
    const report = await pushModels(emptyDiff(), { apply: true, send });
    expect(send).not.toHaveBeenCalled();
    expect(report).toEqual({ mode: "apply", sent: [], failed: [], remoteOnlyReported: [] });
  });

  // The report of the healthy run above and the report of a CATASTROPHE were,
  // until `remoteOnlyReported` existed, the same four characters. If a repo's
  // slice library path stops resolving — a renamed directory, a typo in
  // `libraries`, a partial checkout — `subdirs` answers [] for the proven-ENOENT
  // library BY DESIGN (alamo-anatomy is the live case), `localModels` returns
  // zero slices without throwing, `diffModels` sorts every slice Prismic holds
  // into `remoteOnly`, and this function's work list is empty. `{sent: [],
  // failed: []}`, from a checkout that has lost every slice in the repo.
  //
  // This is the absent-vs-unreadable collapse pointed at the REPORT layer, and
  // the fix is the same one the rest of this pipeline uses: make the two states
  // say different things. Assert the DIFFERENCE, not just the field's presence —
  // a renderer that only ever sees one of the two reports is the consumer at
  // risk, so what has to be true is that the two are not interchangeable.
  it("distinguishes a catastrophic checkout from an in-sync one", async () => {
    const send = vi.fn<SendFn>();
    const insync = await pushModels(emptyDiff(), { apply: true, send });

    const lostEverything = emptyDiff();
    lostEverything.remoteOnly.push(remoteEntry("slice", "hero"), remoteEntry("customtype", "page"));
    const report = await pushModels(lostEverything, { apply: true, send });

    expect(send).not.toHaveBeenCalled();
    expect(report).not.toEqual(insync);
    expect(report.remoteOnlyReported).toEqual([
      { kind: "slice", id: "hero" },
      { kind: "customtype", id: "page" },
    ]);
    // Identity only — the report is serialised into a PR comment and an Airtable
    // cell, and a live repository's full model JSON does not belong in either.
    expect(report.remoteOnlyReported.every((e) => !("model" in e))).toBe(true);
  });

  // Reported in BOTH modes, because it describes the comparison rather than the
  // run: a dry run that hid it would be the mode an operator reaches for FIRST
  // when checking whether a site is healthy.
  it("reports remote-only models on a dry run too", async () => {
    const send = vi.fn<SendFn>();
    const diff = emptyDiff();
    diff.remoteOnly.push(remoteEntry("customtype", "page"));
    const report = await pushModels(diff, { apply: false, send });
    expect(report.remoteOnlyReported).toEqual([{ kind: "customtype", id: "page" }]);
  });

  // page's `slices` field references blux_* slice ids; a custom type whose
  // referenced slice is not yet registered is rejected. The reconciliation run
  // pushed 11 slices before 6 types on the-tower-burbank for exactly this reason.
  it("sends ALL slices before ANY custom type", async () => {
    const order: string[] = [];
    const send = vi.fn<SendFn>(async (e) => {
      order.push(`${e.kind}:${e.id}`);
    });
    const diff = emptyDiff();
    diff.toCreate.push(localEntry("customtype", "page"), localEntry("slice", "blux_band"));
    diff.toUpdate.push({
      local: localEntry("customtype", "blog"),
      remote: remoteEntry("customtype", "blog"),
    });
    diff.toUpdate.push({
      local: localEntry("slice", "hero"),
      remote: remoteEntry("slice", "hero"),
    });
    await pushModels(diff, { apply: true, send });
    expect(order.slice(0, 2).every((k) => k.startsWith("slice:"))).toBe(true);
    expect(order.slice(2).every((k) => k.startsWith("customtype:"))).toBe(true);
  });

  it("uses insert for toCreate and update for toUpdate", async () => {
    const send = vi.fn<SendFn>();
    const diff = emptyDiff();
    diff.toCreate.push(localEntry("slice", "new_one"));
    diff.toUpdate.push({
      local: localEntry("slice", "old_one"),
      remote: remoteEntry("slice", "old_one"),
    });
    const report = await pushModels(diff, { apply: true, send });
    expect(report.sent).toEqual([
      { kind: "slice", id: "new_one", action: "insert" },
      { kind: "slice", id: "old_one", action: "update" },
    ]);
  });

  it("passes the remote copy so screenshots survive an update", async () => {
    const send = vi.fn<SendFn>();
    const local = localEntry("slice", "hero");
    const remote = remoteEntry("slice", "hero", { variations: [] });
    const diff = emptyDiff();
    diff.toUpdate.push({ local, remote });
    await pushModels(diff, { apply: true, send });
    expect(send.mock.calls[0]![1]).toBe(remote.model);
  });

  // The two tests below are what the one above does NOT prove, and the gap is
  // not academic: an implementation that passes `entry` straight through —
  // dropping the `withRemoteScreenshots` call entirely — satisfies the identity
  // assertion above, every ordering test, and every report-shape test. Nothing
  // would have failed, and the damage is silent and live: `canon()` DROPS
  // `imageUrl`, so the wrong screenshot can never show up as a diff on the next
  // run either. 9 of the 180 in-scope fleet variations carry a real URL on disk
  // — one in each of nine of the fifteen repos (measured 2026-08-12 from each
  // repo's default branch) — so this is a live condition, not a hypothetical.
  it("sends the remote's screenshot on an update, not the stale one on disk", async () => {
    const send = vi.fn<SendFn>();
    const local = localEntry("slice", "hero", {
      variations: [{ id: "default", imageUrl: "https://stale.example/old.png" }],
    });
    const remote = remoteEntry("slice", "hero", {
      variations: [{ id: "default", imageUrl: "https://images.prismic.io/live.png" }],
    });
    const diff = emptyDiff();
    diff.toUpdate.push({ local, remote });
    await pushModels(diff, { apply: true, send });
    expect(firstShot(send.mock.calls[0]![0].model)).toBe("https://images.prismic.io/live.png");
  });

  it("blanks a stale on-disk screenshot on an insert, where there is no remote", async () => {
    const send = vi.fn<SendFn>();
    const diff = emptyDiff();
    diff.toCreate.push(
      localEntry("slice", "hero", {
        variations: [{ id: "default", imageUrl: "https://stale.example/old.png" }],
      }),
    );
    await pushModels(diff, { apply: true, send });
    expect(firstShot(send.mock.calls[0]![0].model)).toBe("");
  });

  // THE safety property: nothing in this function can act on a remote-only
  // model. `remoteOnly` lives on the diff, not the report — a caller who
  // needs to know which models are remote-only reads it there (Task 13's
  // renderer does exactly that).
  //
  // This assertion is behavioural, not name-shaped, and that distinction is the
  // lesson of the no-delete guard in remote.test.ts: a test that only inspected
  // NAMES reported green while a working DELETE sat inside `sendModel`. `send`
  // is the only channel out of this module (pinned by the source test below), so
  // "send was never called" is the whole property, not a proxy for it. Verified
  // by mutation 2026-08-12: routing `diff.remoteOnly` into the work list fails
  // this test on the first assertion.
  it("never sends anything for a remote-only model", async () => {
    const send = vi.fn<SendFn>();
    const diff = emptyDiff();
    diff.remoteOnly.push(remoteEntry("customtype", "frozen_page"));
    const report = await pushModels(diff, { apply: true, send });
    expect(send).not.toHaveBeenCalled();
    expect(report.sent).toEqual([]);
    expect(diff.remoteOnly.map((e) => e.id)).toEqual(["frozen_page"]);
  });

  // A cross-function invariant that otherwise lives only in someone's head.
  // `withRemoteScreenshots` rewrites `variations[].imageUrl` — the one key
  // `canon()` drops outright — so a model `diffModels` calls `unchanged` can
  // still come out of that function different from what Prismic holds. It is
  // harmless ONLY because `unchanged` is never pushed. Route it through the send
  // path and all 132 slice models in the fleet (measured 2026-08-12 across the
  // fifteen in-scope repos' default branches) get rewritten on every run, for
  // nothing, against live repositories. Pin it. (Mutation-verified the same day:
  // adding `diff.unchanged` to the work list fails this test.)
  it("never sends an unchanged model", async () => {
    const send = vi.fn<SendFn>();
    const diff = emptyDiff();
    diff.unchanged.push(localEntry("slice", "hero"), localEntry("customtype", "page"));
    const report = await pushModels(diff, { apply: true, send });
    expect(send).not.toHaveBeenCalled();
    expect(report.sent).toEqual([]);
  });

  it("records a per-model failure and KEEPS GOING", async () => {
    const send = vi.fn<SendFn>(async (e) => {
      if (e.id === "bad") throw new Error("422 unprocessable");
    });
    const diff = emptyDiff();
    diff.toCreate.push(localEntry("slice", "bad"), localEntry("slice", "good"));
    const report = await pushModels(diff, { apply: true, send });
    expect(report.failed).toEqual([{ kind: "slice", id: "bad", error: "422 unprocessable" }]);
    expect(report.sent.map((s) => s.id)).toEqual(["good"]);
  });

  // Every failure test above uses a SLICE-ONLY diff, and the ordering test's
  // `send` never throws — so nothing pinned continuation across the
  // slice→customtype boundary, the ONE boundary the slices-first sort creates.
  //
  // The gap is not academic. Add the obvious cascade-noise suppressor — "once a
  // slice has failed, skip the custom types, they reference slices that are not
  // there" — and a 3-model diff returns `sent: []`, `failed: [one slice]`: one
  // model of three accounted for, two in neither bucket, and every other test in
  // this file still green. That is exactly the "`sent`/`failed` pair that
  // silently omits models" the doc comment on `pushModels` says the pipeline
  // exists to stop producing, which is also the justification it gives for not
  // aborting the run on a 401/403.
  const mixedDiff = (): ModelDiff => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("customtype", "page"), localEntry("slice", "hero"));
    d.toUpdate.push({
      local: localEntry("slice", "banner"),
      remote: remoteEntry("slice", "banner"),
    });
    d.toUpdate.push({
      local: localEntry("customtype", "blog"),
      remote: remoteEntry("customtype", "blog"),
    });
    return d;
  };
  const EVERY_MODEL = ["customtype:blog", "customtype:page", "slice:banner", "slice:hero"];

  it("keeps going into the custom types after a slice has failed", async () => {
    const send = vi.fn<SendFn>(async (e) => {
      if (e.id === "hero") throw Object.assign(new Error("401 unauthorized"), { status: 401 });
    });
    const report = await pushModels(mixedDiff(), { apply: true, send });
    expect(report.failed.map((f) => `${f.kind}:${f.id}`)).toEqual(["slice:hero"]);
    // The custom types come AFTER every slice, so this is the assertion a
    // cascade suppressor would break.
    expect(report.sent.map((s) => `${s.kind}:${s.id}`).sort()).toEqual([
      "customtype:blog",
      "customtype:page",
      "slice:banner",
    ]);
  });

  // The invariant behind that example, asserted as a property: whichever models
  // reject, every model in the work list lands in EXACTLY ONE bucket. Stated
  // this way it also pins `sent.length + failed.length === work.length`, which
  // is the thing a future edit is actually at risk of breaking.
  it.each([...EVERY_MODEL, "<none>", "<all>"])(
    "accounts for every model in exactly one bucket when %s rejects",
    async (failing) => {
      const send = vi.fn<SendFn>(async (e) => {
        if (failing === "<all>" || `${e.kind}:${e.id}` === failing) throw new Error("rejected");
      });
      const report = await pushModels(mixedDiff(), { apply: true, send });
      const accounted = [
        ...report.sent.map((s) => `${s.kind}:${s.id}`),
        ...report.failed.map((f) => `${f.kind}:${f.id}`),
      ];
      // Sorted-multiset equality, so a model counted TWICE fails as loudly as
      // one omitted — a retry that pushed to both buckets is the other way this
      // accounting goes wrong.
      expect(accounted.sort()).toEqual(EVERY_MODEL);
      expect(report.sent.length + report.failed.length).toBe(EVERY_MODEL.length);
    },
  );

  it("does not record a failed model as sent", async () => {
    const send = throws(new Error("boom"));
    const diff = emptyDiff();
    diff.toCreate.push(localEntry("slice", "hero"));
    const report = await pushModels(diff, { apply: true, send });
    expect(report.sent).toEqual([]);
  });

  // `sendModel` attaches `status` to the Error it throws (remote.ts) and this is
  // the only consumer of that contract — unread, the whole thing is decorative.
  // It is what tells a DEAD WRITE TOKEN (401/403 — the operator rotates a
  // secret) apart from a REJECTED MODEL (422 — the operator fixes the model).
  // Those are opposite responses, Prismic's token expiry is undocumented, and
  // the message text is the only other place the number appears — parsing it is
  // exactly the fragility `status` exists to remove.
  it("carries the failure's HTTP status through, so a dead token reads differently", async () => {
    const dead = Object.assign(new Error("GET ... -> 401 unauthorized"), { status: 401 });
    const rejected = Object.assign(new Error("POST ... -> 422 unprocessable"), { status: 422 });
    const send = vi.fn<SendFn>(async (e) => {
      throw e.id === "tokenless" ? dead : rejected;
    });
    const diff = emptyDiff();
    diff.toCreate.push(localEntry("slice", "tokenless"), localEntry("slice", "malformed"));
    const report = await pushModels(diff, { apply: true, send });
    expect(report.failed.map((f) => f.status)).toEqual([401, 422]);
  });

  // The key is OMITTED, not set to undefined. `exactOptionalPropertyTypes` makes
  // the compiler agree, but the reason is at the far end of the pipeline: this
  // report is serialised into a PR comment and an Airtable cell, and a present
  // `status` key holding nothing reads as "there was a status and it was
  // blank" — inviting exactly the token-vs-model misdiagnosis the field exists
  // to prevent. A network failure (`fetch failed`) genuinely has no status.
  it("omits status entirely when the failure carries none", async () => {
    const send = throws(new Error("fetch failed"));
    const diff = emptyDiff();
    diff.toCreate.push(localEntry("slice", "hero"));
    const report = await pushModels(diff, { apply: true, send });
    expect(Object.hasOwn(report.failed[0]!, "status")).toBe(false);
  });

  // A rejection is not guaranteed to be an Error. `(e as Error).message` on a
  // thrown string yields `undefined` — a `failed` entry whose `error` field is
  // typed `string` and holds nothing — and on a thrown `null` it throws a SECOND
  // time from inside the catch, which escapes `pushModels` entirely and strands
  // every model after this one with no report at all. That is the same hazard
  // `request()` in remote.ts guards with `?.`, and the same doctrine applies
  // here: `send` is an INJECTED function, so this module cannot make any promise
  // about what it throws.
  it("records a non-Error rejection instead of dying inside the catch", async () => {
    const diff = () => {
      const d = emptyDiff();
      d.toCreate.push(localEntry("slice", "hero"), localEntry("slice", "next"));
      return d;
    };
    const fromString = await pushModels(diff(), { apply: true, send: throws("just a string") });
    expect(fromString.failed.map((f) => f.error)).toEqual(["just a string", "just a string"]);

    const fromNull = await pushModels(diff(), { apply: true, send: throws(null) });
    expect(fromNull.failed).toHaveLength(2);
    expect(fromNull.sent).toEqual([]);
  });

  // `null` was handled; the general case was not. Reading `.status` off the raw
  // thrown value and falling back to `String(e)` both throw for values that are
  // neither null nor undefined. Each shape below was run against that old
  // one-line expression and confirmed to escape `pushModels` entirely —
  // discarding the WHOLE report, including the `sent` list of models Prismic had
  // already accepted, which is the loss that matters.
  //
  // None is reachable through `sendModel`, which always throws an Error carrying
  // a numeric `status`. They bite the population the doc comment says this module
  // "can promise nothing about": a future injected sender — a retry wrapper, a
  // batching decorator, a test double. Two models, so the assertion also shows
  // the run CONTINUED rather than merely survived the first one.
  it.each([
    ["a null-prototype object, which has no toString at all", () => Object.create(null) as unknown],
    [
      "an object whose toString throws",
      (): unknown => ({
        toString() {
          throw new Error("toString says no");
        },
      }),
    ],
    [
      "an Error whose status getter throws",
      (): unknown =>
        Object.defineProperty(new Error("boom"), "status", {
          get() {
            throw new Error("status says no");
          },
        }),
    ],
    // The one where BOTH fallbacks fail: `String(e)` on this calls
    // `Error.prototype.toString`, which reads `message` and throws again. This is
    // what makes `messageOf`'s placeholder reachable rather than decorative.
    [
      "an Error whose message getter throws, defeating String(e) too",
      (): unknown =>
        Object.defineProperty(new Error(), "message", {
          get() {
            throw new Error("message says no");
          },
        }),
    ],
  ])("survives a thrown value whose accessors throw: %s", async (_shape, make) => {
    const diff = emptyDiff();
    diff.toCreate.push(localEntry("slice", "first"), localEntry("slice", "second"));
    const report = await pushModels(diff, { apply: true, send: throws(make()) });
    expect(report.failed.map((f) => f.id)).toEqual(["first", "second"]);
    // A `string`-typed field must hold a string. The placeholder is reachable —
    // an unstringifiable value has no message to report — but it must never be
    // empty or `undefined`.
    expect(report.failed.every((f) => typeof f.error === "string" && f.error !== "")).toBe(true);
    expect(report.failed.every((f) => !Object.hasOwn(f, "status"))).toBe(true);
  });
});

// The behavioural guard above ("never sends anything for a remote-only model")
// is only the whole property while `send` is the ONLY way out of this module.
// This pins that.
//
// IT IS AN ALLOW-LIST, NOT A DENY-LIST, and that is the entire design rather
// than a stylistic preference. The deny-list version of this guard has now
// failed THREE TIMES, each fix closing exactly the channel the previous one
// missed:
//
//   1. An export-NAME check (remote.test.ts). Blind to a working DELETE added
//      INLINE inside `sendModel` — a function that already did the writing, so
//      no new export appeared. All 16 tests passed and tsc exited 0.
//   2. A quoted-verb check plus an import check matching `from "…"`. Blind to
//      `const { request } = await import("node:https")`: the import pattern saw
//      only STATIC specifiers, the network pattern saw only `fetch(` and
//      `XMLHttpRequest(`, and `request(` fell straight through the seam between
//      two guards written as a division of labour. `await import()` is this
//      codebase's dominant lazy-load idiom — 63 dynamic-import calls across 12
//      files under src/, 26 of them in src/cli/bin.ts alone (counted from the
//      AST, not a grep, on 2026-08-13) — so it was the likeliest channel on the
//      list, not an exotic one.
//   3. Whatever comes next. There is always a next one, and THAT is the finding:
//      enumerating forbidden channels is a game lost on the first channel nobody
//      enumerated.
//
// The structural fact that lets us stop playing it: `pushModels` receives `send`
// as an INJECTED dependency, so this module needs no IO capability of its own at
// all — no client, no socket, no filesystem, nothing. So rather than list what it
// must not do, list the entire two-entry set of things it MAY import and fail
// everything else, including specifiers nobody here thought of.
//
// FAIL-CLOSED IS PART OF THE PROPERTY. An extraction that matches nothing must
// FAIL, not pass: a guard that silently examines nothing is worse than no guard,
// because it also stops anyone from writing a real one. Hence the non-zero
// assertion, and hence "leaves no import or require token unaccounted for" — any
// import token the extractor did not recognise is reported as a hole in the
// EXTRACTOR rather than waved through as a clean file.
//
// WHAT IT DOES NOT REACH, said plainly so nobody reads the above as
// completeness. The guard is about THIS FILE. `./diff.js` is on the allow-list
// and the binding taken from it is pinned to `withRemoteScreenshots`, so no new
// function can be imported from there — but IO added inside `diff.ts` itself,
// reached through that one function, would look clean from here. `diff.ts`
// imports only `./canon.js` and `./types.js` today and has no source guard of
// its own; that is the remaining channel, and it is a guard-hop away rather than
// a seam between two patterns. The other is `opts.send`, which is the point of
// the module and is pinned behaviourally above instead.
//
// Verified 2026-08-13 by mutation, one attack at a time, each applied to push.ts
// and reverted: dynamic `import`, `createRequire`, bare side-effect import,
// `import x = require()`, `export * from`, a computed dynamic specifier, a new
// binding from the allow-listed module, `new Function()`, `(0, eval)()`,
// `globalThis.fetch`, `process.binding`, and `globalThis["fe" + "tch"]` — twelve
// caught, plus two controls (an extra bare import of an ALLOWED module, and an
// ordinary local-variable refactor) confirmed still green, because a guard that
// fires on honest edits is a guard that gets deleted.
//
// DO NOT "simplify" this back into a regex that bans the verbs and specifiers of
// the day. That is precisely the shape that failed twice.
describe("pushModels reaches Prismic only through the injected send", () => {
  // Read from disk on purpose: the property is about what the file CONTAINS, and
  // an import only ever exposes what it exports.
  const source = readFileSync(
    new URL("../../../src/prismic/models/push.ts", import.meta.url),
    "utf-8",
  );
  // PARSED, not regexed — and the parser is also the only comment-stripper worth
  // trusting here. A guard like this must quote the constructs it forbids in
  // order to explain itself (the paragraphs above say `await import("node:https")`
  // out loud), and the previous draft of the network check had to drop `request\(`
  // because it tripped on a comment citing remote.ts's `request()` helper. A rule
  // that fails on its own explanation gets deleted as noise, taking the real
  // assertion with it. Tokens and syntax nodes cannot see inside a comment.
  const sf = ts.createSourceFile("push.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const eachNode = (visit: (n: ts.Node) => void): void => {
    const walk = (n: ts.Node): void => {
      visit(n);
      ts.forEachChild(n, walk);
    };
    walk(sf);
  };

  /** What an unresolvable specifier is recorded AS. `import(someVariable)` must
   *  fail the allow-list, not vanish from it — "this guard cannot tell" is a
   *  failure, never a pass. */
  const UNRESOLVED = "<a module specifier this guard cannot resolve to a literal>";
  const literal = (n: ts.Node | undefined): string =>
    n !== undefined && ts.isStringLiteralLike(n) ? n.text : UNRESOLVED;

  /** Every module this file names, by every mechanism, with the span of the
   *  construct that named it (used by the unaccounted-token check below). */
  const named: Array<{ specifier: string; start: number; end: number }> = [];
  eachNode((n) => {
    const add = (specifier: string): number =>
      named.push({ specifier, start: n.getStart(sf), end: n.getEnd() });
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) {
      // `export … from "x"` is an import channel too: it evaluates the module.
      if (n.moduleSpecifier) add(literal(n.moduleSpecifier));
    } else if (ts.isImportEqualsDeclaration(n)) {
      add(
        ts.isExternalModuleReference(n.moduleReference)
          ? literal(n.moduleReference.expression)
          : UNRESOLVED,
      );
    } else if (ts.isImportTypeNode(n)) {
      add(ts.isLiteralTypeNode(n.argument) ? literal(n.argument.literal) : UNRESOLVED);
    } else if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(callee) && (callee.text === "require" || callee.text === "createRequire");
      if (isDynamicImport || isRequire) add(literal(n.arguments[0]));
    }
  });

  /** Every token in the file that can begin an import, wherever it sits. This is
   *  the SECOND mechanism, deliberately independent of the node walk above: the
   *  walk enumerates node kinds and can therefore be incomplete, so anything it
   *  missed shows up here as a token inside no recognised construct. */
  const IMPORTY = new Set(["import", "require", "createRequire"]);
  const importTokens: Array<{ text: string; line: number; pos: number }> = [];
  const eachToken = (n: ts.Node): void => {
    const kids = n.getChildren(sf);
    if (kids.length > 0) {
      for (const c of kids) eachToken(c);
      return;
    }
    const text = n.getText(sf);
    if (!IMPORTY.has(text)) return;
    const pos = n.getStart(sf);
    importTokens.push({ text, pos, line: sf.getLineAndCharacterOfPosition(pos).line + 1 });
  };
  eachToken(sf);

  it("names only the pure diff helper and its types, by ANY import mechanism", () => {
    // Static `import … from`, bare `import "…"`, `export … from`, dynamic
    // `await import(…)`, `import x = require(…)`, `typeof import(…)`,
    // `require(…)` and `createRequire(…)` all land in `named` above.
    expect([...new Set(named.map((m) => m.specifier))].sort()).toEqual(["./diff.js", "./types.js"]);
  });

  it("examined a non-zero number of module specifiers — the guard fails closed", () => {
    expect(named.length).toBeGreaterThan(0);
    expect(importTokens.length).toBeGreaterThan(0);
  });

  it("leaves no import or require token unaccounted for by the extractor", () => {
    const unaccounted = importTokens.filter(
      (t) => !named.some((m) => t.pos >= m.start && t.pos < m.end),
    );
    expect(unaccounted.map((t) => `${t.text} (line ${t.line})`)).toEqual([]);
  });

  // The specifier list alone would wave through `import { deleteModel } from
  // "./diff.js"`. `./types.js` is imported TYPE-ONLY — erased at runtime, so it
  // cannot carry a capability at all — and `./diff.js` may contribute exactly
  // one pure function.
  it("takes exactly one pure function by value; the types are erased at runtime", () => {
    const byValue: string[] = [];
    eachNode((n) => {
      if (!ts.isImportDeclaration(n) || !n.importClause || n.importClause.isTypeOnly) return;
      if (n.importClause.name) byValue.push(n.importClause.name.text);
      const bound = n.importClause.namedBindings;
      if (bound && ts.isNamespaceImport(bound)) byValue.push(`* as ${bound.name.text}`);
      if (bound && ts.isNamedImports(bound))
        for (const el of bound.elements) if (!el.isTypeOnly) byValue.push(el.name.text);
    });
    expect(byValue.sort()).toEqual(["withRemoteScreenshots"]);
  });

  // The other half of "needs no IO capability of its own": an import is not the
  // only way to get one. `fetch`, `eval`, `Function`, `globalThis` and `process`
  // are AMBIENT — no import token, no specifier, nothing above can see them.
  //
  // Same allow-list shape rather than a second ban-list, and stated over FREE
  // IDENTIFIERS — every name this file references but does not itself declare —
  // rather than over call sites. That distinction was earned: an earlier draft
  // here allow-listed the ROOT of each call chain, which `(0, eval)("…")` walks
  // straight past, because the callee of that call is a parenthesised comma
  // expression and not an identifier at all. Free identifiers have no such
  // syntax-shaped hole — a name that is not declared here and not on this list
  // fails however it is later spelled, called, aliased or destructured.
  //
  // Six names is the entire ambient surface a pure diff-orchestrator needs. Any
  // seventh has to be argued for in this list, which is the point.
  it("references no ambient name but the six a pure module needs", () => {
    const AMBIENT = new Set([
      "Array",
      "Error",
      "Promise",
      "String",
      "undefined",
      // `as const` — the parser reports the assertion's type as a reference to an
      // identifier literally named `const`. A parse artefact, not a global.
      "const",
    ]);
    const declared = new Set<string>();
    const declare = (name: ts.Node | undefined): void => {
      if (!name) return;
      if (ts.isIdentifier(name)) {
        declared.add(name.text);
        return;
      }
      if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name))
        for (const el of name.elements) if (ts.isBindingElement(el)) declare(el.name);
    };
    eachNode((n) => {
      if (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n))
        declare(n.name);
      else if (
        ts.isFunctionDeclaration(n) ||
        ts.isClassDeclaration(n) ||
        ts.isTypeAliasDeclaration(n) ||
        ts.isInterfaceDeclaration(n) ||
        ts.isTypeParameterDeclaration(n) ||
        ts.isEnumDeclaration(n) ||
        ts.isModuleDeclaration(n)
      )
        declare(n.name);
      else if (ts.isCatchClause(n)) declare(n.variableDeclaration?.name);
      else if (ts.isImportClause(n)) {
        declare(n.name);
        const bound = n.namedBindings;
        if (bound && ts.isNamespaceImport(bound)) declared.add(bound.name.text);
        if (bound && ts.isNamedImports(bound))
          for (const el of bound.elements) declared.add(el.name.text);
      }
    });

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

    const referenced = new Set<string>();
    eachNode((n) => {
      if (ts.isIdentifier(n) && !isName(n)) referenced.add(n.text);
    });
    expect([...referenced].filter((r) => !declared.has(r) && !AMBIENT.has(r)).sort()).toEqual([]);
    // Fails closed: a traversal that found no identifiers at all would otherwise
    // pass this test loudest of any in the file.
    expect(referenced.size).toBeGreaterThan(0);
  });

  // Kept on remote.test.ts's reasoning: Prismic removes a model with
  // `DELETE /customtypes/{id}` and no other way, so no DELETE verb means no
  // delete capability. This one CANNOT fail closed — zero quoted verbs is the
  // correct and current state of this file — which is why it is the companion to
  // the allow-lists above rather than the guard itself.
  it("writes no HTTP verb but GET and POST", () => {
    const verbs: string[] = [];
    eachNode((n) => {
      if (ts.isStringLiteralLike(n) && /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(n.text))
        verbs.push(n.text);
    });
    expect(verbs.filter((v) => v !== "GET" && v !== "POST")).toEqual([]);
  });
});
