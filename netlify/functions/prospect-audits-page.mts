import type { Context, Config } from "@netlify/functions";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { listRecentProspectAudits } from "../../src/db/prospect-audits.js";
import { verifyBasicAuth, renderProspectAuditsPageHtml } from "../../src/dashboard/index.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// GET-only page: the Run button on it POSTs to the separate
// /api/prospect-audit/run endpoint (prospect-audit-run.mts), which carries its
// own CSRF gate. Nothing here changes state, so — same reasoning as
// fleet-table.mts / submissions-page.mts's GET branch — no CSRF gate is needed
// on this route itself.
export const config: Config = {
  path: ["/audits", "/.netlify/functions/prospect-audits-page"],
  rateLimit: { windowSize: 60, windowLimit: 60, aggregateBy: ["ip"] },
};

/** Plenty for one screen of "recent" without a pager; the design deliberately
 *  has no pagination for this list (v1 non-goal: no live progress, no extra UI). */
const RECENT_AUDITS_LIMIT = 25;

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

function html(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== "GET") return plainText("Method not allowed.", 405);

  // Authenticate BEFORE the Turso env guard so an unauthenticated probe can't
  // learn whether Turso is configured (a differentiated 500 would leak config
  // state) — same posture as fleet-homepage.mts / submissions-page.mts.
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.error("[prospect-audits-page] DASHBOARD_PASSWORD missing");
    return plainText(
      "Prospect audits page is unconfigured. Set DASHBOARD_PASSWORD in the Netlify site env.",
      503,
    );
  }
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return plainText("Authentication required.", 401, {
      "www-authenticate": 'Basic realm="Reddoor fleet"',
    });
  }

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[prospect-audits-page] TURSO_DATABASE_URL missing");
    return plainText("Turso env missing", 500);
  }

  try {
    const db = await openDb(readDbConfig());
    const audits = await listRecentProspectAudits(db, RECENT_AUDITS_LIMIT);
    return html(renderProspectAuditsPageHtml({ audits, now: new Date() }), 200);
  } catch (err) {
    return handlerError("prospect-audits-page", err);
  }
};
