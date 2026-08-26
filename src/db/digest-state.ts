/** #609 (#539 Phase 5): the digest's prior-run snapshot, on Turso.
 *
 *  Unlike every other Phase 5 slice this is a MIGRATION, not a mirror — there
 *  was no Turso table to dual-write into, so these REPLACE the Airtable pair in
 *  `src/alerts/digest-state.ts` rather than shadowing them. Nothing writes the
 *  Airtable "Digest State" table after this, so parity does not cover the new
 *  one: it has no counterpart to compare against.
 *
 *  The pure half — `diffAttention`, and the `DigestSnapshot` type it is written
 *  against — stays exactly where it is. Only the IO moved.
 *
 *  Stored as ONE row holding the whole snapshot as JSON. Both readers
 *  (`runDigest`'s diff and the fleet homepage's NEW badges) need the entire map,
 *  so a keyed table would buy nothing on reads and its "give me everything"
 *  query would be a raw scan needing a justified entry in the EXPLAIN gate's
 *  allowlist. One row by primary key needs neither.
 *
 *  Worth stating plainly: the homepage's read of this used to be an AIRTABLE
 *  call on a request path — a Phase 2 leftover, since digest state was never in
 *  that phase's scope. Moving it removes a live dependency, which is the same
 *  failure class as the 2026-08-17 quota outage.
 */
import type { Db } from "./client.js";
import type { DigestSnapshot } from "../alerts/digest-state.js";

/** The singleton row's key. A constant rather than a magic string at each call
 *  site, so the "there is exactly one row" invariant is visible in one place. */
export const DIGEST_STATE_ID = "default";

/**
 * The prior snapshot, or `{}` when there is none.
 *
 * A missing row and a malformed blob BOTH read as `{}` — the Airtable reader's
 * contract, kept verbatim. The digest runs unattended on a cron, so a bad blob
 * must cost accurate NEW badges for one run, never the whole send.
 */
export async function readDigestState(db: Db): Promise<DigestSnapshot> {
  const row = await db
    .selectFrom("digest_state")
    .select("snapshot")
    .where("id", "=", DIGEST_STATE_ID)
    .executeTakeFirst();
  if (!row) return {};
  try {
    return JSON.parse(row.snapshot) as DigestSnapshot;
  } catch {
    return {};
  }
}

/**
 * Persist the next snapshot, replacing whatever was there.
 *
 * An upsert on the constant id rather than a get-then-create: the Airtable
 * version needed two round-trips to decide, and here the singleton invariant is
 * enforced by the primary key instead of by the code that happens to run.
 */
export async function writeDigestState(
  db: Db,
  snap: DigestSnapshot,
  updatedAt: string = new Date().toISOString(),
): Promise<void> {
  const row = {
    id: DIGEST_STATE_ID,
    snapshot: JSON.stringify(snap),
    updated_at: updatedAt,
  };
  await db
    .insertInto("digest_state")
    .values(row)
    .onConflict((oc) => oc.column("id").doUpdateSet(row))
    .execute();
}
