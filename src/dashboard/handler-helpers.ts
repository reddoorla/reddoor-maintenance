/**
 * Small pure helpers shared by the dashboard's endpoint handlers and pages (the
 * SvelteKit cockpit, #582) and its remaining Netlify functions, so their
 * non-glue logic is unit-testable without booting either.
 */

const DEFAULT_DASHBOARD_BASE_URL = "https://dashboard.reddoorla.com";

/** The cockpit's own domain (P1-122): the default base URL's host. */
export const DASHBOARD_HOST = "dashboard.reddoorla.com";

/**
 * The cockpit's address before P1-122. It stays live with no redirect, because
 * every fleet site's FORMS_INGEST_URL and the Resend webhook registration POST
 * to it (Netlify does not redirect a site's netlify.app host to its custom
 * domain; measured on four fleet sites, maintenance#2238).
 */
export const LEGACY_DASHBOARD_HOST = "reddoor-maintenance.netlify.app";

/**
 * Resolve the dashboard's public base URL from the optional DASHBOARD_BASE_URL
 * env var: trim it, fall back to the cockpit's own domain when unset/blank,
 * and strip a trailing slash so callers can append `/s/:slug` cleanly.
 */
export function resolveDashboardBaseUrl(raw: string | undefined): string {
  return (raw?.trim() || DEFAULT_DASHBOARD_BASE_URL).replace(/\/$/, "");
}

/**
 * Build a 502 for an UNEXPECTED handler failure (a Turso error, a network
 * timeout). Logs the real error server-side so the operator sees it in the
 * function logs, but returns a generic, retry-able body — never the error/stack
 * itself — so a transient backend hiccup degrades to a clean "try again" rather
 * than an unhandled rejection (whose surfaced status/body we don't control).
 * Use in each handler's top-level catch around the store + render section.
 */
export function handlerError(service: string, err: unknown): Response {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(`[${service}] unexpected failure: ${detail}`);
  return new Response("Temporarily unavailable — please retry in a moment.", {
    status: 502,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
