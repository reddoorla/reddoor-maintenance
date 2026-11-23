import handler from "../../../lib/server/endpoints/backlog.js";
import { endpoint } from "../../../lib/server/endpoints/route.js";

export const fallback = endpoint(handler);
