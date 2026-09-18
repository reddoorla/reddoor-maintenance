import type { Db } from "./client.js";
import type { TurnstileVerification } from "../forms/turnstile.js";

/** One captured-but-unresolved lead: the site lookup threw before the normal
 *  pipeline could run (Phase 0 of #539 — persist before enrich). */
export type DeadLetterRow = {
  id: string;
  siteSlug: string;
  /** The raw wire payload, exactly as the handler received it. */
  payload: unknown;
  /** The Turnstile verification computed at receipt — tokens expire in 300s,
   *  so replay reuses this answer rather than re-verifying. */
  turnstile: TurnstileVerification;
  error: string;
  receivedAt: string;
};

export type DeadLetterInput = {
  siteSlug: string;
  payload: unknown;
  turnstile: TurnstileVerification;
  error: string;
  receivedAt: Date;
};

/** Opaque, collision-free id (mirrors newSubmissionId). */
export function newDeadLetterId(): string {
  return `dl_${crypto.randomUUID()}`;
}

/** Persist a lead the normal pipeline could not place. This is the LAST writer
 *  on the ingest path — if it throws too, both stores are down and the caller's
 *  502 is honest. */
export async function createDeadLetter(db: Db, input: DeadLetterInput): Promise<{ id: string }> {
  const id = newDeadLetterId();
  await db
    .insertInto("submission_deadletter")
    .values({
      id,
      site_slug: input.siteSlug,
      payload: JSON.stringify(input.payload),
      turnstile: JSON.stringify(input.turnstile),
      error: input.error,
      received_at: input.receivedAt.toISOString(),
      replayed_at: null,
      replay_outcome: null,
      replay_submission_id: null,
    })
    .execute();
  return { id };
}

/** A queued row whose stored JSON could not be decoded. Carries no payload by
 *  construction: the bytes that failed to parse are exactly the bytes nothing
 *  should be guessing at, and they may hold a client's PII. */
export type UnreadableDeadLetterRow = {
  id: string;
  siteSlug: string;
  /** Which column failed, and the parser's own message. */
  error: string;
  receivedAt: string;
};

export type DeadLetterQueue = {
  /** Rows that decoded — the ones replay can actually run. */
  rows: DeadLetterRow[];
  /** Rows that did not. Reported, never dropped: they stay queued, they still
   *  count toward the cockpit alarm (which is computed in SQL and never touches
   *  these columns), and #786's `--abandon` is the only way to retire one. */
  unreadable: UnreadableDeadLetterRow[];
};

/** Rows not yet replayed, oldest first — replay preserves arrival order so the
 *  duplicate/velocity signals see submissions in the order they happened.
 *
 *  MED-10(c). Decoding is PER ROW. This used to `JSON.parse` inside a `.map`
 *  over the whole result set, so a single undecodable payload threw before any
 *  row was returned and wedged replay for every other lead in the queue — the
 *  `import-reap` shape, where one bad record froze the sync permanently. A row
 *  that cannot be decoded is now separated out and handed back for the caller
 *  to surface; the rows around it replay normally.
 */
export async function readUnreplayedDeadLetters(db: Db): Promise<DeadLetterQueue> {
  const raw = await db
    .selectFrom("submission_deadletter")
    .select(["id", "site_slug", "payload", "turnstile", "error", "received_at"])
    .where("replayed_at", "is", null)
    // #786: an abandoned row is terminal by decision — it must leave the replay
    // queue, or the command it was meant to release stays at exit 1 forever.
    .where("abandoned_at", "is", null)
    .orderBy("received_at", "asc")
    .execute();

  const queue: DeadLetterQueue = { rows: [], unreadable: [] };
  for (const r of raw) {
    let payload: unknown;
    try {
      payload = JSON.parse(r.payload) as unknown;
    } catch (err) {
      queue.unreadable.push({
        id: r.id,
        siteSlug: r.site_slug,
        error: `payload is not decodable JSON: ${String(err)}`,
        receivedAt: r.received_at,
      });
      continue;
    }
    let turnstile: TurnstileVerification;
    try {
      turnstile = JSON.parse(r.turnstile) as TurnstileVerification;
    } catch (err) {
      queue.unreadable.push({
        id: r.id,
        siteSlug: r.site_slug,
        error: `turnstile is not decodable JSON: ${String(err)}`,
        receivedAt: r.received_at,
      });
      continue;
    }
    queue.rows.push({
      id: r.id,
      siteSlug: r.site_slug,
      payload,
      turnstile,
      error: r.error,
      receivedAt: r.received_at,
    });
  }
  return queue;
}

/** The decodable rows only. Kept for callers that have no way to act on an
 *  undecodable row; anything that REPLAYS must use `readUnreplayedDeadLetters`
 *  so the rows it skipped are reported rather than silently missing. */
export async function listUnreplayedDeadLetters(db: Db): Promise<DeadLetterRow[]> {
  return (await readUnreplayedDeadLetters(db)).rows;
}

