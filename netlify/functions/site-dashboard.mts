import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { getWebsiteBySlug } from "../../src/reports/airtable/websites.js";
import { listReportsForSite } from "../../src/reports/airtable/reports.js";
import { verifyDashboardToken, renderSiteDashboardHtml } from "../../src/dashboard/index.js";

// Register the customer-facing /s/:slug path on the function itself rather
// than via a netlify.toml [[redirects]] rewrite. The rewrite approach (200
// status) made the function receive the ORIGINAL request URL, not the
// rewritten one — so `url.searchParams.get("slug")` was always null and
// every request fell through to the health check. With function-level
// path routing the slug arrives via ctx.params.
export const config: Config = {
  path: ["/s/:slug", "/.netlify/functions/site-dashboard"],
};

function plainText(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
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
  const token = url.searchParams.get("t");

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

  const base = openBase({ apiKey, baseId });

  const site = await getWebsiteBySlug(base, slug);
  if (!site) {
    return plainText(`No site found for slug '${slug}'.`, 404);
  }

  if (!site.dashboardToken) {
    return plainText(
      `Site '${site.name}' has no Dashboard Token set in Airtable. ` +
        `Open the Websites table, find the row, and populate the "Dashboard Token" field.`,
      403,
    );
  }

  if (!verifyDashboardToken(token, site.dashboardToken)) {
    // 404 (not 403) so the URL space doesn't leak which sites have valid
    // tokens vs. which are wrong-tokened — both look the same to a probe.
    return plainText(`Not found.`, 404);
  }

  const reports = await listReportsForSite(base, site.id);
  // Show most recent 6 — long enough to show a quarter of monthly reports
  // plus the most recent testing report, short enough that the page stays
  // a single scroll.
  const recent = [...reports]
    .sort((a, b) => (b.completedOn ?? "").localeCompare(a.completedOn ?? ""))
    .slice(0, 6);

  return html(renderSiteDashboardHtml(site, recent), 200);
};
