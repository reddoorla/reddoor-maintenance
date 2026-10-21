import handler from "../../../../../lib/server/endpoints/report-rerender.js";
import { endpoint } from "../../../../../lib/server/endpoints/route.js";

export const fallback = endpoint(handler);
