import type { PageLoad } from "./$types";
import { cockpitModelFromSnapshot } from "../../../../src/dashboard/snapshot-views.js";
import { fromSnapshot } from "../../lib/snapshot.js";
import { buildCockpitView } from "../../lib/cockpit/view.js";
import { buildBacklogView } from "../../lib/backlog/view.js";

export const load: PageLoad = ({ parent, data }) =>
  fromSnapshot("home", parent, (snapshot, now) => ({
    view: buildCockpitView(cockpitModelFromSnapshot(snapshot, now), now),
    backlog: buildBacklogView(data.backlog, now),
  }));
