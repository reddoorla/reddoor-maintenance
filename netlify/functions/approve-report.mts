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

  // No Airtable env gate (#646) — the same drop #855 made in `resend-webhook`
  // and #868 in `report-commentary`. Every input this endpoint gates on (the
  // report row, the Websites row behind the send blockers) is read from Turso,
  // and since the #643 freeze Turso is also the store the approve must land in:
  // the daily send batch reads `approved_to_send` from there. Airtable is only
  // the rollback-window shadow, handled below — and for a minted
  // `report_<ULID>` id `approveReportRow` / `overrideReportRow` skip that shadow
  // themselves (`skipsAirtableShadow`). A gate here would 500 every approve on
  // the day the env vars are pulled, for a store this request no longer depends
  // on.
  //
  // The gate that stays is the TURSO one immediately below: this endpoint
  // authorizes a send, and without the authoritative store it cannot read the
  // state the blockers are evaluated against, let alone record the decision.
  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;

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
    // Phase 2 (#539): the report + site READS come from Turso (hard dependency
    // — the gate must see current state), and since the freeze the approve /
    // override WRITES land there FIRST and strictly; the Airtable write that
    // follows is the rollback-window shadow.
    const db2 = await openDb(readDbConfig());
    // The authoritative write. Everything — opening the db included — is inside
    // mirrorWrite, which decides what a failure MEANS: post-freeze it rethrows
    // and this request 502s, because no sync converges it any more. The row
    // count is handed through (#647): an approve for a row Turso never held is
    // `missed`, not a green no-op.
    const mirror = async (rid: string, patch: Parameters<typeof mirrorReportPatch>[2]) =>
      mirrorWrite(`approve-report ${rid}`, async () => {
        const db = await openDb(readDbConfig());
        return mirrorReportPatch(db, rid, patch);
      });
    /** The Airtable SHADOW's handle, or `null` when the shadow is skipped.
     *
     *  Written while Airtable is configured, and still allowed to fail the
     *  request — the rollback-window contract in `src/db/freeze.ts`
     *  (`TURSO_IS_AUTHORITATIVE`): a shadow you might roll back to is one you
     *  keep trustworthy. Turso has already landed by the time it runs, so an
     *  Airtable outage costs only the shadow; approveReport is idempotent, so
     *  the operator's retry re-reads an already-approved row (a 200 `noop`) and
     *  the shadow catches up on the next one that needs it.
     *
     *  With the Airtable env ABSENT the shadow is skipped, not failed: that is
     *  the deliberate unplug Phase 6 ends in, the authoritative write has
     *  landed, and a 500 would only refuse an approve that every gate above
     *  already cleared, over a config problem no retry can fix. It is logged on
     *  a greppable line so an accidental unplug during the rollback window is
     *  visible (a rollback would then need that approval re-applied to Airtable;
     *  Turso holds it). A half-configured env (one var of two) is treated the
     *  same way, under its own reason. */
    const shadowBase = (rid: string): ReturnType<typeof openBase> | null => {
      if (apiKey && baseId) return openBase({ apiKey, baseId });
      const reason = apiKey || baseId ? "env-partial" : "env-absent";
      console.warn(`[approve-report] AIRTABLE_SHADOW skipped=${reason} record=${rid}`);
      return null;
    };
    const deps = {
      // Phase 2 (#539): reads from Turso (the authoritative write keeps it
      // current within this very request).
      getReportById: (rid: string) => getReportById(db2, rid),
      approveReportRow: async (rid: string, at: Date, by: string) => {
        await mirror(rid, {
          approved_to_send: 1,
          approved_at: at.toISOString(),
          approved_by: by,
        });
        const base = shadowBase(rid);
        if (base) await approveReportRow(base, rid, at, by);
      },
      // The override takes the SAME ordering and the same failure semantics as
      // the plain approve, deliberately: both are one stamp on one Reports row,
      // both are idempotent, both have already passed every gate above by the
      // time they run, and both are read back out of Turso by the same send
      // batch. Splitting them would give one button two failure stories.
      overrideReport: async (rid: string, at: Date, by: string, reason: string) => {
        // overrideReportRow ALSO flips Approved to send with the same stamp —
        // the authoritative write must match it field-for-field.
        await mirror(rid, {
          send_override: 1,
          override_reason: reason,
          override_by: by,
          override_at: at.toISOString(),
          approved_to_send: 1,
          approved_at: at.toISOString(),
          approved_by: by,
        });
        const base = shadowBase(rid);
        if (base) await overrideReportRow(base, rid, at, by, reason);
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
