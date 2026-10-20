import type { Context, Config } from "@netlify/functions";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { requireOperator, denialResponse, renderCockpitHtml } from "../../src/dashboard/index.js";
import { loadCockpitModel } from "../../src/dashboard/page-data.js";
import { resolveDashboardBaseUrl, handlerError } from "../../src/dashboard/handler-helpers.js";

// Owns the root path. The per-site dashboard function continues to own
// /s/:slug; the resend-webhook function continues to own its own path.
// Phase 2 decision was Netlify site-level password — implemented here as
// HTTP Basic Auth against DASHBOARD_PASSWORD env var rather than via
// Netlify dashboard settings, so the gate ships with the code.
export const config: Config = {
  path: ["/"],
  rateLimit: {
    windowSize: 60,
    windowLimit: 60,
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

function html(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  // Authenticate BEFORE the Turso env guard so an unauthenticated probe
  // can't tell which backend env is unset (a differentiated 500 leaks config
  // state). Only the password check — unavoidable, since auth needs it — precedes.
  const auth = requireOperator(req, { wants: "redirect" });
  if (!auth.ok) return denialResponse(auth.denial);

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[fleet-homepage] TURSO_DATABASE_URL missing");
    return plainText("Turso env missing", 500);
  }

  try {
    // Phase 2 (#539): Turso IS the cockpit's core data now (sites + reports +
    // submissions), so open it non-defensively — a failure 502s rather than
    // rendering a misleading "0 sites" page. As of #609 it is the ONLY store
    // this handler reads. What it reads is `loadCockpitModel` (page-data.ts).
    const db = await openDb(readDbConfig());
    const baseUrl = resolveDashboardBaseUrl(process.env.DASHBOARD_BASE_URL);
    const model = await loadCockpitModel(db, new Date(), baseUrl);
    return html(renderCockpitHtml(model, auth.email), 200);
  } catch (err) {
    return handlerError("fleet-homepage", err);
  }
};
