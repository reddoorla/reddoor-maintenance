import type { PageLoad } from "./$types";
import {
  cockpitModelFromSnapshot,
  fleetTableModelFromSnapshot,
} from "../../../../src/dashboard/snapshot-views.js";
import { parseFleetTableQuery } from "../../../../src/dashboard/fleet-table.js";
import { fromSnapshot } from "../../lib/snapshot.js";
import { buildSitesView } from "../../lib/cockpit/view.js";
import {
  checkNameForSlug,
  checkVerdictsFromSnapshot,
  siteFactsFromSnapshot,
} from "../../lib/overview/view.js";
import type { CheckFilter } from "./view.js";

// Sites: the fleet table, with the browse panel merged in (#672 step 3). The
// table's rows, sort and filters come from its own model; each row's health
// (tier, chips, Setup checklist, signals) and the Recently and Archived lanes
// come from the cockpit model `/` derives. GET-only: sorting and filtering are
// link and GET-form re-requests, and the signal chips filter in the browser,
// so there is no form action and no CSRF surface on this page.
export const load: PageLoad = ({ parent, url }) =>
  fromSnapshot("fleet", parent, (snapshot, now) => {
    const cockpit = cockpitModelFromSnapshot(snapshot, now);
    // `?check=<slug>` lists the maintained sites that failed that health check (P1-87, PR 8b).
    // The keep set is the failing ids; the unread count is every verdict that is neither pass
    // nor fail, the bar's own unknown count. An unknown slug is named on the page and dropped
    // here, so the table is the whole one.
    const params = new URLSearchParams(url.searchParams);
    const requested = parseFleetTableQuery(url.searchParams).check;
    const name = requested === "" ? null : checkNameForSlug(requested);
    let check: CheckFilter | null = null;
    let keep: ReadonlySet<string> | undefined;
    if (requested !== "" && name === null) {
      params.delete("check");
      check = { unknown: requested };
    } else if (name !== null) {
      const failing = new Set<string>();
      let unread = 0;
      for (const v of checkVerdictsFromSnapshot(snapshot, cockpit, now)) {
        const verdict = v.verdicts[name];
        if (verdict === false) failing.add(v.siteId);
        else if (verdict !== true) unread++;
      }
      keep = failing;
      check = { slug: requested, name, failing: failing.size, unread };
    }
    return {
      model: fleetTableModelFromSnapshot(
        snapshot,
        params,
        new Map(cockpit.cards.map((c) => [c.site.id, c.tier] as const)),
        keep,
      ),
      sites: buildSitesView(cockpit, now, snapshot.feedDeploys),
      // The overview's "Is every site live?" columns, moved here (P1-87, PR 2).
      facts: siteFactsFromSnapshot(snapshot, cockpit, now),
      check,
    };
  });
