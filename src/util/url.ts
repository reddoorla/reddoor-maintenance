/**
 * True when `s` parses as an absolute URL whose scheme is `http:` or `https:`.
 *
 * The single allowlist gate for any value we hand to Chrome/Lighthouse. A
 * deployed-audit URL flows in from Airtable's `url` column (or a JSON
 * inventory's `deployedUrl`), so a `file://`/`gopher://`/`data:` value — or a
 * value pointing at an internal host — would otherwise become a local-file read
 * or SSRF when lhci drives a headless browser at it. Restricting to http(s)
 * keeps the audit to the real, network-reachable site.
 */
export function isHttpUrl(s: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/**
 * True when `s` is a URL served from Netlify's default `*.netlify.app` host —
 * i.e. the site has no custom domain. Matches the apex `netlify.app` and any
 * subdomain of it (including deploy-preview hosts like `branch--site.netlify.app`),
 * but is not fooled by a look-alike such as `foo.netlify.app.evil.com` (the host
 * must END at `.netlify.app`). An unparseable/empty value is not a match.
 */
export function isNetlifyAppUrl(s: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return host === "netlify.app" || host.endsWith(".netlify.app");
}
