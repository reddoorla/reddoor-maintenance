import { SUBMISSION_FORM_TYPES, type FormType } from "./types.js";
import type { SubmissionMeta } from "./meta.js";

/** The JSON wire format a fleet site forwards to the ingest endpoint.
 *
 *  Underscore-prefixed keys are RESERVED for transport concerns and are never
 *  lead data: `_meta` (below) and `_screenOut` (the bot screen-out beacon —
 *  a `{ _screenOut: "honeypot" | "too-fast" }` body is a counter ping, not a
 *  submission; see ingest.ts `parseScreenOut`). Site field names must not
 *  start with `_`. */
export type SubmissionPayload = {
  formType?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  message?: string;
  sourceUrl?: string;
  utm?: string;
  /** Any additional, site-specific fields. */
  extra?: Record<string, unknown>;
  /** Reserved transport envelope (token/IP/UA); stripped by normalizeSubmission, never persisted. */
  _meta?: SubmissionMeta;
};

export type NormalizedSubmission = {
  formType: FormType;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  sourceUrl?: string;
  utm?: string;
  extraFields: Record<string, unknown>;
};

export type NormalizeResult =
  | { ok: true; value: NormalizedSubmission }
  | { ok: false; errors: string[] };

const KNOWN_KEYS = new Set([
  "formType",
  "name",
  "firstName",
  "lastName",
  "email",
  "phone",
  "message",
  "sourceUrl",
  "utm",
  "extra",
  "_meta",
]);

// Keys that, copied as own-properties into the captured object, could surprise a
// downstream consumer (template/DB layer). This is an untrusted boundary, so the
// extraFields merge drops them rather than trusting the caller.
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Resolve the submission's formType. An ABSENT/blank value defaults to "contact"
 * (the long-standing minimal-form contract). A PRESENT but unrecognized value
 * (e.g. a typo'd "news") returns null → the caller rejects it, rather than
 * silently storing it as contact — which would, for a newsletter signup, drop the
 * Mailchimp fan-out. Mirrors createIngestEndpoint's reject-invalid behavior.
 */
function resolveFormType(raw: unknown): FormType | null {
  const s = str(raw);
  if (s === "") return "contact";
  return (SUBMISSION_FORM_TYPES as readonly string[]).includes(s) ? (s as FormType) : null;
}

/**
 * Defensively normalize an untrusted ingest payload into typed fields. Folds
 * name/first+last, lowercases email, and dumps every unclaimed key into
 * extraFields so no site-specific data is lost. Rejects only when there's
 * nothing to act on (no email AND no message) or a present email is malformed.
 */
export function normalizeSubmission(payload: unknown): NormalizeResult {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, errors: ["payload must be a JSON object"] };
  }
  const p = payload as Record<string, unknown>;
  const name = str(p.name) || [str(p.firstName), str(p.lastName)].filter(Boolean).join(" ");
  const email = str(p.email).toLowerCase();
  const message = str(p.message);

  const formType = resolveFormType(p.formType);
  const errors: string[] = [];
  if (!email && !message) errors.push("at least one of email or message is required");
  if (email && !EMAIL_RE.test(email)) errors.push("email is not a valid address");
  if (formType === null) errors.push("formType is not a recognized form type");
  // The `|| formType === null` is redundant for control flow (the push above
  // already made errors non-empty) but narrows formType to FormType past this line.
  if (errors.length > 0 || formType === null) return { ok: false, errors };

  const extraFields: Record<string, unknown> = {};
  const extra = p.extra;
  if (typeof extra === "object" && extra !== null) {
    for (const [k, v] of Object.entries(extra)) {
      if (!DANGEROUS_KEYS.has(k)) extraFields[k] = v;
    }
  }
  for (const [k, v] of Object.entries(p)) {
    if (!KNOWN_KEYS.has(k) && !DANGEROUS_KEYS.has(k)) extraFields[k] = v;
  }

  const value: NormalizedSubmission = {
    formType,
    name,
    email,
    extraFields,
  };
  const phone = str(p.phone);
  if (phone) value.phone = phone;
  if (message) value.message = message;
  const sourceUrl = str(p.sourceUrl);
  if (sourceUrl) value.sourceUrl = sourceUrl;
  const utm = str(p.utm);
  if (utm) value.utm = utm;
  return { ok: true, value };
}
