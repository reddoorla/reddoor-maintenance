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
