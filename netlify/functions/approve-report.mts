import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import {
  getReportById as getReportByIdAirtable,
  approveReportRow,
  overrideReportRow,
} from "../../src/reports/airtable/reports.js";
import { approveReport, verifyBasicAuth } from "../../src/dashboard/index.js";
import { listWebsites } from "../../src/reports/airtable/websites.js";
import { approveBlockers, formatBlockers } from "../../src/reports/preflight.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// Path-route the customer-facing /api/reports/:id/approve on the function
// itself (same reason as site-dashboard.mts: a netlify.toml [[redirects]] 200
// rewrite hands the function the ORIGINAL request URL, not the rewritten one —
// so ctx.params would be empty for every request). With function-level path
// routing the record id arrives in ctx.params.id.
export const config: Config = {
  path: ["/api/reports/:id/approve", "/.netlify/functions/approve-report"],
  // Tighter than the read-only dashboards (fleet-homepage is 60/min): this is a
  // state-changing POST behind ambient Basic-auth creds, so cap it harder.
  rateLimit: {
    windowSize: 60,
    windowLimit: 30,
    aggregateBy: ["ip"],
  },
};

function plainText(
  body: string,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...extraHeaders },
  });
}

// CSRF helpers (isCsrfAllowed / requestHost / originHost) now live in
// src/dashboard/csrf.ts so the decision logic is unit-tested without booting
// this handler. The handler stays thin glue over them.

export default async (req: Request, ctx: Context): Promise<Response> => {
  // GET health check — presence-only, mirrors resend-webhook.mts and
  // site-dashboard.mts so an operator can curl after wiring env vars.
  // Never reports env values.
  if (req.method === "GET") {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-approve-report",
        env: {
          AIRTABLE_PAT: typeof process.env.AIRTABLE_PAT === "string",
          AIRTABLE_BASE_ID: typeof process.env.AIRTABLE_BASE_ID === "string",
          DASHBOARD_PASSWORD: typeof process.env.DASHBOARD_PASSWORD === "string",
        },
      },
      { status: 200 },
    );
  }

  if (req.method !== "POST") return plainText("Method not allowed", 405);

  // CSRF defense: this is a state-changing endpoint reachable with the ambient
  // Basic-auth creds the browser replays cross-site. Sec-Fetch-Site is the
  // primary signal (the legit inline fetch from /s/:slug and address-bar loads
  // send "same-origin"/"none"); when it's absent we fall back to checking the
  // Origin/Referer host against our own. Only a request with NO cross-site
  // signal at all (no Sec-Fetch, no Origin, no Referer — legacy/non-browser)
  // is allowed through to Basic auth. Placed before auth so a forged cross-site
  // POST is cut early.
  if (!isCsrfAllowed(req)) {
    return plainText("Cross-site request rejected", 403);
  }

  // Auth BEFORE any Airtable read, same realm as site-dashboard.mts so the
  // browser reuses creds when the inline fetch fires from /s/:slug.
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.error("[approve-report] DASHBOARD_PASSWORD missing");
    return plainText("Approve endpoint is unconfigured. Set DASHBOARD_PASSWORD.", 503);
  }
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return plainText("Authentication required.", 401, {
      "www-authenticate": 'Basic realm="Reddoor fleet"',
    });
  }

  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error("[approve-report] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return plainText("Airtable env missing", 500);
  }

  const id = ctx.params?.id;
  if (!id) return plainText("Missing report id", 400);

  // A logged send-anyway override is opt-in via `?override=1` (query flag, since
  // this route is invoked with a fixed method+path from the dashboard's inline
  // fetch) plus a JSON body carrying the required reason. Absent/invalid JSON
  // reads as an empty reason, which approveReport refuses outright (no bypass).
  const url = new URL(req.url);
  let override: { reason: string } | undefined;
  if (url.searchParams.get("override") === "1") {
    const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
    override = { reason: typeof body.reason === "string" ? body.reason : "" };
  }

  try {
    const base = openBase({ apiKey, baseId });
    const deps = {
      getReportById: (rid: string) => getReportByIdAirtable(base, rid),
      approveReportRow: (rid: string, at: Date, by: string) => approveReportRow(base, rid, at, by),
      overrideReport: (rid: string, at: Date, by: string, reason: string) =>
        overrideReportRow(base, rid, at, by, reason),
      now: () => new Date(),
      sendBlockers: async (report: Parameters<typeof approveBlockers>[1]) => {
        // One Websites fetch per approve click (30/min rate limit; fine). A
        // missing Site row is itself a send blocker — sendApprovedReports
        // fails exactly that way.
        const site = (await listWebsites(base)).find((w) => w.id === report.siteId);
        if (!site) return ["site-not-found: this report's Site link points at no Websites row"];
        return formatBlockers(approveBlockers(site, report));
      },
    };
    // Only pass the third argument when an override is actually in play — an
    // explicit trailing `undefined` is a different call arity than omitting
    // the arg (mock assertion equality cares), and approveReport's `override`
    // param is already optional for exactly this no-override path.
    const result = override
      ? await approveReport(deps, id, override)
      : await approveReport(deps, id);

    if (result.status === "not-found") {
      return Response.json(result, { status: 404 });
    }
    // A blocked approve must NOT be a 2xx: the dashboard's inline script keys
    // success purely off res.ok, so a 200 here would flip the button to
    // "Approved" for a report that was refused. 409 = the row's current state
    // conflicts with approval; body carries the reason/blockers.
    if (result.status === "blocked") {
      return Response.json(result, { status: 409 });
    }
    return Response.json(result, { status: 200 });
  } catch (err) {
    // An Airtable 429/500 mid-approve must not surface as an unhandled 500 with
    // an indeterminate body — return a clean retry-able error. approveReport
    // itself is idempotent (a second approve of an already-approved row is a
    // no-op), so a retry after a transient failure is safe.
    return handlerError("approve-report", err);
  }
};
