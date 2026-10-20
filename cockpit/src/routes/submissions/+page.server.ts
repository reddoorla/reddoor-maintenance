import { error, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { loadSubmissionsPage, markSubmissionsRead } from "../../../../src/dashboard/page-data.js";
import { isCsrfAllowed } from "../../../../src/dashboard/csrf.js";
import { withDb } from "../../lib/server.js";

export const load: PageServerLoad = ({ url }) =>
  withDb("submissions", async (db) => {
    const loaded = await loadSubmissionsPage(db, url.searchParams);
    if (loaded.kind === "no-site") error(404, `No site found for slug '${loaded.slug}'.`);
    return { model: loaded.model };
  });

export const actions: Actions = {
  // The bulk mark-read form. It posts the ACTIVE filter as fields with the GET
  // query's names, so the same parse re-derives the identical filter.
  default: async ({ request }) => {
    // The function's own CSRF gate, kept beside SvelteKit's origin check: a
    // browser replays Basic auth cross-site.
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