/** Mark a row's replay TERMINAL — it will never be picked up again. Only call
 *  for outcomes that re-running cannot improve (accepted, rejected). A replay
 *  whose lookup threw again is left untouched so the next run retries it — and
 *  since #645 so is `unknown-site`, because `ensure-site` can heal the missing
 *  Turso row and make the same replay succeed. */
export async function markDeadLetterReplayed(
  db: Db,
  id: string,
  outcome: string,
  submissionId: string | null,
  now: Date,
): Promise<void> {
  await db
    .updateTable("submission_deadletter")
    .set({
      replayed_at: now.toISOString(),
      replay_outcome: outcome,
      replay_submission_id: submissionId,
    })
    .where("id", "=", id)
    .execute();
}

/** Unreplayed rows per site slug — the input to the `deadletter` attention
 *  collector (#645). Grouped in SQL rather than by listing and counting in JS:
 *  the rows carry full lead payloads, and an alarm must never pull a client's
 *  PII into a dashboard request just to learn how many rows there are. */
export async function countUnreplayedDeadLettersBySlug(
  db: Db,
): Promise<ReadonlyMap<string, number>> {
  const rows = await db
    .selectFrom("submission_deadletter")
    .select((eb) => ["site_slug", eb.fn.countAll<number>().as("n")])
    .where("replayed_at", "is", null)
    // #786: and out of the alarm count, which is the standing CRITICAL item.
    .where("abandoned_at", "is", null)
    .groupBy("site_slug")
    .execute();
  return new Map(rows.map((r) => [r.site_slug, Number(r.n)]));
}

/** The same count for ONE slug — the `/s/:slug` dead-letter chip (MED-11).
 *
 *  The fleet homepage genuinely needs the whole map (it renders every site), so
 *  `countUnreplayedDeadLettersBySlug` stays. The site page did not: it built the
 *  fleet-wide map and read one key out of it.
 *
 *  Needs `idx_deadletter_slug_unreplayed` (0028) to be a per-slug read rather
 *  than a per-slug filter. Without it SQLite serves the predicate from
 *  `idx_deadletter_unreplayed (replayed_at)` and visits every unreplayed row in
 *  the fleet, then a rowid lookup into the payload-bearing table for each — the
 *  exact cost the grouped version's docblock says it exists to avoid. The plan
 *  still reads `SEARCH`, which is why the query-plan gate cannot see the
 *  difference and the index has to be a deliberate choice. */
export async function countUnreplayedDeadLettersForSlug(db: Db, slug: string): Promise<number> {
  const row = await db
    .selectFrom("submission_deadletter")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("site_slug", "=", slug)
    .where("replayed_at", "is", null)
    .where("abandoned_at", "is", null)
    .executeTakeFirst();
  return Number(row?.n) || 0;
}

/** Abandon dead letters as resolved-by-DECISION (#786).
 *
 *  The escape hatch #785 left open. `unknown-site` is deliberately non-terminal
 *  on replay so that healing and replaying are safe in either order — but that
 *  means a slug which is genuinely dead, and still deployed and posting, grows
 *  the queue without bound, holds `db replay-deadletters` at exit 1, and leaves
 *  a standing CRITICAL cockpit item. The only alternative today is deleting
 *  rows by hand, which destroys the very leads the decision was made about.
 *
 *  Targets ONE slug or ONE row id, never "everything": a mistyped invocation
 *  must not be able to write off the whole queue. Only rows that are still live
 *  (neither replayed nor already abandoned) are touched, which makes the call
 *  idempotent and keeps the FIRST decision — the one actually made — in place.
 *  `reason` is required and non-blank, because an undocumented write-off is the
 *  thing this exists to stop being necessary.
 *
 *  Returns the ids it abandoned, so the CLI can name them rather than print a
 *  bare count.
 */
export async function abandonDeadLetters(
  db: Db,
  opts: { slug?: string; id?: string; by: string; reason: string; now: Date },
): Promise<string[]> {
  const bySlug = opts.slug !== undefined;
  const byId = opts.id !== undefined;
  if (bySlug === byId) {
    throw new Error("abandonDeadLetters: pass exactly one of slug or id");
  }
  const reason = opts.reason.trim();
  if (reason === "") {
    throw new Error("abandonDeadLetters: a non-blank reason is required");
  }

  // Read the target ids first so the caller can be told exactly what was
  // abandoned; the same predicate then guards the write.
  let q = db
    .selectFrom("submission_deadletter")
    .select("id")
    .where("replayed_at", "is", null)
    .where("abandoned_at", "is", null);
  q = bySlug ? q.where("site_slug", "=", opts.slug!) : q.where("id", "=", opts.id!);
  const ids = (await q.execute()).map((r) => r.id);
  if (ids.length === 0) return [];

  await db
    .updateTable("submission_deadletter")
    .set({
      abandoned_at: opts.now.toISOString(),
      abandoned_by: opts.by,
      abandoned_reason: reason,
    })
    .where("id", "in", ids)
    // Re-asserted on the write: between the read and here nothing else runs
    // (libSQL is single-writer), but the guard costs nothing and keeps the
    // write's meaning legible on its own.
    .where("replayed_at", "is", null)
    .where("abandoned_at", "is", null)
    .execute();
  return ids;
}
