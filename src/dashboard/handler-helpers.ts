/**
 * Small pure helpers extracted from the Netlify dashboard handlers
 * (fleet-homepage.mts, site-dashboard.mts) so their non-glue logic is
 * unit-testable without booting a Netlify function.
 */

const DEFAULT_DASHBOARD_BASE_URL = "https://reddoor-maintenance.netlify.app";

/**
 * Resolve the dashboard's public base URL from the optional DASHBOARD_BASE_URL
 * env var: trim it, fall back to the canonical Netlify URL when unset/blank,
 * and strip a trailing slash so callers can append `/s/:slug` cleanly.
 */
export function resolveDashboardBaseUrl(raw: string | undefined): string {
  return (raw?.trim() || DEFAULT_DASHBOARD_BASE_URL).replace(/\/$/, "");
}

/**
 * Resolve the requested site slug from the path param (Netlify
 * `ctx.params.slug`) or, lacking it, the `?slug=` query param. Null when
 * neither is present (→ the handler's presence-only health check).
 */
export function resolveSlug(
  paramSlug: string | undefined,
  querySlug: string | null,
): string | null {
  return paramSlug ?? querySlug ?? null;
}
