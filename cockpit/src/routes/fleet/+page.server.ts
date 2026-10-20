import type { PageServerLoad } from "./$types";
import { loadFleetTableModel } from "../../../../src/dashboard/page-data.js";
import { withDb } from "../../lib/server/db.js";

// GET-only: sorting and filtering are link and GET-form re-requests, so there
// is no form action and no CSRF surface on this page.
export const load: PageServerLoad = ({ url }) =>
  withDb("fleet", async (db) => ({ model: await loadFleetTableModel(db, url.searchParams) }));
