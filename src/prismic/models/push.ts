// The one place a diff turns into writes, and therefore the one place the
// design's safety properties have to be true rather than merely intended.
//
// TWO INVARIANTS, both proven by mutation in tests/prismic/models/push.test.ts
// rather than asserted here:
//
//   1. NOTHING is ever sent for a `remoteOnly` model. A model Prismic holds and
//      the repo does not is REPORTED — onto `report.remoteOnlyReported`, by
//      identity only — and never acted on, because a stale local checkout must
//      never be able to remove a live content model. This module cannot delete
//      even if it wanted to — `remote.ts` has no delete function at all — but
//      "no delete verb downstream" is not the same claim as "this module never
//      touches a remote-only model", so it gets its own guard. Copying the ids
//      into the report is a READ of that bucket and does not weaken the
//      invariant, which is about what goes on the WIRE; the guard is stated
//      behaviourally ("`send` was never called") for exactly that reason.
//   2. NOTHING is ever sent for an `unchanged` model. That is not an
//      optimisation. `withRemoteScreenshots` rewrites `variations[].imageUrl`
//      on models `canon()` calls identical, so routing `unchanged` through the
//      send path would rewrite every slice in the fleet on every run — a
//      permanent stream of no-op writes against live repositories.
//
// Both hold because `work` below is built from exactly two of the diff's four
// buckets. The other two are absent by construction, not filtered out later.
import { withRemoteScreenshots } from "./diff.js";
import type { LocalEntry, ModelDiff, PrismicModel, PushReport } from "./types.js";

/**
 * Sends one model. Injected so `pushModels` stays testable and so the fetch
 * layer, not this one, owns credentials — nothing here knows a repository name
 * or a token, which is also what keeps this module's only channel to Prismic
 * visible in its signature.
 *
 * `remote` is the model Prismic currently holds, `undefined` on an insert. It
 * arrives ALONGSIDE the already-merged entry rather than instead of it: the
 * entry's model has been through `withRemoteScreenshots` and is what goes on
 * the wire, while `remote` is the before-picture a sender can hand to
 * `describeDiff` for a log line. A sender must never put `remote` on the wire.
 */
export type SendFn = (
  entry: LocalEntry,
  remote: PrismicModel | undefined,
  action: "insert" | "update",
) => Promise<void>;

export type PushOptions = {
  /** false = dry run: compute and report, send nothing. */
  apply: boolean;
  send: SendFn;
  /**
   * There is no `true`. The type is `false | undefined` on purpose: a stale
   * local checkout must never be able to remove a live content model, and the
   * compiler is a better guarantee of that than a comment. `remoteOnly` models
   * are reported for a human; deleting one is a dashboard action.
   */
  allowDelete?: false;
};

/**
 * The HTTP status carried by a rejection, or undefined when there is none.
 *
 * The property READ is inside the try, not merely the cast around it, because a
 * getter can throw: `Object.assign(new Error(), { get status() { throw … } })`
 * is a perfectly ordinary object to build. `sendModel` never produces one — it
 * throws an Error with a numeric `status` — but `send` is INJECTED, and the
 * population this module can promise nothing about (a retry wrapper, a batching
 * decorator, a test double) is precisely the population that hand-builds error
 * objects. Not hypothetical: before this existed, a throwing `status` getter
 * escaped `pushModels` entirely — pinned now by "survives a thrown value whose
 * accessors throw" in tests/prismic/models/push.test.ts.
 *
 * This is one of the two `catch`es in this file that SWALLOW rather than
 * rethrow, and they are named here rather than left to be discovered, on the
 * rule remote.ts states for `errorBody`: both run ONLY on a path that is already
 * reporting a failure, so the worst either can do is degrade a message. Throwing
 * from here would instead abandon the entire report — including the `sent` list
 * of models Prismic has ALREADY accepted — which is strictly worse than losing
 * one status field. A catch that can influence what this module returns for a
 * SUCCESSFUL model would have no such excuse; there is none.
 */
