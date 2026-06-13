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

/**
 * Build a 502 for an UNEXPECTED handler failure (an Airtable 429/500, a network
 * timeout). Logs the real error server-side so the operator sees it in the
 * function logs, but returns a generic, retry-able body — never the error/stack
 * itself — so a transient backend hiccup degrades to a clean "try again" rather
 * than an unhandled rejection (whose surfaced status/body we don't control).
 * Use in each handler's top-level catch around the Airtable + render section.
 */
export function handlerError(service: string, err: unknown): Response {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(`[${service}] unexpected failure: ${detail}`);
  return new Response("Temporarily unavailable — please retry in a moment.", {
    status: 502,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
