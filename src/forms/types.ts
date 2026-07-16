/**
 * Form-type enum, kept in a leaf module (no Airtable/Resend imports) so it can
 * be shared with fleet sites via the `@reddoorla/maintenance/forms` subpath
 * without dragging server SDKs into a site bundle.
 */
export const SUBMISSION_FORM_TYPES = [
  "contact",
  "inquiry",
  "newsletter",
  "rsvp",
  "reserve",
] as const;
export type FormType = (typeof SUBMISSION_FORM_TYPES)[number];

/** Signup-style forms (mailing list / event RSVPs). NOT actionable leads, so
 *  operator-facing unread counts surface them separately (2026-07-16). Lead-ness
 *  is derived by EXCLUSION so a future form type defaults to "lead" (fail-visible). */
export const SIGNUP_FORM_TYPES = ["newsletter", "rsvp"] as const;
export function isLeadFormType(t: FormType): boolean {
  return !(SIGNUP_FORM_TYPES as readonly string[]).includes(t);
}
