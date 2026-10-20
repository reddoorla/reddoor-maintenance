import type { Context, Config } from "@netlify/functions";
import { openDb, readDbConfig } from "../../src/db/client.js";
import {
  requireOperator,
  denialResponse,
  renderSiteDashboardHtml,
} from "../../src/dashboard/index.js";
import {
  resolveSlug,
  handlerError,
  resolveDashboardBaseUrl,
} from "../../src/dashboard/handler-helpers.js";
import { loadSiteDashboard } from "../../src/dashboard/page-data.js";

// Register the customer-facing /s/:slug path on the function itself rather
// than via a netlify.toml [[redirects]] rewrite. The rewrite approach (200
// status) made the function receive the ORIGINAL request URL, not the
// rewritten one — so `url.searchParams.get("slug")` was always null and
// every request fell through to the health check. With function-level
// path routing the slug arrives via ctx.params.
export const config: Config = {
  path: ["/s/:slug", "/.netlify/functions/site-dashboard"],
  // Same shape as the fleet homepage: a Basic-auth-gated read endpoint, capped
  // per-IP so a credential-guessing or scraping loop can't hammer Turso.
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

export default async (req: Request, ctx: Context): Promise<Response> => {
  // Health check fires when hit on the function URL with no slug (either
  // path or query). Same pattern as resend-webhook so operators can curl
  // after deploy to verify env wiring.
  const url = new URL(req.url);
  const slug = resolveSlug(ctx.params?.slug, url.searchParams.get("slug"));

  if (!slug) {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-site-dashboard",
        env: {
          TURSO_DATABASE_URL: typeof process.env.TURSO_DATABASE_URL === "string",
        },
      },
      { status: 200 },
    );
  }

  // Operator-only: gate the per-site dashboard with the same shared password as
  // the fleet homepage, and the SAME Basic realm so the browser reuses creds
  // when the operator clicks through from /. The per-site token model is retired
  // — cockpit visibility is now Status-based. Gate BEFORE any Turso read so an
  // unauthenticated probe can't fetch a site — and before the Turso env
  // guard so a probe can't tell which backend env is unset (only the password
  // check, which auth itself needs, precedes).
  const auth = requireOperator(req, { wants: "redirect" });
  if (!auth.ok) return denialResponse(auth.denial);

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[site-dashboard] TURSO_DATABASE_URL missing");
    return plainText("Turso env missing", 500);
  }

  try {
    // Phase 2 (#539): Turso IS the core page now (site + reports + submissions
    // all read from it), so open it non-defensively — a failure 502s rather
    // than rendering a page that pretends the site vanished.
    const db = await openDb(readDbConfig());

    const now = new Date();
    const data = await loadSiteDashboard(
      db,
      slug,
      now,
      resolveDashboardBaseUrl(process.env.DASHBOARD_BASE_URL),
    );
    if (!data) {
      // A genuine miss returns inside the try — only a THROWN Turso failure
      // reaches handlerError below, so "not found" stays a 404, not a 502.
      return plainText(`No site found for slug '${slug}'.`, 404);
    }

    return html(
      renderSiteDashboardHtml(
        data.site,
        data.reports,
        data.submissions,
        data.spamTotals,
        now,
        data.alarm,
        auth.email,
      ),
      200,
    );
  } catch (err) {
    return handlerError("site-dashboard", err);
  }
};
