import type { DeliveryStatus } from "./airtable/reports.js";
import type { BounceDetail } from "./submission-row.js";

export type { BounceDetail };

/**
 * Resend webhook event type → Airtable Delivery status value.
 * Imported by both `netlify/functions/resend-webhook.mts` and its test, so the
 * mapping has a single source of truth.
 */
export const STATUS_MAP: Record<string, Exclude<DeliveryStatus, "pending">> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  // `email.delivery_delayed` is intentionally omitted: it's non-terminal (a
  // delivered/bounced event always follows), so there's no DeliveryStatus to map
  // it to and an unmapped event is acknowledged with 200. Asserted in
  // tests/webhook/resend-webhook.test.ts so this stays deliberate, not an oversight.
};

/**
 * Monotonic ordering of delivery states, low → terminal:
 *   pending (0) < delivered (1) < {bounced, complained} (2, terminal)
 *
 * `bounced` and `complained` are both terminal failures the cockpit/digest rely
 * on; once written they must never be downgraded to `delivered` or `pending` by
 * a retried or out-of-order webhook (e.g. a `delivered` event arriving after a
 * `bounced`). They sit at the same rank — neither downgrades the other (a real
 * pipeline won't emit both for one message, and either terminal value is a
 * truthful "this didn't land").
 */
const STATUS_RANK: Record<DeliveryStatus, number> = {
  pending: 0,
  delivered: 1,
  bounced: 2,
  complained: 2,
};

/**
 * True when applying `incoming` over `current` would LOSE terminal information,
 * i.e. the write is a downgrade and must be skipped to keep `Delivery status`
 * monotonic. A move to an equal or higher rank (pending→delivered,
 * pending→bounced, delivered→complained) is allowed and returns false.
 */
export function isStatusDowngrade(current: DeliveryStatus, incoming: DeliveryStatus): boolean {
  return STATUS_RANK[incoming] < STATUS_RANK[current];
}

/**
 * How long after an event was created we keep retrying an UNMATCHED Reports
 * lookup. Inside this window an unmatched event is almost always the stampSent
 * race (delivery beat the orchestrator's Airtable write) → 500 so svix retries.
 * Past it the race has resolved, so an unmatched event is a genuine orphan
 * (email sent outside this pipeline, or a deleted Reports row) → 200 to stop
 * svix hammering the function for hours/days.
 */
export const ORPHAN_RETRY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Decide whether an unmatched webhook event should be RETRIED or treated as a
 * terminal orphan. Pure decision extracted from resend-webhook.mts so the
 * race-window aging is unit-tested without booting the handler.
 *
 * - `createdAt` is the event's `created_at` (may be undefined / unparseable).
 * - A missing/unparseable timestamp can't be aged, so we conservatively keep
 *   the retry behaviour ("retry"), exactly as the handler did inline.
 *
 * Returns "retry" (→ 500, svix retries) when within the window, "orphan"
 * (→ 200, stop retrying) once the window has elapsed.
 */
export function classifyUnmatchedEvent(
  createdAt: string | undefined,
  now: number,
  windowMs: number = ORPHAN_RETRY_WINDOW_MS,
): { decision: "retry" | "orphan"; ageMs: number } {
  const createdMs = createdAt ? Date.parse(createdAt) : NaN;
  // Clamp to >= 0: a FUTURE `created_at` (clock skew, spoofed timestamp) would
  // make `now - createdMs` negative, so `ageMs > windowMs` is always false →
  // "retry" stretched out by the full future offset. Treating a future event as
  // age 0 keeps it within the normal retry window instead.
  const ageMs = Number.isNaN(createdMs) ? 0 : Math.max(0, now - createdMs);
  return { decision: ageMs > windowMs ? "orphan" : "retry", ageMs };
}

/**
 * Cap on the stored bounce message (#783).
 *
 * The text is written by the RECEIVING mail server — remote-supplied, arbitrary
 * length — and it lands both in a row we keep forever and in a chip on the
 * dashboard. Bounding it at the boundary where it enters our store is cheaper
 * than trusting every downstream reader to bound it.
 */
export const BOUNCE_MESSAGE_MAX_LEN = 500;

/** A present, non-blank string, else null. A blank `message` is not a diagnosis. */
function nonBlank(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * Parse Resend's bounce classification out of an event's `data` (#783).
 *
 * `email.bounced` carries `data.bounce = { message, subType, type }`; the
 * handler previously read only `data.email_id`, so a Permanent bounce on a dead
 * mailbox and a Transient/ContentRejected rejection by the CLIENT's spam filter
 * were stored identically — and the alarm accused the address in both cases.
 * `email.complained` carries no bounce object at all, so a complaint parses to
 * null rather than to an invented classification.
 *
 * Returns null unless at least ONE of the three fields is a usable string: an
 * empty `bounce: {}` would otherwise store three nulls and make the row LOOK
 * classified when nothing was said. Non-string fields are individually nulled
 * rather than failing the whole parse — this is a third party's wire format, and
 * a shape change must degrade to "no diagnosis", never throw inside a webhook
 * that would then 500 and be redelivered for hours.
 */
export function parseBounceDetail(
  data: Record<string, unknown> | null | undefined,
): BounceDetail | null {
  const bounce = data?.bounce;
  if (typeof bounce !== "object" || bounce === null || Array.isArray(bounce)) return null;
  const b = bounce as Record<string, unknown>;
  const type = nonBlank(b.type);
  const subType = nonBlank(b.subType);
  const rawMessage = nonBlank(b.message);
  if (type === null && subType === null && rawMessage === null) return null;
  return {
    type,
    subType,
    message: rawMessage === null ? null : rawMessage.slice(0, BOUNCE_MESSAGE_MAX_LEN),
  };
}

/**
 * Does this classification mean the ADDRESS itself is bad?
 *
 * True only for Resend's `Permanent`. `Transient` (greylisting, a full mailbox,
 * a content rejection) and `Undetermined` are not evidence of a dead
 * point-of-contact, and neither is an absent or unrecognized type — an unknown
 * value must never be promoted to "the address is dead", which is precisely the
 * wrong diagnosis #783 is about. Case-insensitive so a casing change upstream
 * cannot silently downgrade a real permanent bounce.
 */
export function isPermanentBounce(detail: BounceDetail | null): boolean {
  return detail?.type?.toLowerCase() === "permanent";
}
