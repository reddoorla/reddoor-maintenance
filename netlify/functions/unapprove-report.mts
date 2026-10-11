import type { Context, Config } from "@netlify/functions";
import { unapproveReport, requireOperator, denialResponse } from "../../src/dashboard/index.js";

import { openDb, readDbConfig } from "../../src/db/client.js";
import { mirrorWrite } from "../../src/db/mirror-write.js";
import { getReportById, unapproveReportIfUnsent } from "../../src/db/fleet-state.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// #1262: "Unapprove" on /s/:slug. Path-routed on the function itself for the
// same reason as approve-report.mts, with the same rate limit.
export const config: Config = {
  path: ["/api/reports/:id/unapprove", "/.netlify/functions/unapprove-report"],
  rateLimit: {
    windowSize: 60,
    windowLimit: 30,
    aggregateBy: ["ip"],
  },
};

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
        service: "reddoor-unapprove-report",
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
    console.error("[unapprove-report] TURSO_DATABASE_URL missing");
    return plainText("Turso env missing", 500);
  }

  const id = ctx.params?.id;
  if (!id) return plainText("Missing report id", 400);

  try {
    const db = await openDb(readDbConfig());
    const result = await unapproveReport(
      {
        getReportById: (rid: string) => getReportById(db, rid),
        // Conditioned on the row still being approved and unsent: a miss is a
        // lost race, which unapproveReport names from a re-read.
        unapproveReportRow: async (rid: string, at: Date, by: string) => {
          let landed = false;
          await mirrorWrite(`unapprove-report ${rid}`, async () => {
            const wdb = await openDb(readDbConfig());
            landed = await unapproveReportIfUnsent(wdb, rid, at, by);
          });
          return landed;
        },
        now: () => new Date(),
      },
      id,
    );

    if (result.status === "not-found") {
      return Response.json(result, { status: 404 });
    }
    // The page's script keys success off res.ok, so only a row that is now
    // unapproved may answer 2xx; a sent or withdrawn row conflicts.
    if (result.status === "noop" && result.reason !== "not-approved") {
      return Response.json(result, { status: 409 });
    }
    return Response.json(result, { status: 200 });
  } catch (err) {
    return handlerError("unapprove-report", err);
  }
};
