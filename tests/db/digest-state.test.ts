/**
 * #609 (#539 Phase 5): digest state moves to Turso.
 *
 * Unlike every other Phase 5 slice this is a MIGRATION, not a mirror — there was
 * no Turso table to dual-write into, so these functions REPLACE the Airtable
 * pair rather than shadowing them.
 *
 * Stored as a single-row JSON blob, deliberately. Both readers
 * (`runDigest`'s diff and the fleet homepage's NEW badges) need the WHOLE map,
 * so a keyed table would buy nothing on reads and would need a justified
 * full-scan entry in the EXPLAIN gate's allowlist. One row fetched by primary
 * key needs neither.
 *
 * The contract is the Airtable version's, verbatim: a missing row and a
 * malformed blob both read as `{}` so the digest degrades to "nothing is NEW"
 * instead of crashing.
 */
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { readDigestState, writeDigestState } from "../../src/db/digest-state.js";
import type { DigestSnapshot } from "../../src/alerts/digest-state.js";

const SNAP: DigestSnapshot = {
  "vuln:recA": { metric: 3, firstFlaggedAt: "2026-08-20", exhausted: true },
  "ci:recB": { metric: 1, firstFlaggedAt: "2026-08-24" },
};

describe("digest state on Turso", () => {
  it("round-trips a snapshot, exhausted flag and all", async () => {
    const db = await openDb({ url: ":memory:" });
    await writeDigestState(db, SNAP, "2026-08-26T00:00:00.000Z");
    expect(await readDigestState(db)).toEqual(SNAP);
  });

  it("reads {} when nothing has been written yet", async () => {
    // The very first run after the migration, before any backfill. It must
    // behave exactly like the Airtable empty-table case: everything standing,
    // nothing badged NEW, no crash.
    const db = await openDb({ url: ":memory:" });
    expect(await readDigestState(db)).toEqual({});
  });

  it("is a singleton: a second write replaces the row rather than adding one", async () => {
    const db = await openDb({ url: ":memory:" });
    await writeDigestState(db, SNAP, "2026-08-26T00:00:00.000Z");
    await writeDigestState(
      db,
      { "ci:recB": { metric: 9, firstFlaggedAt: "2026-08-25" } },
      "2026-08-26T01:00:00.000Z",
    );

    const rows = await db.selectFrom("digest_state").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(await readDigestState(db)).toEqual({
      "ci:recB": { metric: 9, firstFlaggedAt: "2026-08-25" },
    });
  });

  it("reads {} from a malformed blob rather than throwing", async () => {
    // Same defensive contract as the Airtable reader. The digest runs unattended
    // on a cron; a bad blob must cost accurate NEW badges for one run, never the
    // whole send.
    const db = await openDb({ url: ":memory:" });
    await writeDigestState(db, SNAP, "2026-08-26T00:00:00.000Z");
    await db.updateTable("digest_state").set({ snapshot: "{not json" }).execute();

    expect(await readDigestState(db)).toEqual({});
  });

  it("stamps updated_at with the supplied timestamp", async () => {
    const db = await openDb({ url: ":memory:" });
    await writeDigestState(db, SNAP, "2026-08-26T00:00:00.000Z");
    const row = await db.selectFrom("digest_state").select("updated_at").executeTakeFirstOrThrow();
    expect(row.updated_at).toBe("2026-08-26T00:00:00.000Z");
  });

  it("stores an empty snapshot as an empty map, not as a missing row", async () => {
    // A fleet with nothing flagged writes `{}`. That must be distinguishable
    // from "never written" only in the row's existence, and must still read
    // back as {} — a resolved key clearing is the whole point of persisting on
    // a quiet day (spec §10).
    const db = await openDb({ url: ":memory:" });
    await writeDigestState(db, {}, "2026-08-26T00:00:00.000Z");
    expect(await db.selectFrom("digest_state").selectAll().execute()).toHaveLength(1);
    expect(await readDigestState(db)).toEqual({});
  });
});
