import { readFileSync } from "node:fs";
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
    expect(report).toEqual({ mode: "apply", sent: [], failed: [] });
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
});

// The behavioural guard above ("never sends anything for a remote-only model")
// is only the whole property while `send` is the ONLY way out of this module.
// This pins that. It is the same shape as remote.ts's no-delete guard and exists
// for the same reason: that one was an export-NAME check until a review mutated
// a working DELETE into the middle of `sendModel` and all 16 tests still passed.
// A name check cannot see IO added inline to a function that already exists.
describe("pushModels reaches Prismic only through the injected send", () => {
  // Read from disk on purpose: the property is about what the file CONTAINS.
  const source = readFileSync(
    new URL("../../../src/prismic/models/push.ts", import.meta.url),
    "utf-8",
  );

  // A positive allow-list, not a ban-list — it reads as what the module IS (pure
  // orchestration over a diff) and forces any future import to be argued for.
  // Adding `node:fs`, a `./remote.js` import, or an http client here would fail
  // it, which is the point: every one of those is a second channel that the
  // behavioural test above could not see.
  it("imports nothing but the pure diff helper and its types", () => {
    // `match` + `replace`, not `matchAll` + `m[1]`: under noUncheckedIndexedAccess
    // a capture group is `string | undefined`, and the `?? ""` needed to satisfy
    // it would quietly turn "the regex found nothing" into a passing empty list.
    const specifiers = (source.match(/from\s+"[^"]+"/g) ?? []).map((m) =>
      m.replace(/^from\s+"/, "").replace(/"$/, ""),
    );
    expect([...new Set(specifiers)].sort()).toEqual(["./diff.js", "./types.js"]);
  });

  it("makes no network call of its own", () => {
    // Call syntax, not the bare word: the SendFn doc comment says the fetch
    // layer owns credentials, and that sentence is the reason the rule exists.
    //
    // Only the two primitives that need no import. `http.request` and friends
    // are covered by the allow-list above and NOT listed here on purpose — an
    // earlier draft included `request\(`, which promptly failed on a comment
    // citing remote.ts's `request()` helper. A pattern that trips on prose
    // about the rule gets deleted by the next person as noise, taking the real
    // assertion with it.
    expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest)\s*\(/);
  });
});
