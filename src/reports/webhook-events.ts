import type { DeliveryStatus } from "./airtable/reports.js";

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
