import type { Context, Config } from "@netlify/functions";
import { requireOperator, denialResponse } from "../../src/dashboard/index.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { getReportHtml } from "../../src/db/fleet-state.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// Phase 2 (#539): serve a report's rendered body straight from Turso. The old
// "draft preview" links pointed at Airtable's SIGNED attachment URL, which
// expires — a stale dashboard tab 404'd. The body now lives in
// reports.rendered_html, so the dashboard serves it itself, behind the same
// operator Basic auth as every other dashboard page.
export const config: Config = {
  path: ["/api/reports/:id/preview"],
  rateLimit: {
    windowSize: 60,
    windowLimit: 120,
    aggregateBy: ["ip"],
  },
};

function plainText(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...headers },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "GET") return plainText("Method not allowed.", 405);

  // Opened as a link in a new tab, so a navigation — redirect rather than 401,
  // even though the path sits under /api/.
  const auth = requireOperator(req, { wants: "redirect" });
  if (!auth.ok) return denialResponse(auth.denial);

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[report-preview] TURSO_DATABASE_URL missing");
    return plainText("Turso env missing", 500);
  }

  const id = ctx.params?.id;
  // Airtable rec ids only — anything else is a probe, not a report.
  if (!id || !/^rec[A-Za-z0-9]+$/.test(id)) return plainText("Not found.", 404);

  try {
    const db = await openDb(readDbConfig());
    const report = await getReportHtml(db, id);
    if (!report) return plainText("No rendered body stored for this report.", 404);
    return new Response(report.html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // The body is a finished artifact rendered at draft time — never index,
        // never cache across operators.
        "x-robots-tag": "noindex",
        "cache-control": "private, max-age=300",
      },
    });
  } catch (err) {
    return handlerError("report-preview", err);
  }
};
