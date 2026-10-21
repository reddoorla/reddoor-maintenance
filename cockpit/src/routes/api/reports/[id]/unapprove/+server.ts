import handler from "../../../../../lib/server/endpoints/unapprove-report.js";
import { endpoint } from "../../../../../lib/server/endpoints/route.js";

export const fallback = endpoint(handler);
