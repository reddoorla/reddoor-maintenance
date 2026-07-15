import { fail, redirect, type ActionFailure, type RequestEvent } from "@sveltejs/kit";
import {
  submitToIngest,
  screenSubmission,
  submitScreenOut,
  type SubmissionPayload,
} from "./client.js";
import { buildSubmissionMeta } from "./meta.js";

/** Endpoint + token for the dashboard ingest, read per-request from site env. */
export type IngestActionConfig = { url?: string; token?: string };

export type CreateIngestActionOptions = {
  /** Stamped onto every payload as `formType` (a SUBMISSION_FORM_TYPES value). */
  formType: string;
  /** Read at call time so SvelteKit's dynamic private env resolves per-request. */
  getConfig: () => IngestActionConfig;
  /**
   * Map this form's fields to a payload. The factory's `formType` is always
   * authoritative and cannot be overridden by `buildPayload`.
   */
  buildPayload: (form: FormData, event: RequestEvent) => SubmissionPayload;
  /** Honeypot input name. Default "bot-field". */
  botFieldName?: string;
  /** Hidden timestamp input name (planted in `load`). Default "ts". */
  tsFieldName?: string;
  /** Field carrying the Cloudflare Turnstile token. Default "cf-turnstile-response". */
  turnstileFieldName?: string;
  /** fail(500) copy when env vars are unset. */
  unavailableMessage?: string;
  /** fail(502) copy when the ingest endpoint rejects/errors. */
  errorMessage?: string;
  /** Injectable clock for tests. Default Date.now. */
  now?: () => number;
  /** If set, a successful OR bot-screened submission throws redirect(303, redirectTo)
   *  instead of returning {success:true} (e.g. a dedicated /thank-you page). */
  redirectTo?: string;
};

export type IngestActionData = { success: true } | ActionFailure<{ error: string }>;

/**
 * Build a SvelteKit `default` form action that screens for bots, forwards the
 * submission to the dashboard ingest endpoint, and returns SvelteKit-shaped
 * results. The per-form field mapping is the only thing a site must supply.
 */
export function createIngestAction(
  opts: CreateIngestActionOptions,
): (event: RequestEvent) => Promise<IngestActionData> {
  const botFieldName = opts.botFieldName ?? "bot-field";
  const tsFieldName = opts.tsFieldName ?? "ts";
  const turnstileFieldName = opts.turnstileFieldName ?? "cf-turnstile-response";
  const now = opts.now ?? Date.now;
  const unavailable =
    opts.unavailableMessage ?? "This form is temporarily unavailable. Please email us directly.";
  const failed =
    opts.errorMessage ?? "Something went wrong sending your message. Please try again.";

  return async (event) => {
    let form: FormData;
    try {
      form = await event.request.formData();
    } catch {
      console.error(`[forms-ingest] ${opts.formType}: could not parse form body`);
      return fail(400, { error: failed });
    }

    // Bot screen: a filled honeypot OR an implausibly fast fill is silently
    // accepted (return success, do NOT forward) so bots get no signal.
    const screen = screenSubmission({
      botField: form.get(botFieldName)?.toString() ?? null,
      elapsedMs: elapsedMs(form.get(tsFieldName), now),
    });
    if (!screen.ok) {
      // Best-effort screen-out beacon (no PII) so catch-rate is observable, then
      // succeed exactly as before — the bot/visitor still sees success.
      const cfg = opts.getConfig();
      if (cfg.url && cfg.token) {
        await submitScreenOut({
          url: cfg.url,
          token: cfg.token,
          reason: screen.reason,
          fetch: event.fetch,
        });
      }
      return succeed();
    }

    const { url, token } = opts.getConfig();
    if (!url || !token) {
      console.error(`[forms-ingest] config missing for formType=${opts.formType}`);
      return fail(500, { error: unavailable });
    }

    // buildPayload runs on untrusted form data; a careless field access (e.g.
    // `form.get("email")!.toString()` on an absent field) would otherwise escape
    // as an uncaught 500. Treat a throw as a malformed request (400), mirroring
    // endpoint.ts's guard and its "never 500s" guarantee.
    let payload: SubmissionPayload;
    try {
      payload = {
        ...opts.buildPayload(form, event),
        formType: opts.formType,
        _meta: buildSubmissionMeta(event, form.get(turnstileFieldName)?.toString()),
      };
    } catch (err) {
      console.error(`[forms-ingest] ${opts.formType}: buildPayload threw: ${String(err)}`);
      return fail(400, { error: failed });
    }

    const result = await submitToIngest({
      url,
      token,
      fetch: event.fetch,
      payload,
    });
    if (!result.ok) {
      console.error(`[forms-ingest] ${opts.formType} → ${result.status}: ${result.error}`);
      return fail(502, { error: failed });
    }
    return succeed();
  };

  // Single success path: redirect when configured (e.g. a dedicated /thank-you
  // page), otherwise return the SvelteKit-shaped success. `redirect()` throws, so
  // the trailing `return` keeps the `{ success: true }` type.
  function succeed(): { success: true } {
    if (opts.redirectTo) redirect(303, opts.redirectTo);
    return { success: true };
  }
}

// `FormDataEntryValue` is a DOM-lib global; this package compiles with only the
// ES2022 lib + @types/node, where it is not in scope. Derive the type from the
// in-scope `FormData.get` return instead — same value, no DOM-lib dependency.
function elapsedMs(tsRaw: ReturnType<FormData["get"]>, now: () => number): number | null {
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  // Clamp at 0: elapsed time can't be negative. A future `ts` (clock skew or a bot
  // forging one) would otherwise yield a negative value; clamping makes it read as
  // 0ms (effectively instant) so the MIN_FILL_MS gate still trips. Defense-in-depth
  // with screenSubmission, which also treats any sub-floor elapsed as too-fast.
  return Math.max(0, now() - ts);
}
