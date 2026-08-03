import { SUBMISSION_FORM_TYPES, type FormType } from "./types.js";
import type { SubmissionMeta } from "./meta.js";

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
  /** Reserved transport envelope (token/IP/UA); stripped centrally, never persisted. */
  _meta?: SubmissionMeta | undefined;
  [key: string]: unknown;
};

export type IngestClientResult =
  { ok: true; id: string } | { ok: false; status: number; error: string };

export type SubmitToIngestOptions = {
  /** Full ingest endpoint incl. the site slug, e.g. https://…/api/forms/reddoor */
  url: string;
  /** The shared FORMS_INGEST_TOKEN. */
  token: string;
  payload: SubmissionPayload;
  /** Injectable fetch (pass SvelteKit's `event.fetch`); defaults to global fetch. */
  fetch?: typeof fetch;
  /** Abort budget for the central call. Default INGEST_TIMEOUT_MS. */
  timeoutMs?: number;
};

/** Default abort budget for the site→central ingest call. A central function hung
 *  mid-deploy otherwise leaves the visitor's submit awaiting until Netlify kills
 *  the SITE function at its sync limit — a broken response instead of the
 *  friendly error copy (espada's 2026-07-10 form-e2e warns caught exactly this).
 *
 *  ABORTING TOO EARLY IS THE WORSE FAILURE, because central persists the lead
 *  BEFORE its best-effort tail (notify → stamp → fan-out, see ingest.ts): once
 *  the row exists the lead is captured, so a client-side abort reports failure
 *  for a submission that is already saved AND emailed. Observed on 1836dig
 *  2026-08-03: row `sub_f4f195ff` stored, operator email delivered, and the
 *  visitor still got the failure copy — the visitor's only signal says the
 *  opposite of the truth, and a retry duplicates the lead.
 *
 *  The old 8s was calibrated against a 10s Netlify sync limit; the envelope is
 *  now 30s (`SYNCHRONOUS_FUNCTION_TIMEOUT`), so that headroom argument no
 *  longer binds. It also did not clear a COLD central call: measured
 *  2026-08-03, cold start ~1.9s + Airtable slug lookup ~2.4s + Turso
 *  open/migrate + insert + Resend ~0.8s lands at ~5-7s, leaving 8s with no real
 *  margin. 20s is ~3x that path and still leaves 10s of the envelope for the
 *  action to render. A visitor waiting is recoverable; a visitor wrongly told
 *  their message was lost is not. */
export const INGEST_TIMEOUT_MS = 20_000;

/**
 * Forward a submission to the dashboard ingest endpoint. Never throws — a network
 * failure or a non-2xx response is returned as `{ ok: false }` so the caller can
 * show a friendly error rather than a 500.
 */
export async function submitToIngest(opts: SubmitToIngestOptions): Promise<IngestClientResult> {
  const doFetch = opts.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? INGEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await doFetch(opts.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forms-token": opts.token },
      body: JSON.stringify(opts.payload),
      signal: controller.signal,
    });
  } catch (err) {
    return { ok: false, status: 0, error: `network error: ${String(err)}` };
  } finally {
    clearTimeout(timer);
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

export type SubmitScreenOutOptions = {
  /** Same ingest endpoint the site already posts submissions to. */
  url: string;
  token: string;
  reason: "honeypot" | "too-fast";
  fetch?: typeof fetch;
  /** Abort budget so a slow/hung beacon can't delay the (already-successful) response. */
  timeoutMs?: number;
};

/**
 * Best-effort screen-out beacon: tells the central ingest "a bot was screened here"
 * (no PII) so caught-vs-delivered is observable. Never throws — a failure is returned
 * as { ok: false } and the caller ignores it (the visitor already saw success).
 */
export async function submitScreenOut(
  opts: SubmitScreenOutOptions,
): Promise<{ ok: boolean; status: number }> {
  const doFetch = opts.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 1500);
  try {
    const res = await doFetch(opts.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forms-token": opts.token },
      // `_screenOut` is a reserved wire key (underscore-namespaced like `_meta`)
      // so a site's real form field named "screenOut" can never read as a beacon.
      body: JSON.stringify({ _screenOut: opts.reason }),
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
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
 * faster than MIN_FILL_MS is a bot. Missing timing data (null/undefined) is NOT a
 * rejection — a prerendered/cached page can't plant a fresh timestamp, and the
 * honeypot remains the primary signal.
 *
 * Any numeric elapsed BELOW the floor — including a NEGATIVE value — is too-fast. A
 * negative elapsed time is impossible for a real fill: it means the client posted a
 * FUTURE timestamp. The earlier `>= 0` guard let that slip through (negative skipped
 * the `< MIN_FILL_MS` branch and returned ok), silently bypassing the timing gate.
 */
export function screenSubmission(input: ScreenInput): ScreenResult {
  if (typeof input.botField === "string" && input.botField.trim().length > 0) {
    return { ok: false, reason: "honeypot" };
  }
  if (typeof input.elapsedMs === "number" && input.elapsedMs < MIN_FILL_MS) {
    return { ok: false, reason: "too-fast" };
  }
  return { ok: true };
}

export { SUBMISSION_FORM_TYPES, type FormType };
