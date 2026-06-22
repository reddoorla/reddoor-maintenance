import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import {
  getSubmissionById,
  setSubmissionStatusRow,
} from "../../src/reports/airtable/submissions.js";
import { setSubmissionStatus, verifyBasicAuth } from "../../src/dashboard/index.js";
import { recordMarkedSpam } from "../../src/reports/airtable/screenouts.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// Operator-only state change: same posture as approve-report.mts (CSRF + Basic
// auth + tighter 30/min). Path-routed on the function for the same ctx.params
// reason.
export const config: Config = {
  path: ["/api/submissions/:id/status", "/.netlify/functions/submission-status"],
  rateLimit: {
    windowSize: 60,
    windowLimit: 30,
    aggregateBy: ["ip"],
  },
};

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method === "GET") {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-submission-status",
        env: {
          AIRTABLE_PAT: typeof process.env.AIRTABLE_PAT === "string",
          AIRTABLE_BASE_ID: typeof process.env.AIRTABLE_BASE_ID === "string",
          DASHBOARD_PASSWORD: typeof process.env.DASHBOARD_PASSWORD === "string",
        },
      },
      { status: 200 },
    );
  }
  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);

  if (!isCsrfAllowed(req)) return json({ ok: false, error: "cross-site-rejected" }, 403);

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.error("[submission-status] DASHBOARD_PASSWORD missing");
    return json({ ok: false, error: "unconfigured" }, 503);
  }
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return json({ ok: false, error: "unauthorized" }, 401, {
      "www-authenticate": 'Basic realm="Reddoor fleet"',
    });
  }

  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error("[submission-status] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return json({ ok: false, error: "airtable-env-missing" }, 500);
  }

  const id = ctx.params?.id;
  if (!id) return json({ ok: false, error: "missing-id" }, 400);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid-json" }, 400);
  }
  const requested = (body as { status?: unknown } | null)?.status;

  try {
    const base = openBase({ apiKey, baseId });
    const result = await setSubmissionStatus(
      {
        getSubmissionById: (sid) => getSubmissionById(base, sid),
        setSubmissionStatusRow: (sid, status) => setSubmissionStatusRow(base, sid, status),
        recordMarkedSpam: (siteId) =>
          recordMarkedSpam(base, siteId, new Date().toISOString().slice(0, 10)),
      },
      id,
      requested,
    );
    if (result.status === "not-found") return json(result, 404);
    if (result.status === "invalid") return json(result, 400);
    return json(result, 200);
  } catch (err) {
    return handlerError("submission-status", err);
  }
};
