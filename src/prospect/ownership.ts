import { isPrivateOrLoopbackHost } from "../util/url.js";
import { normalizePhone, PHONE_IN_TEXT } from "./consistency.js";
import { domainOf } from "./probes.js";

/**
 * Is this cited domain someone else's, or another one of the prospect's own?
 *
 * Built after getting it wrong. The accuracy stage read every cited domain that
 * was not the prospect's as "somewhere else the engine looked", and on the first
 * real run that produced the finding "an AI describes your practice using
 * dochopkins.com, cited four times against one citation of your own site" —
 * which was true except for the part that mattered: dochopkins.com is theirs
 * too, an old site they never took down.
 *
 * Getting this backwards is expensive in both directions. Calling a client's own
 * legacy site "a third party" is a factual error about their business, in a
 * document arguing that factual errors about their business are the problem.
 * And the corrected finding is the better one anyway: an engine preferring your
 * old site to your current one is a concrete thing to fix, where "a directory
 * outranks you" often is not.
 *
 * A shared phone number is the signal. Businesses change domains, names and
 * copy; the number on the door tends to survive all three, and two sites
 * publishing the same number are almost never unrelated. A redirect onto the
 * prospect's own host settles it outright.
 */

/**
 * Four answers, because three of them lead somewhere different.
 *
 * `yours` — your site, or another domain you own. Fixable by you today.
 * `platform` — a directory, review site or social profile. A listing ABOUT you
 *   that you can usually claim and correct, which is a different job from
 *   writing a page and worth naming separately.
 * `theirs` — no connection to the prospect that we could find.
 *
 *   Worded deliberately as an absence of evidence, because that is all this
 *   module establishes: no shared phone number, and no redirect home. It is
 *   NOT a finding that the domain belongs to somebody else — asserting that
 *   about a third party is a claim we cannot check, in a report whose whole
 *   argument is that unchecked claims are the problem. The user-facing string
 *   lives in `because` and says so; the variant name is kept because
 *   `DomainVerdict` already crosses a module boundary into accuracy.ts, and
 *   nothing renders the name itself.
 * `unknown` — we could not tell, and say so.
 */
export type DomainOwner = "yours" | "platform" | "theirs" | "unknown";

/**
 * Domains that are never a prospect's own site.
 *
 * Two reasons for a list rather than a probe. It is more accurate — no fetch
 * tells you Yelp is a directory — and most of these refuse an automated request
 * outright (yelp.com answers a plain fetch with 403), so probing them would fill
 * the report with "we could not tell" about the exact sources that matter most.
 *
 * Conservative on purpose: only domains whose whole business is hosting listings
 * about other businesses. Anything ambiguous gets fetched and judged on evidence.
 */
const PLATFORMS = [
  // Reviews and local directories
  "yelp.com",
  "bbb.org",
  "yellowpages.com",
  "angi.com",
  "angieslist.com",
  "thumbtack.com",
  "houzz.com",
  "tripadvisor.com",
  "nextdoor.com",
  "foursquare.com",
  "mapquest.com",
  "trustpilot.com",
  "manta.com",
  "chamberofcommerce.com",
  "birdeye.com",
  "opentable.com",
  // Health-specific
  "zocdoc.com",
  "healthgrades.com",
  "vitals.com",
  "ratemds.com",
  "webmd.com",
  "patientconnect365.com",
  "carecredit.com",
  "sharecare.com",
  "wellness.com",
  // Search and maps
  "google.com",
  "bing.com",
  "apple.com",
  "duckduckgo.com",
  // Social
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "pinterest.com",
  "reddit.com",
  // B2B directories and reference
  "crunchbase.com",
  "glassdoor.com",
  "indeed.com",
  "clutch.co",
  "g2.com",
  "capterra.com",
  "zoominfo.com",
  "dnb.com",
  "bloomberg.com",
  "wikipedia.org",
];

export type DomainVerdict = {
  domain: string;
  owner: DomainOwner;
  /** What decided it, in words a client can check. */
  because: string;
};

export type OwnershipDeps = {
  /** Returns the final URL after redirects plus the body, or null if unreachable. */
  fetchPage: (url: string) => Promise<{ finalUrl: string; body: string } | null>;
};

const TEL_LINK = /href=["']tel:([^"']+)["']/gi;

/** Every phone number a page publishes, normalized. */
export function phonesOn(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(TEL_LINK)) {
    const n = m[1] ? normalizePhone(m[1]) : null;
    if (n) out.add(n);
  }
  const text = html.replace(/<[^>]+>/g, " ");
  for (const m of text.matchAll(PHONE_IN_TEXT)) {
    const n = m[0] ? normalizePhone(m[0]) : null;
    if (n) out.add(n);
  }
  return out;
}

/**
 * A bare address literal, v4 or v6.
 *
 * Refused whether or not it is routable. An answer engine naming `8.8.8.8` as
 * a source is a model artefact, not a citation — no business's web presence is
 * an IP address — so there is nothing to lose by not fetching it, and the
 * check stays one rule instead of two.
 */
function isAddressLiteral(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(bare) || bare.includes(":");
}

