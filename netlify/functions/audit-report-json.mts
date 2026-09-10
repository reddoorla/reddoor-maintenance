import type { Context, Config } from "@netlify/functions";
import { openDb, readDbConfig } from "../../src/db/client.js";
import {
  getProspectAuditByToken,
  isValidToken,
  touchProspectAuditOpened,
} from "../../src/db/prospect-audits.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// The JSON behind reddoorla.com/audit/{token}. The website renders the report
// with its own components; this route exists so Turso credentials never have to
// leave this repo.
//
// Deliberately NOT operator-gated, exactly like prospect-report.mts beside it:
// the 128-bit token IS the credential. Anyone holding the link is the intended
// audience, and there is no operator session to check on a server-to-server
// call anyway.
//
// Keep this route's token handling identical to prospect-report.mts. The two
// serve the same row to the same audience in different formats, and a
// divergence in what either accepts is a security difference, not a style one.
export const config: Config = {
  path: ["/api/audit-report/:token"],
  rateLimit: {
    windowSize: 60,
    windowLimit: 120,
    aggregateBy: ["ip"],
  },
};

/** Refusals carry no detail: the caller learns the outcome, never whether the
 *  token exists. `x-robots-tag` is belt-and-braces — this returns JSON to a
 *  server, but the sibling HTML route sets it on every response and a route
 *  serving the same data should not be the one that forgets. */
function fail(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-robots-tag": "noindex",
    },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "GET") return fail(405, "method-not-allowed");

  const token = ctx.params?.token;
  // Shape-check before the database: anything else is a scanner, not a caller.
  if (!token || !isValidToken(token)) return fail(404, "not-found");

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[audit-report-json] TURSO_DATABASE_URL missing");
    return fail(503, "unconfigured");
  }

  try {
    const db = await openDb(readDbConfig());
    const row = await getProspectAuditByToken(db, token);
    if (!row) return fail(404, "not-found");

    // Wrapped WITHOUT parsing. The reasoning that used to justify passing
    // `result_json` through untouched still holds: parsing and re-serialising
    // adds a failure mode between the database and the consumer for no gain —
    // the website types the payload against @reddoorla/maintenance/audit at its
    // own boundary, which is where a shape check belongs. So the wrapper is
    // built by concatenation and the stored report is never deserialised here.
    // `overrides_json` is validated on the way IN (`setProspectAuditOverrides`),
    // which is what makes this safe.
    //
    // This shape was AHEAD OF PRODUCTION until 2026-09-10, and the gate is
    // recorded rather than deleted because the same trap is one commit away
    // any time this response changes again.
    //
    // The website tolerates both this wrapper and a bare report as of
    // reddoor-website#176. That commit sat on that repo's `staging` branch for
    // a day while `reddoorla.com` — which builds `main`, not `staging` — still
    // ran a `fetchReport` ending `return (await res.json()) as AuditReport`.
    // Shipping this route in that window would have broken every live prospect
    // report and the PDF leave-behind with it, since `renderReportPdf`
    // captures `reddoorla.com/audit/{token}/print` and that calls this same
    // route server-side. And it would have broken SILENTLY: a cast does not
    // throw on the wrapper, it just yields a report whose every field is
    // undefined — blank pages, no 500, nothing a nightly would catch.
    //
    // Discharged by reddoor-website#178, which promoted `staging` to `main`;
    // `reddoorla.com` published `db6702f` at 22:39 UTC that day. Before
    // changing this response shape again, check what `reddoorla.com` is
    // actually SERVING — merged is not deployed, and the branch that serves a
    // report link is not the one most work lands on.
    const body =
      `{"report":${row.result_json},` +
      // `||`, not `??`, and deliberately: `??` passes an empty string straight
      // through, which would emit `"overrides":,` and take the whole REPORT
      // down with invalid JSON rather than just losing the overrides. `""` is
      // not valid JSON, so `||` can never reject a legitimate value here.
      `"overrides":${row.overrides_json || "null"},` +
      // `?? null` before stringify: `JSON.stringify(undefined)` returns
      // undefined, not a string, and would interpolate the bare word
      // `undefined` into the body if either column ever became optional.
      `"editedAt":${JSON.stringify(row.edited_at ?? null)},` +
      `"openedAt":${JSON.stringify(row.opened_at ?? null)}}`;

    // Awaited on purpose, with only its FAILURE swallowed. A Netlify function
    // can be frozen the moment it responds, so a fire-and-forget write here
    // would be silently lost; and knowing when a prospect last opened the
    // report is useful but not worth turning a read route into one that can
    // 500. Awaiting does put a Turso write on the response path — accepted,
    // not overlooked: this route already awaits Turso on the same connection
    // for `getProspectAuditByToken` above, so a store slow enough to matter has
    // already delayed the response before the stamp is reached. The stamp
    // roughly doubles an existing exposure rather than introducing a new class
    // of one, and `touchProspectAuditOpened` coalesces, so the common refresh
    // does not write at all.
    //
    // `x-reddoor-edit-session` is a CROSS-REPO CONTRACT: reddoor-website's
    // report editor sends it so the operator's own previews do not drown the
    // signal. It is not a shared constant — the website cannot take a
    // `@reddoorla/maintenance` bump right now (see the comment atop its
    // `src/lib/report/fetch.ts`) — so if the two spellings ever drift this
    // DEGRADES SILENTLY: nothing errors, the skip just stops working and
    // `opened_at` quietly starts recording operator previews as prospect reads.
    //
    // And an honest caveat about the signal itself: corporate email link
    // scanners fetch links, so `opened_at` will sometimes say "opened" when
    // nobody read anything. That is a bigger threat to this field's honesty
    // than the fact that the header is trivially spoofable.
    if (req.headers.get("x-reddoor-edit-session") !== "1") {
      try {
        await touchProspectAuditOpened(db, token);
      } catch (err) {
        console.error("[audit-report-json] could not stamp opened_at", err);
      }
    }

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-robots-tag": "noindex",
        // `private`, never `public`: the document names one business and
        // enumerates its weaknesses. A CDN or corporate proxy on the path must
        // not retain a copy. `no-store` rather than the old max-age=300,
        // because an operator edit that takes five minutes to appear reads as
        // a save that did not work.
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    return handlerError("audit-report-json", err);
  }
};
