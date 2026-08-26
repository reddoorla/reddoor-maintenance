import type { Context, Config } from "@netlify/functions";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { getProspectAuditByToken, isValidToken } from "../../src/db/prospect-audits.js";
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

    // Passed through as stored. Parsing and re-serialising here would add a
    // failure mode between the database and the consumer for no gain — the
    // website types the payload against @reddoorla/maintenance/audit at its own
    // boundary, which is where a shape check belongs.
    return new Response(row.result_json, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-robots-tag": "noindex",
        // `private`, never `public`: the document names one business and
        // enumerates its weaknesses. A CDN or corporate proxy on the path must
        // not retain a copy.
        "cache-control": "private, max-age=300",
      },
    });
  } catch (err) {
    return handlerError("audit-report-json", err);
  }
};
