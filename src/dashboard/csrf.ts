/**
 * CSRF verdict for a state-changing POST reachable with the ambient Basic-auth
 * creds the browser replays cross-site. Extracted from approve-report.mts as a
 * pure function so the decision logic is unit-testable without booting the
 * Netlify handler — the handler stays thin glue over this.
 *
 * Returns true (allow) only for a same-origin signal or the total absence of any
 * cross-site signal (legacy/non-browser clients); false (reject with 403) on any
 * cross-site signal.
 *
 *  1. Sec-Fetch-Site present → must be "same-origin"/"none"; anything else
 *     ("cross-site"/"same-site") is a cross-site signal → reject.
 *  2. Sec-Fetch-Site absent but Origin (or, lacking it, the Referer's origin)
 *     present → its host must equal the request's own host → reject on mismatch.
 *  3. No Sec-Fetch AND no Origin AND no Referer → legacy/non-browser client with
 *     no cross-site signal at all → allow (still gated by Basic auth downstream).
 */

/**
 * The minimal header/url surface isCsrfAllowed needs. A whatwg `Request`
 * satisfies it, but typing against this shape keeps the helper free of the
 * `@netlify/functions` / DOM lib that only the handler needs.
 */
export type CsrfRequestLike = {
  headers: { get: (name: string) => string | null };
  url: string;
};

/** The request's own host, preferring the Host header (authoritative behind
 *  Netlify) and falling back to the deployment URL parsed from req.url. */
export function requestHost(req: CsrfRequestLike): string | null {
  const hostHeader = req.headers.get("host");
  if (hostHeader) return hostHeader.toLowerCase();
  try {
    return new URL(req.url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Parse the host out of an absolute Origin/Referer URL; null if absent/garbage. */
export function originHost(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

export function isCsrfAllowed(req: CsrfRequestLike): boolean {
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite !== null) {
    return secFetchSite === "same-origin" || secFetchSite === "none";
  }
  // Fallback when Sec-Fetch-Site is absent: compare Origin (then Referer) host
  // against the request's own host.
  const claimedHost =
    originHost(req.headers.get("origin")) ?? originHost(req.headers.get("referer"));
  if (claimedHost === null) {
    // No cross-site signal at all — legacy/non-browser client. Allow.
    return true;
  }
  const ownHost = requestHost(req);
  return ownHost !== null && claimedHost === ownHost;
}
