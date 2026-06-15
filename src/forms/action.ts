import { fail, type ActionFailure, type RequestEvent } from "@sveltejs/kit";
import { submitToIngest, screenSubmission, type SubmissionPayload } from "./client.js";

/** Endpoint + token for the dashboard ingest, read per-request from site env. */
export type IngestActionConfig = { url?: string; token?: string };

export type CreateIngestActionOptions = {
  /** Stamped onto every payload as `formType` (a SUBMISSION_FORM_TYPES value). */
  formType: string;
  /** Read at call time so SvelteKit's dynamic private env resolves per-request. */
  getConfig: () => IngestActionConfig;
  /** Map this form's fields to a payload. `formType` is injected by the factory. */
  buildPayload: (form: FormData, event: RequestEvent) => SubmissionPayload;
  /** Honeypot input name. Default "bot-field". */
  botFieldName?: string;
  /** Hidden timestamp input name (planted in `load`). Default "ts". */
  tsFieldName?: string;
  /** fail(500) copy when env vars are unset. */
  unavailableMessage?: string;
  /** fail(502) copy when the ingest endpoint rejects/errors. */
  errorMessage?: string;
  /** Injectable clock for tests. Default Date.now. */
  now?: () => number;
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
  const now = opts.now ?? Date.now;
  const unavailable =
    opts.unavailableMessage ?? "This form is temporarily unavailable. Please email us directly.";
  const failed =
    opts.errorMessage ?? "Something went wrong sending your message. Please try again.";

  return async (event) => {
    const form = await event.request.formData();

    // Bot screen: a filled honeypot OR an implausibly fast fill is silently
    // accepted (return success, do NOT forward) so bots get no signal.
    const screen = screenSubmission({
      botField: form.get(botFieldName)?.toString() ?? null,
      elapsedMs: elapsedMs(form.get(tsFieldName), now),
    });
    if (!screen.ok) return { success: true };

    const { url, token } = opts.getConfig();
    if (!url || !token) return fail(500, { error: unavailable });

    const result = await submitToIngest({
      url,
      token,
      fetch: event.fetch,
      payload: { formType: opts.formType, ...opts.buildPayload(form, event) },
    });
    if (!result.ok) return fail(502, { error: failed });
    return { success: true };
  };
}

// `FormDataEntryValue` is a DOM-lib global; this package compiles with only the
// ES2022 lib + @types/node, where it is not in scope. Derive the type from the
// in-scope `FormData.get` return instead — same value, no DOM-lib dependency.
function elapsedMs(tsRaw: ReturnType<FormData["get"]>, now: () => number): number | null {
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return now() - ts;
}
