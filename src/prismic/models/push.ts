// The one place a diff turns into writes, and therefore the one place the
// design's safety properties have to be true rather than merely intended.
//
// TWO INVARIANTS, both proven by mutation in tests/prismic/models/push.test.ts
// rather than asserted here:
//
//   1. NOTHING is ever sent for a `remoteOnly` model. A model Prismic holds and
//      the repo does not is REPORTED (Task 13 renders it straight off the diff)
//      and never acted on, because a stale local checkout must never be able to
//      remove a live content model. This module cannot delete even if it wanted
//      to — `remote.ts` has no delete function at all — but "no delete verb
//      downstream" is not the same claim as "this module never touches a
//      remote-only model", so it gets its own guard.
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
 * an oversight: 7 of the 68 carry a Link/ContentRelationship field constrained
 * to a custom type, and one of those points at ITSELF (reddoor-website's
 * `project` links to `project`). A self-reference has no valid creation order,
 * so no total order over custom types exists in general — if Prismic ever does
 * reject such an insert, no sort could have saved it, and it surfaces as a
 * `failed` entry naming the type rather than as silence.
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
  const report: PushReport = { mode: opts.apply ? "apply" : "dry", sent: [], failed: [] };

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
      // Read defensively, and not as `(e as Error).message`. `send` is INJECTED,
      // so this module can promise nothing about what it throws: a thrown string
      // would put `undefined` into a field typed `string`, and a thrown `null`
      // would throw a SECOND time from inside this catch — escaping `pushModels`
      // entirely and stranding every model after this one with no report at all,
      // which is a far worse outcome than the failure being reported. Same
      // reasoning, same idiom as `request()` in remote.ts.
      const status = (e as { status?: unknown } | null | undefined)?.status;
      report.failed.push({
        kind: entry.kind,
        id: entry.id,
        error: e instanceof Error ? e.message : String(e),
        // Spread, so the key is ABSENT rather than present-and-undefined when
        // there was no status (a network failure has none). `PushReport` is
        // serialised into PR comments and Airtable; a blank `status` key reads
        // as "there was one and it was empty".
        ...(typeof status === "number" ? { status } : {}),
      });
    }
  }
  return report;
}
