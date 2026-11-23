import type { PageServerLoad } from "./$types";
import { loadBacklogPanel } from "../../../../src/dashboard/backlog-source.js";

// P1-111: the backlog's top five, read from the private workspace repo per
// request. Only this page's server load reads it, so the layout's snapshot and
// every other page stay as they were; the hook's sign-in gate runs first.
export const load: PageServerLoad = async () => ({
  backlog: await loadBacklogPanel({ token: process.env.GH_TOKEN }),
});
