import handler from "../../../../../lib/server/endpoints/submission-status.js";
import { endpoint } from "../../../../../lib/server/endpoints/route.js";

export const fallback = endpoint(handler);
