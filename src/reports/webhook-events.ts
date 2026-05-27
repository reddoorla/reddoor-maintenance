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
};
