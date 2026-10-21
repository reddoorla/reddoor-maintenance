import handler from "../../../../../lib/server/endpoints/site-details.js";
import { endpoint } from "../../../../../lib/server/endpoints/route.js";

export const fallback = endpoint(handler);