const statusOf = (e: unknown): number | undefined => {
  try {
    const s = (e as { status?: unknown } | null | undefined)?.status;
    return typeof s === "number" ? s : undefined;
  } catch {
    // A throwing getter tells us nothing about the status, which is exactly
    // what `undefined` means here.
    return undefined;
  }
};

/**
 * A rejection rendered for the report's `error` field, for ANY thrown value.
 *
 * Every obvious step can throw for a value that is neither null nor undefined,
 * and each shape below was run against the old one-line expression to confirm it
 * really escaped: `Object.create(null)` has no `toString` at all, so `String(e)`
 * throws "Cannot convert object to primitive value"; an object can define a
 * `toString` that throws; an Error can define a `message` getter that throws —
 * and `String(e)` on THAT one throws too, because `Error.prototype.toString`
 * reads `message`. Hence the placeholder at the end: it is reachable, not
 * decorative, and all four are pinned by the `it.each` in push.test.ts.
 *
 * See `statusOf` above for why swallowing is the right call in this one place.
 */
const messageOf = (e: unknown): string => {
  try {
    if (e instanceof Error) {
      const m = e.message;
      if (typeof m === "string") return m;
    }
  } catch {
    // A throwing `message` getter. Fall through — `String(e)` will very likely
    // throw as well, and the placeholder below is the honest answer.
  }
  try {
    return String(e);
  } catch {
    // No `toString`, or one that throws. Say so, rather than losing the report.
    return `<a thrown ${typeof e} that cannot be converted to a string>`;
  }
};

/**
 * Apply a diff to Prismic.
 *
 * ORDER MATTERS: every slice goes before every custom type. A custom type's
 * `Slices` field references slice ids by name, and Prismic rejects a type
 * referencing a slice it does not yet hold — the-tower-burbank's reconciliation
 * pushed 11 slices before 6 types for exactly this reason. It is not a
 * theoretical dependency: 23 of the fleet's 68 in-scope custom types declare a
 * non-empty slice zone, and every one of the 115 distinct slice ids they name
 * (counted per repo) resolves to a slice model in that SAME repo — so on a first
 * push, all 23 depend on slices landing first. Measured 2026-08-12 from each
 * repo's default branch via `git ls-tree`, never a working tree: eight of the
 * fifteen checkouts were on feature branches at the time, and they move.
 *
 * NO ORDER IS ATTEMPTED AMONG CUSTOM TYPES, and that is deliberate rather than
 * an oversight: 7 of the 68 carry a Link field constrained to a custom type, and
 * TWO of those point at THEMSELVES — reddoor-website's `project` and
 * vineyard-custom-homes' `project`, each through two separate fields. A
 * self-reference has no valid creation order, so no total order over custom
 * types exists in general — if Prismic ever does reject such an insert, no sort
 * could have saved it, and it surfaces as a `failed` entry naming the type
 * rather than as silence.
 *
 * The count is the less useful half of that. Both self-references are the
 * `project` model, which sites copy from one another, so the open question is
 * not "will a second site ever do this" — a second site already has — but what
 * this pipeline does the first time Prismic rejects one. (Re-measured 2026-08-12
 * under the same rule as the paragraph above, every repo's default branch
 * resolving to `origin/main`. An earlier revision of this comment said "one",
 * having counted reddoor-website and stopped.)
 *
 * FAILURE IS PER-MODEL: one rejected model is recorded and the run continues,
 * so a single bad model cannot silently strand the rest of a merge's changes
 * half-applied with no report of which half. A 401/403 is deliberately NOT
 * treated as fatal-for-the-run even though it certainly is one in practice: an
 * early exit would need a third bucket for "not attempted", and a `sent`/`failed`
 * pair that silently omits models is precisely the kind of report this pipeline
 * exists to stop producing. The cost is N identical 401 lines on a dead token —
 * noisy, honest, and `status` (below) says which of the two it is at a glance.
 */
