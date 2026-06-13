/**
 * True when a thrown send error is Resend's same-key + DIFFERENT-body 409
 * (`invalid_idempotent_request`). The ResendClient (send/resend.ts) discards the
 * status/name and only surfaces the message string, so we match defensively on the
 * stable message substring "idempotency key has been used" (case-insensitive); a
 * `name`/`statusCode` of 409/`invalid_idempotent_request` is also accepted if a
 * future client happens to preserve it. A same-key + SAME-body re-send is deduped
 * by Resend (returns the original id) and never reaches here.
 *
 * Shared by both send surfaces that key into Resend's idempotency window:
 * `runDigest` (digest.ts, `digest-<date>` key) and `sendOne` (orchestrate.ts,
 * `report:<id>` key). Both treat a 409 as "the email already went out under this
 * key on a prior run" — a no-op for the digest, an already-done success for sendOne.
 */
export function isIdempotencyConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (/idempotency key has been used/i.test(message)) return true;
  const e = err as { name?: unknown; statusCode?: unknown };
  if (e.name === "invalid_idempotent_request") return true;
  if (e.statusCode === 409) return true;
  return false;
}
