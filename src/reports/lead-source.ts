import { isSiteHost } from "../client/site-host.js";

/**
 * Was this submission sent from the site's own production host, so it can be a lead?
 *
 * A lead is a submission from the site's own page, on its apex or `www` host: the
 * same `siteHostnames` pair GA's report query filters on, so a report's visits and
 * its leads are counted over the same hosts. Matching is exact, never by suffix, so
 * `staging.<domain>`, a deploy preview, a `*.netlify.app` host that is not the
 * site's own, and `localhost` (smoke and a11y runs) never count. Neither does a
 * missing or unparseable `source_url`, nor a site whose own `url` gives no host:
 * a lead nobody can place on the live site is not counted. Measured on 2026-11-25,
 * no non-spam submission in the fleet lacked a `source_url`
 * (reddoorla/reddoor-maintenance#2296).
 */
export function isProductionSource(sourceUrl: string | null, siteUrl: string): boolean {
  if (!sourceUrl) return false;
  let source: URL;
  let site: URL;
  try {
    source = new URL(sourceUrl);
    site = new URL(siteUrl);
  } catch {
    return false;
  }
  return isSiteHost(source.hostname, site.hostname);
}
