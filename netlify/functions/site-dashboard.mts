import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { getWebsiteBySlug } from "../../src/reports/airtable/websites.js";
import { listReportsForSite } from "../../src/reports/airtable/reports.js";
import { verifyBasicAuth, renderSiteDashboardHtml } from "../../src/dashboard/index.js";

// Register the customer-facing /s/:slug path on the function itself rather
// than via a netlify.toml [[redirects]] rewrite. The rewrite approach (200
// status) made the function receive the ORIGINAL request URL, not the
// rewritten one — so `url.searchParams.get("slug")` was always null and
// every request fell through to the health check. With function-level
// path routing the slug arrives via ctx.params.
export const config: Config = {
  path: ["/s/:slug", "/.netlify/functions/site-dashboard"],
};

function plainText(body: string, status: number, extraHeaders: HeadersInit = {}): Response {
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
  const slug = ctx.params?.slug ?? url.searchParams.get("slug");

  if (!slug) {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-site-dashboard",
        env: {
          AIRTABLE_PAT: typeof process.env.AIRTABLE_PAT === "string",
          AIRTABLE_BASE_ID: typeof process.env.AIRTABLE_BASE_ID === "string",
        },
      },
      { status: 200 },
    );
  }

  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    console.error("[site-dashboard] AIRTABLE_PAT or AIRTABLE_BASE_ID missing");
    return plainText("Airtable env missing", 500);
  }

  // Operator-only: gate the per-site dashboard with the same shared password as
  // the fleet homepage, and the SAME Basic realm so the browser reuses creds
  // when the operator clicks through from /. The per-site token model is retired
  // — dashboardToken is now just the fleet-homepage visibility flag. Gate BEFORE
  // any Airtable read so an unauthenticated probe can't fetch a site.
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.error("[site-dashboard] DASHBOARD_PASSWORD missing");
    return plainText(
      "Site dashboard is unconfigured. Set DASHBOARD_PASSWORD in the Netlify site env.",
      503,
    );
  }
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return plainText("Authentication required.", 401, {
      "www-authenticate": 'Basic realm="Reddoor fleet"',
    });
  }

  const base = openBase({ apiKey, baseId });

  const site = await getWebsiteBySlug(base, slug);
  if (!site) {
    return plainText(`No site found for slug '${slug}'.`, 404);
  }

  // Pass the FULL report set to the renderer. The "recent 6" history-table
  // slice is canonical inside renderSiteDashboardHtml — the adapter stays thin.
  // Pre-slicing here would hide an OLD pending report from the approve list +
  // its button while the fleet banner (which counts ALL reports) still shows it,
  // leaving an unapprovable report and a banner/page disagreement.
  const reports = await listReportsForSite(base, site.id);

  return html(renderSiteDashboardHtml(site, reports), 200);
};
