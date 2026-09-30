import type { Context, Config } from "@netlify/functions";
import { withdrawReport, requireOperator, denialResponse } from "../../src/dashboard/index.js";

import { openDb, readDbConfig } from "../../src/db/client.js";
import { mirrorWrite } from "../../src/db/mirror-write.js";
import { mirrorReportPatch, getReportById } from "../../src/db/fleet-state.js";
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
        withdrawReportRow: async (rid: string, at: Date, by: string) => {
          await mirrorWrite(`withdraw-report ${rid}`, async () => {
            const wdb = await openDb(readDbConfig());
            return mirrorReportPatch(wdb, rid, {
              withdrawn_at: at.toISOString(),
              withdrawn_by: by,
            });
          });
        },
        now: () => new Date(),
      },
      id,
    );

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
