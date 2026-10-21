import type { PageServerLoad } from "./$types";
import { loadCockpitModel, loadFleetTableModel } from "../../../../src/dashboard/page-data.js";
import { resolveDashboardBaseUrl } from "../../../../src/dashboard/handler-helpers.js";
import { withDb } from "../../lib/server/db.js";
import { buildSitesView } from "../../lib/cockpit/view.js";

// Sites: the fleet table, with the browse panel merged in (#672 step 3). The
// table's rows, sort and filters come from its own model; each row's health
// (tier, chips, Setup checklist, signals) and the Recently and Archived lanes
// come from the cockpit model `/` reads. GET-only: sorting and filtering are
// link and GET-form re-requests, and the signal chips filter in the browser,
// so there is no form action and no CSRF surface on this page.
export const load: PageServerLoad = ({ url }) =>
  withDb("fleet", async (db) => {
    const now = new Date();
    const [model, cockpit] = await Promise.all([
      loadFleetTableModel(db, url.searchParams),
      loadCockpitModel(db, now, resolveDashboardBaseUrl(process.env.DASHBOARD_BASE_URL)),
    ]);
    return { model, sites: buildSitesView(cockpit, now) };
  });
