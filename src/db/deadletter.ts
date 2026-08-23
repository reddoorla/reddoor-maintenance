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

/** Rows not yet replayed, oldest first — replay preserves arrival order so the
 *  duplicate/velocity signals see submissions in the order they happened. */
export async function listUnreplayedDeadLetters(db: Db): Promise<DeadLetterRow[]> {
  const rows = await db
    .selectFrom("submission_deadletter")
    .select(["id", "site_slug", "payload", "turnstile", "error", "received_at"])
    .where("replayed_at", "is", null)
    .orderBy("received_at", "asc")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    siteSlug: r.site_slug,
    payload: JSON.parse(r.payload) as unknown,
    turnstile: JSON.parse(r.turnstile) as TurnstileVerification,
    error: r.error,
    receivedAt: r.received_at,
  }));
}

/** Mark a row's replay TERMINAL — it will never be picked up again. Only call
 *  for outcomes that re-running cannot improve (accepted, rejected,
 *  unknown-site). A replay whose lookup threw again is left untouched so the
 *  next run retries it. */
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
