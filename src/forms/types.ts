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
