import { SUBMISSION_FORM_TYPES, type FormType } from "./types.js";

/**
 * The JSON a fleet site forwards to the dashboard ingest endpoint. Typed fields
 * are optional; the index signature lets a site include its own extra fields
 * (e.g. `company`) which the dashboard normalizer captures into `extraFields`.
 *
 * Each typed field allows `string | undefined` (not just `string`) so a
 * `buildPayload` mapping can use the idiomatic `form.get("name")?.toString()`
 * pattern under `exactOptionalPropertyTypes` without a cast — an absent field
 * and an explicit `undefined` both serialize away in the JSON body.
 */
export type SubmissionPayload = {
  formType?: FormType | string | undefined;
  name?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  message?: string | undefined;
  sourceUrl?: string | undefined;
  utm?: string | undefined;
  [key: string]: unknown;
};

export type IngestClientResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string };

export type SubmitToIngestOptions = {
  /** Full ingest endpoint incl. the site slug, e.g. https://…/api/forms/reddoor */
  url: string;
  /** The shared FORMS_INGEST_TOKEN. */
  token: string;
  payload: SubmissionPayload;
  /** Injectable fetch (pass SvelteKit's `event.fetch`); defaults to global fetch. */
  fetch?: typeof fetch;
};

/**
 * Forward a submission to the dashboard ingest endpoint. Never throws — a network
 * failure or a non-2xx response is returned as `{ ok: false }` so the caller can
 * show a friendly error rather than a 500.
 */
export async function submitToIngest(opts: SubmitToIngestOptions): Promise<IngestClientResult> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(opts.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forms-token": opts.token },
      body: JSON.stringify(opts.payload),
    });
  } catch (err) {
    return { ok: false, status: 0, error: `network error: ${String(err)}` };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON response — fall through to the error path
  }
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (res.ok && obj && obj.ok === true) {
    return { ok: true, id: String(obj.id ?? "") };
  }
  const error = obj && typeof obj.error === "string" ? obj.error : `ingest failed (${res.status})`;
  return { ok: false, status: res.status, error };
}

export type ScreenInput = { botField?: string | null; elapsedMs?: number | null };
export type ScreenResult = { ok: true } | { ok: false; reason: "honeypot" | "too-fast" };

/**
 * Minimum plausible fill time; faster than this reads as a bot. Kept low (800ms)
 * on purpose: a too-fast fill is dropped *silently* (the visitor sees success),
 * so a real human who happens to be quick — autofill, a short form, a returning
 * visitor — would lose their lead with no trace. Below this, a submit is
 * effectively instant (page render → fill → click → network all under ~0.8s),
 * which a human realistically never beats but a script does. The honeypot is the
 * primary bot signal; this is the secondary one, so it errs toward letting
 * borderline-fast humans through.
 */
export const MIN_FILL_MS = 800;

/**
 * Cheap bot screen for the site action. A filled honeypot is a bot; a submission
 * faster than MIN_FILL_MS is a bot. Missing timing data (null) is NOT a rejection
 * — a prerendered/cached page can't plant a fresh timestamp, and the honeypot
 * remains the primary signal.
 */
export function screenSubmission(input: ScreenInput): ScreenResult {
  if (typeof input.botField === "string" && input.botField.trim().length > 0) {
    return { ok: false, reason: "honeypot" };
  }
  if (
    typeof input.elapsedMs === "number" &&
    input.elapsedMs >= 0 &&
    input.elapsedMs < MIN_FILL_MS
  ) {
    return { ok: false, reason: "too-fast" };
  }
  return { ok: true };
}

export { SUBMISSION_FORM_TYPES, type FormType };
