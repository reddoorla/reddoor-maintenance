import handler from "../../../../../lib/server/endpoints/refresh-fleet.js";
import { endpoint } from "../../../../../lib/server/endpoints/route.js";

export const fallback = endpoint(handler);
