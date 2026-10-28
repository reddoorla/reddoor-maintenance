import type { PageLoad } from "./$types";
import { fromSnapshot } from "../lib/snapshot.js";
import { overviewFromSnapshot } from "../lib/overview/view.js";

// P1-78g: the overview takes `/`; the triage page stays at /triage.
export const load: PageLoad = ({ parent }) =>
  fromSnapshot("overview", parent, (snapshot, now) => ({
    view: overviewFromSnapshot(snapshot, now),
  }));
