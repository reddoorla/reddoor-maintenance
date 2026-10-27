import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { COCKPIT_HOME } from "../../../src/dashboard/home-path.js";

/**
 * P1-78f: the triage start page lives at `/triage` until the overview takes `/`
 * (P1-78g). A temporary redirect (307), never a permanent one: browsers and
 * bookmarks must not learn that `/` means `/triage`, because it will not once
 * the overview lands. The query string travels with it.
 */
export const load: PageLoad = ({ url }) => {
  redirect(307, `${COCKPIT_HOME}${url.search}`);
};
