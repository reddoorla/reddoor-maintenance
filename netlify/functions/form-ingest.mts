import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { getWebsiteBySlug } from "../../src/reports/airtable/websites.js";
import { createSubmission, stampNotified } from "../../src/reports/airtable/submissions.js";
import { ingestSubmission } from "../../src/forms/ingest.js";
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
          RESEND_API_KEY: typeof process.env.RESEND_API_KEY === "string",
          FORMS_INGEST_TOKEN: typeof process.env.FORMS_INGEST_TOKEN === "string",
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
    const result = await ingestSubmission(
      {
        getWebsiteBySlug: (s) => getWebsiteBySlug(base, s),
        createSubmission: (input) => createSubmission(base, input),
        notify: makeNotify(send),
        stampNotified: (id, status, messageId) => stampNotified(base, id, status, messageId),
        now: () => new Date(),
      },
      slug,
      payload,
    );

    if (result.status === "unknown-site") return json({ ok: false, error: "unknown-site" }, 404);
    if (result.status === "rejected")
      return json({ ok: false, error: "invalid-payload", details: result.errors }, 400);
    return json({ ok: true, id: result.submissionId, notify: result.notifyStatus }, 200);
  } catch (err) {
    return handlerError("form-ingest", err);
  }
};
