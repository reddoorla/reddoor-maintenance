import handler from "../../../lib/server/endpoints/auth.js";
import { endpoint } from "../../../lib/server/endpoints/route.js";

export const fallback = endpoint(handler);
