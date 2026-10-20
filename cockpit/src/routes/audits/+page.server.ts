import type { PageServerLoad } from "./$types";
import { loadProspectAudits } from "../../../../src/dashboard/page-data.js";
import { withDb } from "../../lib/server/db.js";
import { auditsPageView } from "../../lib/audits/view.js";

// GET-only: the Run form POSTs to /api/prospect-audit/run, a Netlify function
// with its own CSRF gate. Nothing here changes state.
export const load: PageServerLoad = () =>
  withDb("audits", async (db) => auditsPageView(await loadProspectAudits(db), new Date()));
