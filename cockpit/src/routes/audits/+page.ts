import type { PageLoad } from "./$types";
import { auditsFromSnapshot } from "../../../../src/dashboard/snapshot-views.js";
import { fromSnapshot } from "../../lib/snapshot.js";
import { auditsPageView } from "../../lib/audits/view.js";

// GET-only: the Run form POSTs to /api/prospect-audit/run, an endpoint route
// with its own CSRF gate. Nothing here changes state.
export const load: PageLoad = ({ parent }) =>
  fromSnapshot("audits", parent, (snapshot, now) =>
    auditsPageView(auditsFromSnapshot(snapshot), now),
  );
