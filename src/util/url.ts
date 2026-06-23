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

/**
 * True when `s` is an `https:` URL whose host is NOT an obviously-internal target
 * (loopback / private / link-local / unique-local / CGNAT). The newsletter
 * webhook URL is operator-set in Airtable but fires server-side, so this blocks
 * the SSRF vector of pointing it at `127.0.0.1` / `10.x` / `169.254.x` / `::1`.
 *
 * Best-effort by host literal — it does NOT resolve DNS, so a hostname that
 * resolves to a private IP is not caught. Defense-in-depth, not a complete SSRF
 * guard (the response is never returned to the caller either, so it's a log
 * oracle at most).
 */
export function isPublicHttpsUrl(s: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  let host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  // Strip IPv6 brackets (`[::1]` → `::1`).
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.includes(":")) {
    // IPv6 literal: block loopback (::1), unspecified (::), link-local (fe80::/10),
    // and unique-local (fc00::/7).
    if (host === "::1" || host === "::") return false;
    if (/^fe[89ab]/.test(host)) return false;
    if (/^f[cd]/.test(host)) return false;
    // IPv4-mapped (`::ffff:a.b.c.d`, normalized by URL to `::ffff:aabb:ccdd`) and
    // NAT64 (`64:ff9b::/96`) embed a v4 address the dotted-quad block below never
    // sees — refuse both wholesale (no legitimate webhook target uses these forms).
    if (host.startsWith("::ffff:") || host.startsWith("64:ff9b:")) return false;
    return true;
  }
  // IPv4 dotted-quad: block the private/loopback/link-local/CGNAT ranges.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false; // link-local
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return false; // 172.16/12
    if (a === 192 && b === 168) return false; // 192.168/16
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return false; // CGNAT 100.64/10
    return true;
  }
  // A registered hostname (not a literal IP) — accept; DNS isn't resolved here.
  return true;
}
