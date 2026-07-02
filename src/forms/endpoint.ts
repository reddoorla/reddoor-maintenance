import { json, type RequestEvent } from "@sveltejs/kit";
import {
  submitToIngest,
  screenSubmission,
  submitScreenOut,
  type SubmissionPayload,
} from "./client.js";
import { SUBMISSION_FORM_TYPES, type FormType } from "./types.js";
import type { IngestActionConfig } from "./action.js";
import { buildSubmissionMeta } from "./meta.js";

/**
 * Options for {@link createIngestEndpoint} — the JSON sibling of
 * `createIngestAction` for client-driven forms (modals / lightboxes / fetch)
 * that POST JSON to a `+server.ts` route instead of using a form action.
 */
export type CreateIngestEndpointOptions = {
  /** Read at call time so SvelteKit's dynamic private env resolves per-request. */
  getConfig: () => IngestActionConfig;
  /**
   * Map the parsed JSON body to a payload. Must set `formType` UNLESS the fixed
   * `formType` option is provided (then that is authoritative and overrides it).
   */
  buildPayload: (body: Record<string, unknown>, event: RequestEvent) => SubmissionPayload;
  /** Fixed formType for single-type endpoints; omit for multi-type endpoints
   *  where `buildPayload` derives formType from the body. */
  formType?: string;
  /** Honeypot field name in the JSON body. Default "bot-field". */
  botFieldName?: string;
  /** Field carrying the Cloudflare Turnstile token. Default "cf-turnstile-response". */
  turnstileFieldName?: string;
  /** json(500) copy when env vars are unset. */
  unavailableMessage?: string;
  /** json(400/502) copy for bad input / ingest failure. */
  errorMessage?: string;
};

function isFormType(v: unknown): v is FormType {
  return typeof v === "string" && (SUBMISSION_FORM_TYPES as readonly string[]).includes(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * Build a JSON `POST` handler that screens for bots, forwards the submission to
 * the dashboard ingest endpoint, and returns `{ ok }`-shaped JSON. The per-form
 * field mapping (`buildPayload`) is the only thing a site must supply. The
 * returned function is structurally a SvelteKit `RequestHandler`.
 */
export function createIngestEndpoint(
  opts: CreateIngestEndpointOptions,
): (event: RequestEvent) => Promise<Response> {
  const botFieldName = opts.botFieldName ?? "bot-field";
  const turnstileFieldName = opts.turnstileFieldName ?? "cf-turnstile-response";
  const unavailable =
    opts.unavailableMessage ?? "This form is temporarily unavailable. Please email us directly.";
  const failed =
    opts.errorMessage ?? "Something went wrong sending your message. Please try again.";

  return async (event) => {
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await event.request.json();
      if (!parsed || typeof parsed !== "object") throw new Error("body is not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      console.error("[forms-ingest] could not parse JSON body");
      return json({ ok: false, error: failed }, { status: 400 });
    }

    // Bot screen: honeypot only. A client POST carries no server-planted ts, and
    // screenSubmission treats a missing elapsedMs as OK. A filled honeypot is
    // silently accepted (return ok, do NOT forward) so bots get no signal.
    const screen = screenSubmission({ botField: str(body[botFieldName]) ?? null });
    if (!screen.ok) {
      // Best-effort screen-out beacon (no PII) so catch-rate is observable, then
      // return success exactly as before — the bot/visitor still sees success.
      const cfg = opts.getConfig();
      if (cfg.url && cfg.token) {
        await submitScreenOut({
          url: cfg.url,
          token: cfg.token,
          reason: screen.reason,
          fetch: event.fetch,
        });
      }
      return json({ ok: true });
    }

    // buildPayload runs on untrusted JSON; a careless field access (e.g.
    // `body.name.trim()` on a non-string) would otherwise escape as a 500. Treat
    // a throw as a malformed request (400), keeping the "never 500s" guarantee.
    let payload: SubmissionPayload;
    try {
      payload = {
        ...opts.buildPayload(body, event),
        ...(opts.formType ? { formType: opts.formType } : {}),
        _meta: buildSubmissionMeta(event, str(body[turnstileFieldName])),
      };
    } catch (err) {
      console.error(`[forms-ingest] buildPayload threw: ${String(err)}`);
      return json({ ok: false, error: failed }, { status: 400 });
    }
    if (!isFormType(payload.formType)) {
      console.error(`[forms-ingest] invalid formType: ${String(payload.formType)}`);
      return json({ ok: false, error: failed }, { status: 400 });
    }

    const { url, token } = opts.getConfig();
    if (!url || !token) {
      console.error(`[forms-ingest] config missing for formType=${payload.formType}`);
      return json({ ok: false, error: unavailable }, { status: 500 });
    }

    const result = await submitToIngest({ url, token, fetch: event.fetch, payload });
    if (!result.ok) {
      console.error(`[forms-ingest] ${payload.formType} → ${result.status}: ${result.error}`);
      return json({ ok: false, error: failed }, { status: 502 });
    }
    return json({ ok: true });
  };
}
