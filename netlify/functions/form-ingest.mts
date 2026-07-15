import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { getWebsiteBySlug } from "../../src/reports/airtable/websites.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { createSubmission, stampNotified } from "../../src/db/submissions.js";
import { recordScreenOut } from "../../src/db/screenouts.js";
import { ingestSubmission, parseScreenOut, ingestScreenOut } from "../../src/forms/ingest.js";
import { verifyTurnstile } from "../../src/forms/turnstile.js";
import { classifySpam } from "../../src/forms/spam-classifier.js";
import { readMeta } from "../../src/forms/meta.js";
import { forwardNewsletterToWebhook } from "../../src/forms/webhook.js";
import { addMailchimpMember } from "../../src/forms/mailchimp.js";
import { makeNotify } from "../../src/forms/notify.js";
import { verifyFormsToken, bearerToken } from "../../src/forms/token.js";
import { defaultResendClient, type ResendClient } from "../../src/reports/send/resend.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// Public, token-gated ingest. Path-routed on the function (same reason as
// approve-report.mts: a netlify.toml rewrite would hide ctx.params). Server-to-
// server only — the caller is a fleet site's Netlify egress, so per-IP limiting
// is a coarse abuse backstop; real protection is the token + the site-side
// honeypot/timing. (Per-slug limiting is a future enhancement — Netlify's
// rateLimit can't key on a path param.)
export const config: Config = {
  path: ["/api/forms/:slug", "/.netlify/functions/form-ingest"],
  rateLimit: {
    windowSize: 60,
    windowLimit: 120,
    aggregateBy: ["ip"],
  },
};

// Log the unset-secret fail-open path once per warm instance (not per request).
// verifyTurnstile already returns "unverifiable" when the secret is missing, so
// this is an operator breadcrumb only — it never blocks a lead.
let warnedTurnstileUnset = false;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method === "GET") {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-form-ingest",
        env: {
          AIRTABLE_PAT: typeof process.env.AIRTABLE_PAT === "string",
          AIRTABLE_BASE_ID: typeof process.env.AIRTABLE_BASE_ID === "string",
          TURSO_DATABASE_URL: typeof process.env.TURSO_DATABASE_URL === "string",
          RESEND_API_KEY: typeof process.env.RESEND_API_KEY === "string",
          FORMS_INGEST_TOKEN: typeof process.env.FORMS_INGEST_TOKEN === "string",
          TURNSTILE_SECRET_KEY: typeof process.env.TURNSTILE_SECRET_KEY === "string",
        },
      },
      { status: 200 },
    );
  }
  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);

  const expected = process.env.FORMS_INGEST_TOKEN;
  if (!expected) {
    console.error("[form-ingest] FORMS_INGEST_TOKEN missing");
    return json({ ok: false, error: "unconfigured" }, 503);
  }
  const presented =
    req.headers.get("x-forms-token") ?? bearerToken(req.headers.get("authorization"));
  if (!verifyFormsToken(presented, expected)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error("[form-ingest] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return json({ ok: false, error: "airtable-env-missing" }, 500);
  }

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[form-ingest] TURSO_DATABASE_URL missing");
    return json({ ok: false, error: "db-env-missing" }, 500);
  }

  const slug = ctx.params?.slug;
  if (!slug) return json({ ok: false, error: "missing-slug" }, 400);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid-json" }, 400);
  }

  try {
    const base = openBase({ apiKey, baseId });
    const db = await openDb(readDbConfig());

    // Screen-out beacon: a no-PII { _screenOut: honeypot|too-fast } body is routed
    // to the per-site/day Spam Screenouts counter instead of the submission path.
    // (parseScreenOut also accepts the deprecated bare `screenOut` key that older
    // package versions on sites still send.)
    const screenOutReason = parseScreenOut(payload);
    if (screenOutReason) {
      const date = new Date().toISOString().slice(0, 10);
      const r = await ingestScreenOut(
        {
          getWebsiteBySlug: (s) => getWebsiteBySlug(base, s),
          recordScreenOut: (siteId, reason) => recordScreenOut(db, siteId, reason, date),
        },
        slug,
        screenOutReason,
      );
      if (r.status === "unknown-site") return json({ ok: false, error: "unknown-site" }, 404);
      return json({ ok: true }, 200);
    }

    // Construct the Resend client defensively: a missing/broken RESEND_API_KEY
    // must NOT abort ingest (defaultResendClient throws when the key is unset).
    // null send → makeNotify marks the notification failed while the submission
    // is still persisted — capture the lead, never 502 it away.
    let send: ResendClient["send"] | null = null;
    try {
      send = defaultResendClient().send;
    } catch (err) {
      console.error(
        `[form-ingest] Resend unconfigured; submissions captured but not emailed: ${String(err)}`,
      );
    }
    // Tier A — verify the Cloudflare Turnstile token (fail-open). readMeta pulls
    // the forwarded { turnstileToken, clientIp } envelope off the payload (a
    // legacy userAgent from older senders is ignored); the IP is used transiently
    // here (remoteip) and is NEVER persisted. Unset secret / network error /
    // timeout / absent token → "unverifiable" (contributes 0 to the score), so
    // verify never blocks a lead.
    const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
    if (!turnstileSecret && !warnedTurnstileUnset) {
      console.warn(
        "[form-ingest] TURNSTILE_SECRET_KEY unset; Turnstile verification disabled (fail-open)",
      );
      warnedTurnstileUnset = true;
    }
    const meta = readMeta(payload);
    const turnstile = await verifyTurnstile({
      secret: turnstileSecret,
      token: meta.turnstileToken,
      remoteip: meta.clientIp ?? undefined,
    });

    const result = await ingestSubmission(
      {
        getWebsiteBySlug: (s) => getWebsiteBySlug(base, s),
        createSubmission: (input) => createSubmission(db, input),
        notify: makeNotify(send),
        stampNotified: (id, status, messageId) => stampNotified(db, id, status, messageId),
        now: () => new Date(),
        forwardNewsletter: (url, submission, site) =>
          forwardNewsletterToWebhook(url, submission, site),
        addToMailchimp: (site, submission) =>
          addMailchimpMember({
            apiKey: site.mailchimpApiKey ?? "",
            audienceId: site.mailchimpAudienceId ?? "",
            email: submission.email,
            name: submission.name,
          }),
        // Tier B — pure heuristic classifier folded into the ingest decision.
        // ingestSubmission calls this with the SAME Turnstile outcome (the 4th
        // arg below) and derives status (+ requireTurnstile escalation, read off
        // the resolved site — no per-handler wiring needed).
        classifySpam: (n, outcome) =>
          classifySpam({
            name: n.name,
            email: n.email,
            // message is optional on NormalizedSubmission; exactOptionalPropertyTypes
            // forbids passing `undefined`, so spread only when present.
            ...(n.message !== undefined ? { message: n.message } : {}),
            formType: n.formType,
            extraFields: n.extraFields,
            turnstile: outcome,
          }),
      },
      slug,
      payload,
      turnstile,
    );

    if (result.status === "unknown-site") return json({ ok: false, error: "unknown-site" }, 404);
    if (result.status === "rejected")
      return json({ ok: false, error: "invalid-payload", details: result.errors }, 400);
    // notifyStatus deliberately NOT echoed here: it deterministically reads
    // "skipped" for auto-spam, which is a weak spam oracle a bot could poll to
    // learn whether it was flagged. Keep the response minimal.
    return json({ ok: true, id: result.submissionId }, 200);
  } catch (err) {
    return handlerError("form-ingest", err);
  }
};
