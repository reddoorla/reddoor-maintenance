import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { loadSiteDashboard } from "../../../../../src/dashboard/page-data.js";
import { resolveDashboardBaseUrl } from "../../../../../src/dashboard/handler-helpers.js";
import { withDb } from "../../../lib/server/db.js";
import { buildSiteView } from "../../../lib/site/view.js";

// The page's actions POST to the Netlify functions' /api/* endpoints, which
// carry their own auth and CSRF gates; this route only reads.
export const load: PageServerLoad = ({ params }) =>
  withDb("site", async (db) => {
    const now = new Date();
    const data = await loadSiteDashboard(
      db,
      params.slug,
      now,
      resolveDashboardBaseUrl(process.env.DASHBOARD_BASE_URL),
    );
    // A genuine miss is a 404; only a THROWN store failure becomes the 502.
    if (!data) error(404, `No site found for slug '${params.slug}'.`);
    return {
      view: buildSiteView(
        data.site,
        data.reports,
        data.submissions,
        data.spamTotals,
        now,
        data.alarm,
      ),
    };
  });
