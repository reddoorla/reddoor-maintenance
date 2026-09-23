/**
 * The apex/www hostname pair a fleet site's own traffic can legitimately
 * arrive on.
 *
 * This rule has TWO consumers and they must never disagree:
 *
 * - `initAnalytics` (src/client/analytics.ts) uses it to decide whether to
 *   load the GA4 tag at all, so previews and `localhost` never reach the
 *   property.
 * - `measuredHostnames` (src/reports/ga/client.ts) uses it to filter the Data
 *   API query the monthly report reads back.
 *
 * Splitting them would be a silent, asymmetric failure: a tag that fires on a
 * host the reader filters out collects data that no report can see, and the
 * site looks like it has no traffic rather than like it is misconfigured.
 * That is precisely the shape of the three sites found on 2026-09-22 carrying
 * a property with nothing feeding it, so the rule lives in ONE function that
 * both sides import.
 *
 * Framework-free and dependency-free: this module is bundled into every fleet
 * site's client build, and `src/client/index.ts` documents that contract.
 */

/**
 * The hostnames equivalent to `hostname`, as `[apex, "www." + apex]`.
 *
 * A bare label with no dot (`localhost`, `""`) has no apex/www twin and
 * returns `[]`. So does a value that reduces to nothing once `www.` is
 * stripped, which would otherwise yield an empty hostname — a filter value
 * matching nothing, i.e. a silent zero.
 *
 * A subdomain is its OWN host, deliberately: `staging.example.com` returns
 * `["staging.example.com", "www.staging.example.com"]` and never the
 * production apex, so a staging deploy can neither emit into nor be counted
 * by the production property.
 */
export function siteHostnames(hostname: string): string[] {
  const host = hostname.trim().toLowerCase();
  if (!host.includes(".")) return [];
  const apex = host.startsWith("www.") ? host.slice(4) : host;
  if (!apex.includes(".")) return [];
  return [apex, `www.${apex}`];
}

/**
 * True when `hostname` is `productionHost` or its apex/www twin.
 *
 * Returns false when `productionHost` has no usable pair, so an unset or
 * malformed production host keeps the tag OFF. That direction matters: the
 * failure mode of guessing wrong is polluting a client's property with
 * preview traffic, which cannot be undone after the fact.
 */
export function isSiteHost(hostname: string, productionHost: string): boolean {
  const allowed = siteHostnames(productionHost);
  if (allowed.length === 0) return false;
  return allowed.includes(hostname.trim().toLowerCase());
}
