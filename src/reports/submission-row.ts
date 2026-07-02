import { SUBMISSION_FORM_TYPES, type FormType } from "../forms/types.js";

export { SUBMISSION_FORM_TYPES };
export type { FormType };

export const SUBMISSION_STATUSES = ["new", "read", "archived", "spam", "spam_auto"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const NOTIFY_STATUSES = ["sent", "failed", "skipped"] as const;
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
