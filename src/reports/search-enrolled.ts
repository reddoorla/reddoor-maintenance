import type { WebsiteRow } from "../fleet/site-row.js";
import { searchConsoleOptedOut } from "../fleet/opt-outs.js";

export function searchEnrolled(row: WebsiteRow): boolean {
  if (searchConsoleOptedOut(row)) return false;
  return Boolean(row.ga4PropertyId || row.searchQuery || row.searchConsoleProperty?.trim());
}
