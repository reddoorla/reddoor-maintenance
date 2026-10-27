import type { WebsiteRow } from "./site-row.js";

export const NO_ANALYTICS = "no analytics";
export const NO_SEARCH_CONSOLE = "no search console";

export const ANALYTICS_OPT_OUT_KEYS: [string, ...string[]] = [
  NO_ANALYTICS,
  "no-analytics",
  "analytics",
  "ga4",
];
export const SEARCH_CONSOLE_OPT_OUT_KEYS: [string, ...string[]] = [
  NO_SEARCH_CONSOLE,
  "no-search-console",
  "search console",
  "gsc",
];

function acceptsAny(row: WebsiteRow, keys: readonly string[]): boolean {
  const accepted = new Set(row.acceptedWatchConditions.map((c) => c.trim().toLowerCase()));
  return keys.some((k) => accepted.has(k));
}

export function analyticsOptedOut(row: WebsiteRow): boolean {
  return acceptsAny(row, ANALYTICS_OPT_OUT_KEYS);
}

export function searchConsoleOptedOut(row: WebsiteRow): boolean {
  return acceptsAny(row, SEARCH_CONSOLE_OPT_OUT_KEYS);
}
