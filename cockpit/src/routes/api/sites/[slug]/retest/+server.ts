import handler from "../../../../../lib/server/endpoints/site-retest.js";
import { endpoint } from "../../../../../lib/server/endpoints/route.js";

export const fallback = endpoint(handler);
