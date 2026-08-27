import { normalizePhone } from "./consistency.js";
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
 * `theirs` — somebody else's website entirely.
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
const PHONE_IN_TEXT = /(\+?\d[\d().\-\s]{7,}\d)/g;

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

/** Same registrable-ish site: equal, or one is a subdomain of the other. */
export function sameSite(a: string, b: string): boolean {
  if (a === b) return true;
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function defaultOwnershipDeps(userAgent: string): OwnershipDeps {
  const once = async (url: string) => {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        headers: { "user-agent": userAgent },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) return null;
      return { finalUrl: res.url, body: await res.text() };
    } catch {
      return null;
    }
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

    const page = await deps.fetchPage(`https://${domain}/`);
    if (!page) {
      out.push({ domain, owner: "unknown", because: "We could not reach it to check." });
      continue;
    }

    if (sameSite(domainOf(page.finalUrl), prospect)) {
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
