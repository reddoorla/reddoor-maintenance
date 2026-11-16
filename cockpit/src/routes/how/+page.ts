import type { PageLoad } from "./$types";
import { fromSnapshot } from "../../lib/snapshot.js";
import { howFromSnapshot } from "../../lib/how/view.js";

// P1-87: "How this works", beside the overview in the nav.
export const load: PageLoad = ({ parent }) =>
  fromSnapshot("how", parent, (snapshot, now) => ({ view: howFromSnapshot(snapshot, now) }));
