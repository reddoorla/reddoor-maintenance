import type { Context, Config } from "@netlify/functions";
import { getSiteBySlug, listReportsForSite } from "../../src/db/fleet-state.js";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { listSubmissionsForSite, countNotifyBouncedBySite } from "../../src/db/submissions.js";
import { listScreenOutsSince, screenOutsSince } from "../../src/db/screenouts.js";
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
import { buildSiteAlarmContext } from "../../src/dashboard/fleet-cockpit.js";
import type { SiteAlarmContext } from "../../src/dashboard/fleet-cockpit.js";
import { NOTIFY_BOUNCE_WINDOW_DAYS } from "../../src/alerts/digest-collectors.js";

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
          TURSO_DATABASE_URL: typeof process.env.TURSO_DATABASE_URL === "string",
        },
      },
      { status: 200 },
    );
  }

  // Operator-only: gate the per-site dashboard with the same shared password as
  // the fleet homepage, and the SAME Basic realm so the browser reuses creds
  // when the operator clicks through from /. The per-site token model is retired
  // — cockpit visibility is now Status-based. Gate BEFORE any Airtable read so an
  // unauthenticated probe can't fetch a site — and before the Airtable/Turso env
  // guards so a probe can't tell which backend env is unset (only the password
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

    const site = await getSiteBySlug(db, slug);
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
    const reports = await listReportsForSite(db, site.id);

    let submissions: Awaited<ReturnType<typeof listSubmissionsForSite>> = [];
    try {
      submissions = await listSubmissionsForSite(db, { id: site.id, name: site.name });
    } catch {
      // submissions section simply absent — the rest of the page still renders
    }

    let spamTotals: import("../../src/db/screenouts.js").ScreenOutTotals | null = null;
    try {
      const since = screenOutsSince(new Date(), 30);
      spamTotals = (await listScreenOutsSince(db, since)).get(site.id) ?? null;
    } catch {
      // panel simply absent — never blank the page
    }

    // Cockpit alarm verdict for the header chip strip — same collectors + assignTier
    // as buildCockpitModel (see buildSiteAlarmContext). Both reads are defensive:
    // a Turso blip drops just the bounce chip; any collector throw drops the strip.
    let notifyBounces: ReadonlyMap<string, number> = new Map();
    try {
      notifyBounces = await countNotifyBouncedBySite(
        db,
        screenOutsSince(new Date(), NOTIFY_BOUNCE_WINDOW_DAYS),
      );
    } catch {
      // bounce chip simply absent
    }
    let alarm: SiteAlarmContext | null = null;
    try {
      alarm = buildSiteAlarmContext(
        site,
        reports,
        resolveDashboardBaseUrl(process.env.DASHBOARD_BASE_URL),
        new Date(),
        notifyBounces,
      );
    } catch (e) {
      console.error(`[site-dashboard] alarm context failed: ${String(e)}`);
    }

    return html(
      renderSiteDashboardHtml(
        site,
        reports,
        submissions,
        spamTotals,
        new Date(),
        alarm,
        auth.email,
      ),
      200,
    );
  } catch (err) {
    return handlerError("site-dashboard", err);
  }
};
