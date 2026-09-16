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
import type { NotifyBounceCounts } from "./submissions.js";

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

/**
 * A SECOND row in the same table, holding the cockpit's "since a window"
 * roll-ups. Keyed separately rather than folded into the snapshot: the snapshot
 * is the digest's own diff state and has one writer and one meaning; conflating
 * two unrelated payloads in one blob makes a partial write of either look like a
 * corruption of both.
 */
export const COCKPIT_ROLLUP_ID = "cockpit_rollup";

/**
 * Fleet-wide counts the cockpit renders, computed once by the nightly digest
 * instead of aggregated on every page load.
 *
 * `computedAt` is not decoration. These figures are up to 24h old by
 * construction, and a stale number rendered as though it were live is worse than
 * no number — so the cockpit shows when it was taken.
 */
export type CockpitRollup = {
  spamTotals: { honeypot: number; tooFast: number; markedSpam: number };
  /** site id → unacknowledged bounce counts inside the bounce window, split by
   *  whether Resend called any of them Permanent (#783). */
  notifyBounces: Record<string, NotifyBounceCounts>;
  /** The windows these were computed over, so a changed constant is visible
   *  rather than silently re-labelling old numbers. */
  windowDays: { screenOuts: number; bounces: number };
  computedAt: string;
};

/**
 * The stored roll-up, or **null** when there is none.
 *
 * Null rather than zeros, deliberately. Every one of these numbers has a
 * legitimate zero, so a reader given `{honeypot: 0, …}` cannot tell "nothing was
 * screened out" from "the digest has never run". That is the same distinction
 * `FLEET_SMOKE_UNMEASURED` exists to preserve, and the cockpit renders the strip
 * as ABSENT for null rather than drawing a row of zeros.
 *
 * A malformed blob is also null: same reasoning, and it must never throw on a
 * request path.
 */
/**
 * Normalize the stored per-site bounce map (#783).
 *
 * The shape changed from `{recA: 2}` to `{recA: {total, permanent}}`, and this
 * blob is written by the NIGHTLY digest — so after a deploy the stored payload
 * is the old shape until the next run. Rejecting it outright would blank the
 * whole strip, `spamTotals` included, for a number that is merely less detailed.
 *
 * An old numeric entry reads as `permanent: 0`, which is the honest translation:
 * that writer recorded no classification, and 0 is exactly "nothing said the
 * address is dead". It words the alarm as the mail-filter case for one night,
 * which is the safe direction. Anything else is dropped per SITE rather than
 * poisoning the map with NaN or discarding the roll-up.
 */
function coerceBounces(raw: unknown): Record<string, NotifyBounceCounts> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, NotifyBounceCounts> = {};
  for (const [siteId, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[siteId] = { total: v, permanent: 0 };
      continue;
    }
    if (typeof v !== "object" || v === null || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    if (
      typeof o.total === "number" &&
      Number.isFinite(o.total) &&
      typeof o.permanent === "number" &&
      Number.isFinite(o.permanent)
    ) {
      out[siteId] = { total: o.total, permanent: o.permanent };
    }
  }
  return out;
}

export async function readCockpitRollup(db: Db): Promise<CockpitRollup | null> {
  const row = await db
    .selectFrom("digest_state")
    .select("snapshot")
    .where("id", "=", COCKPIT_ROLLUP_ID)
    .executeTakeFirst();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.snapshot) as Partial<CockpitRollup>;
    // Shape-check rather than trust: this blob is written by a different process
    // on a different schedule, so an older writer's payload can outlive a type
    // change here. Anything unrecognized reads as "not measured".
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.computedAt !== "string" ||
      typeof parsed.spamTotals !== "object" ||
      parsed.spamTotals === null ||
      typeof parsed.notifyBounces !== "object" ||
      parsed.notifyBounces === null
    ) {
      return null;
    }
    return { ...(parsed as CockpitRollup), notifyBounces: coerceBounces(parsed.notifyBounces) };
  } catch {
    return null;
  }
}

/** Upsert the roll-up, same singleton-by-PK shape as the snapshot. */
export async function writeCockpitRollup(db: Db, rollup: CockpitRollup): Promise<void> {
  const row = {
    id: COCKPIT_ROLLUP_ID,
    snapshot: JSON.stringify(rollup),
    updated_at: rollup.computedAt,
  };
  await db
    .insertInto("digest_state")
    .values(row)
    .onConflict((oc) => oc.column("id").doUpdateSet(row))
    .execute();
}
