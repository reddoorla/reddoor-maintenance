import { SUBMISSION_FORM_TYPES, type FormType } from "../forms/types.js";

export { SUBMISSION_FORM_TYPES };
export type { FormType };

export const SUBMISSION_STATUSES = ["new", "read", "archived", "spam", "spam_auto"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

// "bounced" (2026-07-16): Resend ACCEPTED the notification ("sent") but later
// reported a bounce/complaint via webhook — the lead never reached the client
// (the Espada failure mode: 4 of 8 notifications bounced with nothing alarming).
// The resend-webhook maps the event back onto the submission by resend_message_id.
export const NOTIFY_STATUSES = ["sent", "failed", "skipped", "bounced"] as const;
export type NotifyStatus = (typeof NOTIFY_STATUSES)[number];

export function toFormType(raw: string | undefined): FormType {
  if (raw && (SUBMISSION_FORM_TYPES as readonly string[]).includes(raw)) return raw as FormType;
  if (raw)
    console.warn(`[submissions] unknown Form type ${JSON.stringify(raw)} — treating as contact`);
  return "contact";
}

export function toStatus(raw: string | undefined): SubmissionStatus {
  if (raw && (SUBMISSION_STATUSES as readonly string[]).includes(raw))
    return raw as SubmissionStatus;
  return "new";
}

export function toNotifyStatus(raw: string | undefined): NotifyStatus {
  if (raw && (NOTIFY_STATUSES as readonly string[]).includes(raw)) return raw as NotifyStatus;
  return "skipped";
}

export type SubmissionRow = {
  id: string;
  submissionId: number | null;
  siteId: string;
  formType: FormType;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  /** Raw JSON string of any site-specific fields the typed columns didn't claim. */
  extraFields: string | null;
  sourceUrl: string | null;
  utm: string | null;
  submittedAt: string | null;
  status: SubmissionStatus;
  notifyStatus: NotifyStatus;
  resendMessageId: string | null;
  /** Heuristic spam score at ingest time; null for pre-classifier / un-scored rows. */
  spamScore?: number | null;
  /** Comma-joined classifier reason codes (e.g. "links:3,disposable-email"); null when unscored. */
  spamReason?: string | null;
  /** Comma-joined newsletter fan-out outcome per destination — `webhook:ok`,
   *  `mailchimp:401`, `mailchimp:threw`, `mailchimp-tags:failed`. Null means nothing
   *  was attempted: a non-newsletter form, a spam row, a site with no destination
   *  configured, or a row written before 0005. See ingest.ts for the token grammar. */
  fanoutStatus?: string | null;
  /** Resend's bounce classification, kept so a content rejection by the CLIENT's
   *  mail filter can be told apart from a dead mailbox (#783). Null for a
   *  complaint, and for every row written before migration 0018. */
  bounceType?: string | null;
  bounceSubType?: string | null;
  bounceMessage?: string | null;
  /** ISO-8601 of the operator saying "this address is not dead" (#783). The row
   *  keeps its bounce record and stops counting toward the alarm. */
  bounceAckAt?: string | null;
};

/** The bounce classification as STORED — the shape `data.bounce` is parsed into
 *  (see `parseBounceDetail` in webhook-events.ts, which owns the wire format).
 *  Lives here, with the rest of the submission's notify vocabulary, so the db
 *  layer never has to import the webhook module to name it. */
export type BounceDetail = {
  type: string | null;
  subType: string | null;
  message: string | null;
};

export type SubmissionInput = {
  siteId: string;
  formType: FormType;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  extraFields?: Record<string, unknown>;
  sourceUrl?: string;
  utm?: string;
  submittedAt: Date;
  status?: SubmissionStatus;
  spamScore?: number | null;
  spamReason?: string | null;
};
