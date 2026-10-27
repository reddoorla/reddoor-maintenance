import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { siteDashboardFromSnapshot } from "../../../../../src/dashboard/snapshot-views.js";
import { fromSnapshot } from "../../../lib/snapshot.js";
import { buildSiteView } from "../../../lib/site/view.js";

// The page's actions POST to the cockpit's /api/* endpoint routes, which
// carry their own auth and CSRF gates; this route only reads.
export const load: PageLoad = ({ parent, params }) =>
  fromSnapshot("site", parent, (snapshot, now) => {
    const data = siteDashboardFromSnapshot(snapshot, params.slug, now);
    // A genuine miss is a 404; only a read the snapshot lacks becomes the 502.
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
