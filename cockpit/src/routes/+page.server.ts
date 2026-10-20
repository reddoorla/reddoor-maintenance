import type { PageServerLoad } from "./$types";
import { loadCockpitModel } from "../../../src/dashboard/page-data.js";
import { resolveDashboardBaseUrl } from "../../../src/dashboard/handler-helpers.js";
import { withDb } from "../lib/server/db.js";
import { buildCockpitView } from "../lib/cockpit/view.js";

export const load: PageServerLoad = () =>
  withDb("home", async (db) => {
    const now = new Date();
    const model = await loadCockpitModel(
      db,
      now,
      resolveDashboardBaseUrl(process.env.DASHBOARD_BASE_URL),
    );
    return { view: buildCockpitView(model, now) };
  });
