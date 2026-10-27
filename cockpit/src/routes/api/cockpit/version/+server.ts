import handler from "../../../../lib/server/endpoints/cockpit-version.js";
import { endpoint } from "../../../../lib/server/endpoints/route.js";

export const fallback = endpoint(handler);
