import { requireOperator, denialResponse } from "../../../../../src/dashboard/index.js";
import { loadBacklogPanel } from "../../../../../src/dashboard/backlog-source.js";

/**
 * `GET /api/backlog` (P1-111): the backlog's top five P1 items, read from the
 * private workspace repo's BACKLOG.md at request time with the dashboard's
 * GH_TOKEN, for the Triage page to fetch once it is on screen. An endpoint and
 * not a page server load, so a navigation between pages still asks the server
 * for nothing (cockpit/tests/snapshot/snapshot.ssr.test.ts). Any signed-in
 * user may read it (the operator, 2026-11-23: "it's fine if they see it").
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") {
    return Response.json({ ok: false, error: "method-not-allowed" }, { status: 405 });
  }
  const auth = requireOperator(req, { wants: "json" });
  if (!auth.ok) return denialResponse(auth.denial);
  const panel = await loadBacklogPanel({ token: process.env.GH_TOKEN });
  return Response.json(panel, { status: 200, headers: { "cache-control": "private, no-store" } });
};
