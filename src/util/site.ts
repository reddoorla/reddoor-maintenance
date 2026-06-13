import type { Site } from "../types.js";

/** Human-friendly label for log/output formatting. Prefer the inventory's
 * `name` when present (e.g. "caltex-landing") and fall back to the
 * filesystem `path` when unnamed. Every audit + recipe uses this.
 *
 * Uses `||` (not `??`) deliberately: an Airtable Name that slugs to the EMPTY
 * string (`siteSlug("!!!")` → "") is `""`, not null/undefined, so `??` would let
 * it through and render a blank label. `||` falls back to the path. */
export function siteLabel(site: Site): string {
  return site.name || site.path;
}
