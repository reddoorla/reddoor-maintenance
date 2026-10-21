import handler from "../../../../lib/server/endpoints/prospect-audit-run.js";
import { endpoint } from "../../../../lib/server/endpoints/route.js";

export const fallback = endpoint(handler);