export async function pushModels(diff: ModelDiff, opts: PushOptions): Promise<PushReport> {
  // Two buckets, never four. See invariants 1 and 2 in the file header — this
  // list IS the enforcement. The type system helps with one of them: a
  // `remoteOnly` entry is a `RemoteEntry` and has no `path`, so it cannot be
  // spread in here without someone fabricating one, which makes the mistake
  // conspicuous rather than impossible (the mutation that proves the guard fires
  // wrote `path: ""` and compiled). `unchanged` gets no help at all — it is a
  // `LocalEntry[]` and would slot straight in. Both are pinned by tests.
  const work: Array<{
    entry: LocalEntry;
    remote: PrismicModel | undefined;
    action: "insert" | "update";
  }> = [
    ...diff.toCreate.map((entry) => ({ entry, remote: undefined, action: "insert" as const })),
    ...diff.toUpdate.map(({ local, remote }) => ({
      entry: local,
      remote: remote.model,
      action: "update" as const,
    })),
  ];
  // Slices first — see the ORDER MATTERS note above. Returning 0 for a same-kind
  // pair leans on `sort` being stable (required since ES2019), which is what
  // keeps inserts ahead of updates within a kind and keeps the report's order
  // reproducible run to run.
  work.sort((a, b) => (a.entry.kind === b.entry.kind ? 0 : a.entry.kind === "slice" ? -1 : 1));

  // `mode` is the MODE, not the verdict. On a dry run `sent` is populated with
  // what WOULD go on the wire and nothing is sent, so no reader may treat `sent`
  // as "Prismic accepted these" without checking `mode` first.
  const report: PushReport = {
    mode: opts.apply ? "apply" : "dry",
    sent: [],
    failed: [],
    // Filled BEFORE the loop and identically in both modes, because it is a fact
    // about the COMPARISON rather than about what this run did — and because it
    // is the only thing that keeps an empty report from being ambiguous between
    // "in sync" and "this checkout can no longer see its own slices". See
    // `PushReport.remoteOnlyReported` for the failure it exists to name.
    remoteOnlyReported: diff.remoteOnly.map((e) => ({ kind: e.kind, id: e.id })),
  };

  for (const { entry, remote, action } of work) {
    if (!opts.apply) {
      report.sent.push({ kind: entry.kind, id: entry.id, action });
      continue;
    }
    try {
      // The merge is INSIDE the send path, not a caller's job: a push REPLACES
      // the whole model, and 9 of the fleet's 180 in-scope variations carry a
      // stale screenshot URL on disk (one in each of nine repos, measured
      // 2026-08-12). Sending the file verbatim would rot those previews in the
      // editor, and `canon()` drops `imageUrl` entirely — so the damage could
      // never show up as a diff on the next run either. Silent and permanent is
      // the combination this module is built to avoid.
      await opts.send(
        { ...entry, model: withRemoteScreenshots(entry.model, remote) },
        remote,
        action,
      );
      report.sent.push({ kind: entry.kind, id: entry.id, action });
    } catch (e) {
      // Carry the HTTP status (when there is one) so a caller can tell a dead
      // write token (401/403 — fix the secret) apart from a rejected model
      // (422 — fix the model). The nightly sweep must not conflate the two, and
      // Prismic's token expiry is undocumented, so 401 is not a rare branch.
      // `sendModel` attaches it to the Error object precisely so nobody has to
      // parse it back out of the message text.
      //
      // Read through `statusOf`/`messageOf`, never as `(e as Error).message`.
      // `send` is INJECTED, so this module can promise nothing about what it
      // throws — and EVERY step of the obvious version can itself throw, which
      // would escape `pushModels` and strand every model after this one with no
      // report at all, discarding even the `sent` list of models Prismic has
      // already accepted. That is far worse than the failure being reported. The
      // two helpers above enumerate the shapes and cite the verification.
      const status = statusOf(e);
      report.failed.push({
        kind: entry.kind,
        id: entry.id,
        error: messageOf(e),
        // Spread, so the key is ABSENT rather than present-and-undefined when
        // there was no status (a network failure has none). `PushReport` is
        // serialised into PR comments and Airtable; a blank `status` key reads
        // as "there was one and it was empty".
        ...(status === undefined ? {} : { status }),
      });
    }
  }
  return report;
}
