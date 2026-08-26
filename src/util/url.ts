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
 * The hostname of `s`, or `s` itself when it doesn't parse as a URL — a
 * human-facing fallback label, never a thrown error. Used anywhere a short
 * site label is wanted and the full URL would be noisy: the prospect-audit
 * CLI's summary line and its report's <h1>/title both fall back to this when
 * no business name was resolved.
 */
export function hostnameOf(s: string): string {
  try {
    return new URL(s).hostname;
  } catch {
    return s;
  }
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
 * True when `hostname` is a loopback, private, link-local, unique-local, or
 * CGNAT literal address (or the `localhost` name) — the address-literal core
 * that used to live only inside `isPublicHttpsUrl`, pulled out so a caller
 * that legitimately handles non-https schemes (the prospect-audit crawler
 * audits plain http sites too) can still refuse to follow a redirect onto an
 * internal target. Scheme-agnostic on purpose: the caller decides which
 * protocols are acceptable, this only judges the host.
 *
 * Best-effort by literal address — it does NOT resolve DNS, so a hostname
 * that resolves to a private IP is not caught. That is a deliberate,
 * proportionate bound for an operator-run CLI, not a complete SSRF guard.
 */
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // Strip IPv6 brackets (`[::1]` → `::1`).
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.includes(":")) {
    // IPv6 literal: block loopback (::1), unspecified (::), link-local (fe80::/10),
    // and unique-local (fc00::/7).
    if (host === "::1" || host === "::") return true;
    if (/^fe[89ab]/.test(host)) return true;
    if (/^f[cd]/.test(host)) return true;
    // IPv4-mapped (`::ffff:a.b.c.d`, normalized by URL to `::ffff:aabb:ccdd`) and
    // NAT64 (`64:ff9b::/96`) embed a v4 address the dotted-quad block below never
    // sees — refuse both wholesale (no legitimate target uses these forms).
    if (host.startsWith("::ffff:") || host.startsWith("64:ff9b:")) return true;
    // The deprecated IPv4-COMPATIBLE form (`::a.b.c.d`) normalizes to a bare
    // `::x:y` with no `ffff:` marker, so the branch above misses it. Not
    // routable to loopback on Linux, but it costs one line to stop reasoning
    // about which stacks honour it: anything in `::/96` other than the
    // unspecified address embeds a v4 literal the dotted-quad block never sees.
    if (/^::(?!$)(?!0*:?$)[0-9a-f]{0,4}:?[0-9a-f]{0,4}$/.test(host)) return true;
    return false;
  }
  // IPv4 dotted-quad: block the private/loopback/link-local/CGNAT ranges.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }
  // A registered hostname (not a literal IP) — accept; DNS isn't resolved here.
  return false;
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
  return !isPrivateOrLoopbackHost(parsed.hostname);
}
