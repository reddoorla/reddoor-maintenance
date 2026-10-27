import { error, redirect } from "@sveltejs/kit";
import type { Actions } from "./$types";
import { markSubmissionsRead } from "../../../../src/dashboard/page-data.js";
import { isCsrfAllowed } from "../../../../src/dashboard/csrf.js";
import { withDb } from "../../lib/server/db.js";

// The page itself derives from the layout's snapshot (`+page.ts`); this file
// holds only the bulk mark-read action, which writes.
export const actions: Actions = {
  // The bulk mark-read form. It posts the ACTIVE filter as fields with the GET
  // query's names, so the same parse re-derives the identical filter.
  default: async ({ request }) => {
    // The action's own CSRF gate (SvelteKit's origin check is off, see
    // vite.cockpit.config.ts): a browser replays Basic auth cross-site.
    if (!isCsrfAllowed(request)) error(403, "Cross-site request rejected.");
    const params = new URLSearchParams(await request.text());
    const result = await withDb("submissions", (db) => markSubmissionsRead(db, params));
    if (result.kind === "no-site") error(404, `No site found for slug '${result.slug}'.`);
    if (result.kind === "unknown-action") error(400, "Unknown action.");
    console.log(`[submissions-page] bulk mark-read flipped ${result.count} row(s)`);
    // 303: the browser re-GETs the same filtered view, so a refresh can't repost.
    redirect(303, result.location);
  },
};