/**
 * Hosts this module will not send a request to.
 *
 * Every domain reaching `classifyDomains` was named by an answer engine, and
 * every redirect it follows is chosen by a stranger's server. PR #618 hardened
 * the crawler against precisely this; the ownership fetcher was the one
 * prospect fetcher left without a guard, and it runs on a private runner whose
 * environment holds Turso, Discord and API credentials. Same best-effort bound
 * as crawl.ts: address literals only, no DNS resolution.
 */
function isUnfetchableHost(host: string): boolean {
  return host.length === 0 || isAddressLiteral(host) || isPrivateOrLoopbackHost(host);
}

/** Same registrable-ish site: equal, or one is a subdomain of the other. */
export function sameSite(a: string, b: string): boolean {
  if (a === b) return true;
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/** Redirect hops we will take. Enough for the apex → www → https chains real
 *  hosting ships; past that it is a loop, and a loop is not a website. */
const MAX_REDIRECTS = 5;

export function defaultOwnershipDeps(userAgent: string): OwnershipDeps {
  // `redirect: "manual"`, not "follow" — the pattern crawl.ts reaches for when
  // the destination is chosen by somebody else. Following automatically means
  // the request to wherever a stranger's 302 points has ALREADY been made by
  // the time anything can object, and "wherever" includes 169.254.169.254.
  // Here every hop is judged before it is taken.
  const once = async (start: string) => {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        return null;
      }
      if (target.protocol !== "https:" && target.protocol !== "http:") return null;
      if (isUnfetchableHost(target.hostname)) return null;

      let res: Response;
      try {
        res = await fetch(target.toString(), {
          redirect: "manual",
          headers: { "user-agent": userAgent },
          signal: AbortSignal.timeout(12_000),
        });
      } catch {
        return null;
      }

      const location =
        res.status >= 300 && res.status < 400 ? (res.headers.get("location") ?? null) : null;
      if (location) {
        try {
          url = new URL(location, target).toString();
        } catch {
          return null;
        }
        continue;
      }

      if (!res.ok) return null;
      try {
        // The URL we actually asked for on the last hop, which is where the
        // body came from — `res.url` is not set by every runtime under manual
        // redirects, and a wrong finalUrl here decides who owns a domain.
        return { finalUrl: target.toString(), body: await res.text() };
      } catch {
        return null;
      }
    }
    return null;
  };

  return {
    // https first, then http. The domain that prompted this whole module —
    // dochopkins.com, a client's abandoned site — serves over http and fails TLS
    // outright, so an https-only probe reported "we could not reach it" about
    // the single most important source in the report. An old site with no
    // working certificate is exactly the kind of domain this check is for.
    async fetchPage(url) {
      return (await once(url)) ?? (await once(url.replace(/^https:/, "http:")));
    },
  };
}

/**
 * Classify the domains an engine cited.
 *
 * `unknown` is a real verdict and stays available: a domain we could not reach
 * is not evidence of anything, and the report says so rather than guessing. A
 * guess here is a claim about who owns a business's web presence.
 */
export async function classifyDomains(
  prospectUrl: string,
  prospectPhones: string[],
  domains: string[],
  deps: OwnershipDeps,
): Promise<DomainVerdict[]> {
  const prospect = domainOf(prospectUrl);
  const mine = new Set(prospectPhones);
  const seen = new Set<string>();
  const out: DomainVerdict[] = [];

  for (const raw of domains) {
    const domain = domainOf(raw);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);

    if (sameSite(domain, prospect)) {
      out.push({ domain, owner: "yours", because: "Your site." });
      continue;
    }

    const platform = PLATFORMS.find((p) => sameSite(domain, p));
    if (platform) {
      out.push({ domain, owner: "platform", because: "A listing site, not a website of yours." });
      continue;
    }

    // Refused before any request is made, so an injected fetcher cannot be
    // pointed at an internal target either — see `isUnfetchableHost`. This is
    // "we did not look", not "there is nothing there", and `because` says so:
    // our own refusal to fetch must never read as a defect of theirs.
    if (isUnfetchableHost(domain)) {
      out.push({
        domain,
        owner: "unknown",
        because: "We did not fetch it: it is an internal or numeric address, not a website.",
      });
      continue;
    }

    const page = await deps.fetchPage(`https://${domain}/`);
    if (!page) {
      out.push({ domain, owner: "unknown", because: "We could not reach it to check." });
      continue;
    }

    // Where a redirect LANDED is chosen by the domain, not by us. A body served
    // from an internal address is not evidence about anyone's website, and is
    // not read.
    const landed = domainOf(page.finalUrl);
    if (isUnfetchableHost(landed)) {
      out.push({
        domain,
        owner: "unknown",
        because: "We did not read it: it redirects to an internal address.",
      });
      continue;
    }

    if (sameSite(landed, prospect)) {
      out.push({ domain, owner: "yours", because: "It redirects to your site." });
      continue;
    }

    // No phone on our side means no signal, not a negative one. Saying
    // "someone else's" on the strength of a comparison we could not make is
    // exactly the error this module exists to stop.
    if (mine.size === 0) {
      out.push({
        domain,
        owner: "unknown",
        because: "We found no phone number on your site to compare it against.",
      });
      continue;
    }

    const shared = [...phonesOn(page.body)].find((p) => mine.has(p));
    out.push(
      shared
        ? { domain, owner: "yours", because: "It publishes the same phone number as your site." }
        : { domain, owner: "theirs", because: "No connection to your site that we could find." },
    );
  }

  return out;
}
