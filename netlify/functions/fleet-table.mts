import type { Context, Config } from "@netlify/functions";
import { listSites } from "../../src/db/fleet-state.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import {
  requireOperator,
  denialResponse,
  renderFleetTableHtml,
  parseFleetTableQuery,
  buildFleetTableModel,
} from "../../src/dashboard/index.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// The fleet table (#539 Phase 4): every site — archived/legacy/null-status
// included — as one sortable/filterable server-rendered page. GET-only: sorting
// and filtering are link/GET-form re-requests, so no CSRF gate is needed (the
// CSRF check guards state-changing POSTs on sibling endpoints; this page has
// no mutations in this slice).
export const config: Config = {
  path: ["/fleet", "/.netlify/functions/fleet-table"],
  rateLimit: { windowSize: 60, windowLimit: 60, aggregateBy: ["ip"] },
};

function plainText(body: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...extra },
  });
}

function html(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== "GET") {
    return plainText("Method not allowed.", 405);
  }
  // Authenticate BEFORE the Turso env guard so an unauthenticated probe can't
  // tell whether the backend env is set (a differentiated 500 leaks config
  // state). Only the password check — unavoidable, since auth needs it — precedes.
  const auth = requireOperator(req, { wants: "redirect" });
  if (!auth.ok) return denialResponse(auth.denial);
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[fleet-table] TURSO_DATABASE_URL missing");
    return plainText("Turso env missing", 500);
  }

  try {
    // Turso IS the page (the one `listSites` read feeds everything), so open it
    // non-defensively — a failure 502s via handlerError rather than rendering an
    // empty table that pretends the fleet vanished. No Airtable read at all.
    const db = await openDb(readDbConfig());
    const query = parseFleetTableQuery(new URL(req.url).searchParams);
    const sites = await listSites(db);
    return html(renderFleetTableHtml(buildFleetTableModel(sites, query), auth.email), 200);
  } catch (err) {
    return handlerError("fleet-table", err);
  }
};
