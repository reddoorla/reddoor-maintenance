import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of a request-provided token against the token
 * stored on the Websites row in Airtable. Used by the per-site dashboard
 * Netlify function to gate /s/<slug>?t=<token>.
 *
 * Returns false for any of:
 * - provided token missing / empty
 * - expected token missing (the site has no Dashboard Token configured)
 * - lengths differ (constant-time path skipped because `timingSafeEqual`
 *   throws on length mismatch — the length difference itself doesn't leak
 *   anything secret since the expected token's length is fixed per site)
 *
 * Treats null/undefined/empty-string from the request as a single
 * "no token" state — keeps the handler's branching simple.
 */
export function verifyDashboardToken(
  provided: string | null | undefined,
  expected: string | null,
): boolean {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, "utf-8"), Buffer.from(expected, "utf-8"));
}
