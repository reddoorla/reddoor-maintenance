import type { PageLoad } from "./$types";
import { cockpitModelFromSnapshot } from "../../../../src/dashboard/snapshot-views.js";
import { fromSnapshot } from "../../lib/snapshot.js";
import { buildCockpitView } from "../../lib/cockpit/view.js";

export const load: PageLoad = ({ parent }) =>
  fromSnapshot("home", parent, (snapshot, now) => ({
    view: buildCockpitView(cockpitModelFromSnapshot(snapshot, now), now),
    // P1-111: the page fetches the backlog from here once it is on screen.
    backlogSource: "/api/backlog",
  }));
