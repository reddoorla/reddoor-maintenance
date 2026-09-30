import type { Context, Config } from "@netlify/functions";
import { withdrawReport, requireOperator, denialResponse } from "../../src/dashboard/index.js";

import { openDb, readDbConfig } from "../../src/db/client.js";
import { mirrorWrite } from "../../src/db/mirror-write.js";
import {
  patchReportIfOpen,
  getReportById,
  getSiteById,
  listReportsForSite,
  mirrorScheduleFields,
} from "../../src/db/fleet-state.js";
import { nextDueDates } from "../../src/reports/due.js";
import { nextDueDatesFields } from "../../src/fleet/site-fields.js";
import type { Db } from "../../src/db/client.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// P1-28: "Don't send" on /s/:slug. Path-routed on the function itself for the
// same reason as approve-report.mts (a [[redirects]] rewrite leaves ctx.params
// empty), with the same rate limit.
export const config: Config = {
  path: ["/api/reports/:id/withdraw", "/.netlify/functions/withdraw-report"],
  rateLimit: {
    windowSize: 60,
    windowLimit: 30,
    aggregateBy: ["ip"],
  },
};

/** A withdrawal moves the site's next-due date (it consumes its cycle), so
 *  write it now rather than leave the console showing the old date until the
 *  nightly write-back. Best-effort: that write-back converges a miss. */
async function refreshSchedule(db: Db, reportId: string): Promise<void> {
  try {
    const report = await getReportById(db, reportId);
    const site = report ? await getSiteById(db, report.siteId) : null;
    if (!site) return;
    const now = new Date();
    const dates = nextDueDates(site, await listReportsForSite(db, site.id), now);
    await mirrorScheduleFields(db, site.id, nextDueDatesFields(dates), now.toISOString());
  } catch (e) {
    console.warn(`[withdraw-report] schedule refresh failed for ${reportId}: ${String(e)}`);
  }
}

function plainText(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method === "GET") {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-withdraw-report",
        env: {
          TURSO_DATABASE_URL: typeof process.env.TURSO_DATABASE_URL === "string",
          DASHBOARD_PASSWORD: typeof process.env.DASHBOARD_PASSWORD === "string",
        },
      },
      { status: 200 },
    );
  }

  if (req.method !== "POST") return plainText("Method not allowed", 405);

  // The same CSRF, auth and store gates as approve-report.mts, in the same order.
  if (!isCsrfAllowed(req)) {
    return plainText("Cross-site request rejected", 403);
  }

  const auth = requireOperator(req, { wants: "json" });
  if (!auth.ok) return denialResponse(auth.denial);

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[withdraw-report] TURSO_DATABASE_URL missing");
    return plainText("Turso env missing", 500);
  }

  const id = ctx.params?.id;
  if (!id) return plainText("Missing report id", 400);

  try {
    const db = await openDb(readDbConfig());
    const result = await withdrawReport(
      {
        getReportById: (rid: string) => getReportById(db, rid),
        // Conditioned on the row still being pending: a miss is a lost race,
        // which withdrawReport names from a re-read, not a store failure.
        withdrawReportRow: async (rid: string, at: Date, by: string) => {
          let landed = false;
          await mirrorWrite(`withdraw-report ${rid}`, async () => {
            const wdb = await openDb(readDbConfig());
            landed = await patchReportIfOpen(
              wdb,
              rid,
              { withdrawn_at: at.toISOString(), withdrawn_by: by },
              "withdrawable",
            );
          });
          return landed;
        },
        now: () => new Date(),
      },
      id,
    );

    if (result.status === "withdrawn") await refreshSchedule(db, id);
    if (result.status === "not-found") {
      return Response.json(result, { status: 404 });
    }
    // The page's script keys success off res.ok, so only a row that IS withdrawn
    // may answer 2xx; any other no-op conflicts with the request.
    if (result.status === "noop" && result.reason !== "already-withdrawn") {
      return Response.json(result, { status: 409 });
    }
    return Response.json(result, { status: 200 });
  } catch (err) {
    return handlerError("withdraw-report", err);
  }
};
