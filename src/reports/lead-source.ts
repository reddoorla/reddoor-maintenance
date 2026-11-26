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
 * a lead nobody can place on the live site is not counted. A site `url` stored
 * without a scheme (`client.com`) is read as `https://`, so a hand-typed roster
 * row does not silently zero its leads, and a trailing dot on either host (the
 * DNS root, `client.com.`) is ignored. Only an http(s) page counts. Comparing against the site's CURRENT url
 * means a site that moves domain stops counting leads from its old one. Measured on 2026-11-25,
 * no non-spam submission in the fleet lacked a `source_url`
 * (reddoorla/reddoor-maintenance#2296).
 */
export function isProductionSource(sourceUrl: string | null, siteUrl: string): boolean {
  if (!sourceUrl) return false;
  const source = webUrl(sourceUrl);
  const site = webUrl(siteUrl) ?? webUrl(`https://${siteUrl.trim()}`);
  if (!source || !site) return false;
  return isSiteHost(withoutRootDot(source.hostname), withoutRootDot(site.hostname));
}

/** `s` as an http(s) URL, or null. `client.com:8080` parses as the scheme
 *  `client.com:`, so it is null here and the caller's `https://` retry reads it
 *  as the host it is. An http(s) URL that parses always has a host. */
function webUrl(s: string): URL | null {
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url : null;
}

/** `client.com.` is `client.com`: a trailing dot names the DNS root. */
function withoutRootDot(host: string): string {
  return host.replace(/\.+$/, "");
}

/** `example.com,` or `reddoorla.com>.` is the domain before its trailing ASCII
 *  punctuation: a typed comma or a pasted `>` does not make a test address real.
 *  It strips the DNS root's trailing dots too. */
function withoutTrailingPunctuation(domain: string): string {
  return domain.replace(/[!-/:-@[-`{-~]+$/, "");
}

/** Reddoor's own domain: a submission from it is Reddoor testing a form, never a
 *  client's lead. The domain, not a person: any local part or `+tag` matches. */
const REDDOOR_DOMAIN = "reddoorla.com";

/** Second-level domains reserved for documentation (RFC 2606); no mail reaches them. */
const RESERVED_DOMAINS = ["example.com", "example.org", "example.net"];

/** Top-level domains reserved so they never resolve (RFC 2606, RFC 6761). */
const RESERVED_TLDS = new Set(["test", "invalid", "localhost", "example"]);

/** `domain` is `parent` or a subdomain of it: a dot boundary, never a bare suffix. */
function isWithin(domain: string, parent: string): boolean {
  return domain === parent || domain.endsWith(`.${parent}`);
}

/**
 * Is this the address of a test, not a person, so the submission is no lead?
 *
 * True for Reddoor's own domain and for a domain no mail can reach: the reserved
 * `example.*` domains, the reserved `.test`/`.invalid`/`.localhost`/`.example`
 * TLDs, and a one-letter TLD (none exists; the 11-10 Reddoor Pixel test used
 * `t@c.v`). It matches the domain only, never a name, so a real person whose
 * address or name says "test" still counts. The operator's pick (a), 2026-11-25
 * (reddoorla/reddoor-maintenance#2296).
 */
export function isTestSender(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = withoutTrailingPunctuation(
    email
      .slice(at + 1)
      .trim()
      .toLowerCase(),
  );
  if (domain.length === 0) return false;
  if (isWithin(domain, REDDOOR_DOMAIN)) return true;
  if (RESERVED_DOMAINS.some((d) => isWithin(domain, d))) return true;
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  return tld.length < 2 || RESERVED_TLDS.has(tld);
}

/** A non-spam, non-signup submission is one of the site's leads when it came from
 *  the site's production host and from a real sender: the one rule every lead count
 *  (report LEADS, the site page's lead panel, the digest) applies. */
export function isLead(
  submission: { sourceUrl: string | null; email: string },
  siteUrl: string,
): boolean {
  return isProductionSource(submission.sourceUrl, siteUrl) && !isTestSender(submission.email);
}
