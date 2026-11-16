import type { PageLoad } from "./$types";
import {
  cockpitModelFromSnapshot,
  fleetTableModelFromSnapshot,
} from "../../../../src/dashboard/snapshot-views.js";
import { fromSnapshot } from "../../lib/snapshot.js";
import { buildSitesView } from "../../lib/cockpit/view.js";
import { siteFactsFromSnapshot } from "../../lib/overview/view.js";

// Sites: the fleet table, with the browse panel merged in (#672 step 3). The
// table's rows, sort and filters come from its own model; each row's health
// (tier, chips, Setup checklist, signals) and the Recently and Archived lanes
// come from the cockpit model `/` derives. GET-only: sorting and filtering are
// link and GET-form re-requests, and the signal chips filter in the browser,
// so there is no form action and no CSRF surface on this page.
export const load: PageLoad = ({ parent, url }) =>
  fromSnapshot("fleet", parent, (snapshot, now) => {
    const cockpit = cockpitModelFromSnapshot(snapshot, now);
    return {
      model: fleetTableModelFromSnapshot(
        snapshot,
        url.searchParams,
        new Map(cockpit.cards.map((c) => [c.site.id, c.tier])),
      ),
      sites: buildSitesView(cockpit, now),
      // The overview's "Is every site live?" columns, moved here (P1-87, PR 2).
      facts: siteFactsFromSnapshot(snapshot, cockpit, now),
    };
  });
