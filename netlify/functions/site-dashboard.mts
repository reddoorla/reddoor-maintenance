import type { Context, Config } from "@netlify/functions";
import { openBase } from "../../src/reports/airtable/client.js";
import { getWebsiteBySlug } from "../../src/reports/airtable/websites.js";
import { listReportsForSite } from "../../src/reports/airtable/reports.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { listSubmissionsForSite } from "../../src/db/submissions.js";
import { listScreenOutsSince, screenOutsSince } from "../../src/db/screenouts.js";
import { verifyBasicAuth, renderSiteDashboardHtml } from "../../src/dashboard/index.js";
import { resolveSlug, handlerError } from "../../src/dashboard/handler-helpers.js";

// Register the customer-facing /s/:slug path on the function itself rather
// than via a netlify.toml [[redirects]] rewrite. The rewrite approach (200
// status) made the function receive the ORIGINAL request URL, not the
// rewritten one — so `url.searchParams.get("slug")` was always null and
// every request fell through to the health check. With function-level
// path routing the slug arrives via ctx.params.
export const config: Config = {
  path: ["/s/:slug", "/.netlify/functions/site-dashboard"],
  // Same shape as the fleet homepage: a Basic-auth-gated read endpoint, capped
  // per-IP so a credential-guessing or scraping loop can't hammer Airtable.
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
          AIRTABLE_PAT: typeof process.env.AIRTABLE_PAT === "string",
          AIRTABLE_BASE_ID: typeof process.env.AIRTABLE_BASE_ID === "string",
          TURSO_DATABASE_URL: typeof process.env.TURSO_DATABASE_URL === "string",
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

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[site-dashboard] TURSO_DATABASE_URL missing");
    return plainText("Turso env missing", 500);
  }

  // Operator-only: gate the per-site dashboard with the same shared password as
  // the fleet homepage, and the SAME Basic realm so the browser reuses creds
  // when the operator clicks through from /. The per-site token model is retired
  // — cockpit visibility is now Status-based. Gate BEFORE any Airtable read so an
  // unauthenticated probe can't fetch a site.
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

  try {
    const base = openBase({ apiKey, baseId });
    // libSQL backs only the optional submission + spam panels here; the core page
    // (site + reports) is Airtable. Open it defensively so a Turso blip drops just
    // those panels rather than 502-ing the whole operator page — the per-panel
    // try/catch below can't catch a throw from an eager open above them.
    let db: Awaited<ReturnType<typeof openDb>> | null = null;
    try {
      db = await openDb(readDbConfig());
    } catch (e) {
      console.error(
        `[site-dashboard] libSQL open failed; submission/spam panels dropped: ${String(e)}`,
      );
    }

    const site = await getWebsiteBySlug(base, slug);
    if (!site) {
      // A genuine miss returns inside the try — only a THROWN Airtable failure
      // reaches handlerError below, so "not found" stays a 404, not a 502.
      return plainText(`No site found for slug '${slug}'.`, 404);
    }

    // Pass the FULL report set to the renderer. The "recent 6" history-table
    // slice is canonical inside renderSiteDashboardHtml — the adapter stays thin.
    // Pre-slicing here would hide an OLD pending report from the approve list +
    // its button while the fleet banner (which counts ALL reports) still shows it,
    // leaving an unapprovable report and a banner/page disagreement.
    const reports = await listReportsForSite(base, site.id);

    let submissions: Awaited<ReturnType<typeof listSubmissionsForSite>> = [];
    if (db) {
      try {
        submissions = await listSubmissionsForSite(db, { id: site.id, name: site.name });
      } catch {
        // submissions section simply absent — the rest of the page still renders
      }
    }

    let spamTotals: import("../../src/db/screenouts.js").ScreenOutTotals | null = null;
    if (db) {
      try {
        const since = screenOutsSince(new Date(), 30);
        spamTotals = (await listScreenOutsSince(db, since)).get(site.id) ?? null;
      } catch {
        // panel simply absent — never blank the page
      }
    }

    return html(renderSiteDashboardHtml(site, reports, submissions, spamTotals, new Date()), 200);
  } catch (err) {
    return handlerError("site-dashboard", err);
  }
};
