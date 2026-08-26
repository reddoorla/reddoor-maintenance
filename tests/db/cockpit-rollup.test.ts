import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  readCockpitRollup,
  writeCockpitRollup,
  readDigestState,
  writeDigestState,
  COCKPIT_ROLLUP_ID,
  DIGEST_STATE_ID,
  type CockpitRollup,
} from "../../src/db/digest-state.js";

/**
 * MED-16 of the 2026-08-26 review: the cockpit recomputed two "since a window"
 * aggregates over the whole `submissions` table on every page load. They move to
 * the nightly digest, which makes them up to 24h stale — so the distinction that
 * matters here is **not measured** vs **measured as zero**, and every one of
 * these numbers has a legitimate zero.
 */
const ROLLUP: CockpitRollup = {
  spamTotals: { honeypot: 3, tooFast: 1, markedSpam: 7 },
  notifyBounces: { recA: 2, recB: 1 },
  windowDays: { screenOuts: 30, bounces: 14 },
  computedAt: "2026-08-26T03:00:00.000Z",
};

async function db() {
  return openDb({ url: ":memory:" });
}

describe("cockpit roll-up store", () => {
  it("round-trips through the singleton row", async () => {
    const d = await db();
    await writeCockpitRollup(d, ROLLUP);
    expect(await readCockpitRollup(d)).toEqual(ROLLUP);
  });

  it("is NULL when it has never been written — not a row of zeros", async () => {
    // The whole point. A caller handed {honeypot: 0, …} cannot tell "nothing was
    // screened out" from "the digest has never run", and the cockpit would draw
    // a confident zero for an unmeasured window.
    expect(await readCockpitRollup(await db())).toBeNull();
  });

  it("is NULL for a malformed blob, and never throws on the request path", async () => {
    const d = await db();
    await d
      .insertInto("digest_state")
      .values({ id: COCKPIT_ROLLUP_ID, snapshot: "{not json", updated_at: null })
      .execute();
    await expect(readCockpitRollup(d)).resolves.toBeNull();
  });

  it("is NULL for a payload from an older writer that lacks the shape", async () => {
    // Written by a different process on a different schedule, so an old payload
    // can outlive a type change here. Anything unrecognized reads as unmeasured.
    const d = await db();
    for (const bad of ['{"spamTotals":{"honeypot":1}}', "null", '"a string"', "[]", "{}"]) {
      await d
        .insertInto("digest_state")
        .values({ id: COCKPIT_ROLLUP_ID, snapshot: bad, updated_at: null })
        .onConflict((oc) => oc.column("id").doUpdateSet({ snapshot: bad }))
        .execute();
      expect(await readCockpitRollup(d), bad).toBeNull();
    }
  });

  it("preserves a real all-zero measurement as zeros, not as null", async () => {
    // The positive control for the null tests above: a quiet month is a genuine
    // measurement and must survive as one.
    const d = await db();
    const quiet: CockpitRollup = {
      ...ROLLUP,
      spamTotals: { honeypot: 0, tooFast: 0, markedSpam: 0 },
      notifyBounces: {},
    };
    await writeCockpitRollup(d, quiet);
    const got = await readCockpitRollup(d);
    expect(got).not.toBeNull();
    expect(got).toEqual(quiet);
  });

  it("replaces on rewrite rather than accumulating rows", async () => {
    const d = await db();
    await writeCockpitRollup(d, ROLLUP);
    const next = { ...ROLLUP, computedAt: "2026-08-27T03:00:00.000Z" };
    await writeCockpitRollup(d, next);
    expect(await readCockpitRollup(d)).toEqual(next);
    const rows = await d
      .selectFrom("digest_state")
      .select("id")
      .where("id", "=", COCKPIT_ROLLUP_ID)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it("does not collide with the digest snapshot in the same table", async () => {
    // Both live in `digest_state`, keyed apart. If either writer clobbered the
    // other, the NEW badges and the spam strip would corrupt each other.
    const d = await db();
    const snap = { recA: { metric: 3, firstFlaggedAt: "2026-08-01T00:00:00.000Z" } };
    await writeDigestState(d, snap);
    await writeCockpitRollup(d, ROLLUP);
    expect(await readDigestState(d)).toEqual(snap);
    expect(await readCockpitRollup(d)).toEqual(ROLLUP);
    expect(COCKPIT_ROLLUP_ID).not.toBe(DIGEST_STATE_ID);
  });
});
