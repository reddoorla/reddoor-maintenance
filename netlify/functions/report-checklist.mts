import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import {
  getReportById as getReportByIdAirtable,
  setReportChecklistItem,
} from "../../src/reports/airtable/reports.js";
import { setChecklistItem, verifyBasicAuth } from "../../src/dashboard/index.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// Path-route the customer-facing /api/reports/:id/checklist on the function
// itself (same reason as approve-report.mts / site-dashboard.mts: a
// netlify.toml [[redirects]] 200 rewrite hands the function the ORIGINAL
// request URL, so ctx.params would be empty). The record id arrives in
// ctx.params.id.
export const config: Config = {
  path: ["/api/reports/:id/checklist", "/.netlify/functions/report-checklist"],
  // Same tighter posture as approve-report.mts: a state-changing POST behind
  // ambient Basic-auth creds.
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
  // GET health check — presence-only, mirrors approve-report.mts so an operator
  // can curl after wiring env vars. Never reports env values.
  if (req.method === "GET") {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-report-checklist",
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

  // CSRF defense before auth — same posture as approve-report.mts: this is a
  // state-changing endpoint reachable with the ambient Basic-auth creds the
  // browser replays cross-site.
  if (!isCsrfAllowed(req)) return json({ ok: false, error: "cross-site-rejected" }, 403);

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.error("[report-checklist] DASHBOARD_PASSWORD missing");
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
    console.error("[report-checklist] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return json({ ok: false, error: "airtable-env-missing" }, 500);
  }

  // The id can arrive in ctx.params (path-routed) or in the JSON body; prefer
  // the path param (matches the approve endpoint), fall back to the body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid-json" }, 400);
  }
  const b = (body as { reportId?: unknown; field?: unknown; value?: unknown } | null) ?? {};
  const id = ctx.params?.id ?? (typeof b.reportId === "string" ? b.reportId : undefined);
  if (!id) return json({ ok: false, error: "missing-id" }, 400);
  const field = typeof b.field === "string" ? b.field : "";
  const value = b.value === true;

  try {
    const base = openBase({ apiKey, baseId });
    const result = await setChecklistItem(
      {
        getReportById: (rid) => getReportByIdAirtable(base, rid),
        setReportChecklistItem: (rid, fld, val) => setReportChecklistItem(base, rid, fld, val),
      },
      id,
      field,
      value,
    );
    if (result.status === "bad-field") return json({ ok: false, error: "bad-field" }, 400);
    if (result.status === "not-found") return json({ ok: false, error: "not-found" }, 404);
    return json({ ok: true, complete: result.complete }, 200);
  } catch (err) {
    return handlerError("report-checklist", err);
  }
};
