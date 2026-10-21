import handler from "../../../../../lib/server/endpoints/trigger-renovate.js";
import { endpoint } from "../../../../../lib/server/endpoints/route.js";

export const fallback = endpoint(handler);
