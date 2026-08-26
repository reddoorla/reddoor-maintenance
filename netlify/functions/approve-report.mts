import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { approveReportRow, overrideReportRow } from "../../src/reports/airtable/reports.js";
import { approveReport, requireOperator, denialResponse } from "../../src/dashboard/index.js";

import { approveBlockers, formatBlockers } from "../../src/reports/preflight.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { mirrorWrite } from "../../src/db/freeze.js";
import { mirrorReportPatch, getReportById, getSiteById } from "../../src/db/fleet-state.js";
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
  // Fired by fetch() from the dashboard page, so JSON — a 302 to Google inside
  // fetch() gives the script Google's HTML instead of something it can act on.
  const auth = requireOperator(req, { wants: "json" });
  if (!auth.ok) return denialResponse(auth.denial);

  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error("[approve-report] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return plainText("Airtable env missing", 500);
  }

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[approve-report] TURSO_DATABASE_URL missing");
    return plainText("Turso env missing", 500);
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
    // Phase 2 (#539): the report + site READS come from Turso (hard dependency
    // — the gate must see current state); the approve/override WRITES stay on
    // Airtable and are mirrored back below.
    const db2 = await openDb(readDbConfig());
    // Each Airtable write is mirrored into Turso reports so the page re-render
    // shows the approval immediately, not after the next hourly sync. Everything
    // — opening the db included — is inside mirrorWrite, which decides what a
    // failure MEANS: non-fatal today because the sync converges it, fatal once
    // the freeze makes Turso authoritative and there is no sync to converge it.
    const mirror = async (rid: string, patch: Parameters<typeof mirrorReportPatch>[2]) =>
      mirrorWrite(`approve-report ${rid}`, async () => {
        const db = await openDb(readDbConfig());
        await mirrorReportPatch(db, rid, patch);
      });
    const deps = {
      // Phase 2 (#539): reads from Turso (mirrored writes keep it current
      // within this very request); writes stay on Airtable + mirror below.
      getReportById: (rid: string) => getReportById(db2, rid),
      approveReportRow: async (rid: string, at: Date, by: string) => {
        await approveReportRow(base, rid, at, by);
        await mirror(rid, {
          approved_to_send: 1,
          approved_at: at.toISOString(),
          approved_by: by,
        });
      },
      overrideReport: async (rid: string, at: Date, by: string, reason: string) => {
        await overrideReportRow(base, rid, at, by, reason);
        // overrideReportRow ALSO flips Approved to send with the same stamp —
        // the mirror must match it field-for-field.
        await mirror(rid, {
          send_override: 1,
          override_reason: reason,
          override_by: by,
          override_at: at.toISOString(),
          approved_to_send: 1,
          approved_at: at.toISOString(),
          approved_by: by,
        });
      },
      now: () => new Date(),
      sendBlockers: async (report: Parameters<typeof approveBlockers>[1]) => {
        // One indexed Turso lookup per approve click. A missing Site row is
        // itself a send blocker — sendApprovedReports fails exactly that way.
        const site = await getSiteById(db2, report.siteId);
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
