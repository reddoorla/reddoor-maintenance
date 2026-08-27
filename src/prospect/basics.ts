import { isPrivateOrLoopbackHost } from "../util/url.js";
import type { CrawlResult, PageCapture, PageExtract } from "./types.js";

/**
 * The things a stranger would check first.
 *
 * "Does it work" was, until now, four findings and a copyright year — and on a
 * healthy site the copyright year was the loudest thing on the page, because a
 * row saying "2026 — current" occupied exactly as much of the report as a row
 * saying "eleven broken links". That is a design fault twice over: it inflates a
 * triviality, and it implies the audit checked nothing more interesting.
 *
 * What follows are the checks a person would actually make with a browser and
 * two minutes, most of which cost nothing because the crawl already holds the
 * evidence. Three of them need requests, and they are the three worth the
 * traffic: whether the address works typed the ordinary ways, and what happens
 * when someone reaches a page that is not there.
 *
 * Deliberately NOT checked here:
 *
 *   - Forms without a submit button. Plenty of real forms submit from a button
 *     that sits outside the `<form>`, or from a div with a click handler.
 *     Reporting those as broken would send a prospect to check a page that is
 *     perfectly fine, which costs more than the finding is worth.
 *   - Pages from the crawl that returned 4xx. The asset check already probes
 *     link targets and reports them; reporting the same dead URL twice under two
 *     headings reads as two problems.
 *   - Certificate expiry and TLS version. A fetch that succeeds over https has
 *     already proved the certificate is valid to a real client, and anything
 *     finer-grained is a security audit rather than a basic.
 */

/** The path used to provoke a 404. Fixed rather than random so a prospect who
 *  disputes the finding can request the same URL and see the same answer. */
export const MISSING_PATH = "/reddoor-audit-page-that-does-not-exist";

/**
 * The user-agent strings AI crawlers actually send, and a browser to compare
 * against.
 *
 * Reading robots.txt is not enough, and believing otherwise produced a
 * confidently wrong answer on the check that matters most. ludlowkingsley.com
 * publishes a robots.txt that blocks nothing relevant, and returns **403 to
 * ClaudeBot on every request** at the Cloudflare edge — 8 of 8, while a browser,
 * GPTBot, PerplexityBot and our own audit agent all get 200. The audit told them
 * "every AI crawler we checked can reach the site" while probing their
 * visibility with the one engine their CDN turns away.
 *
 * The exact strings matter. A first pass used a bare `GPTBot/1.2 (+…)` and drew
 * a 403 that vanished with the real Mozilla-prefixed string — bot management
 * matches on the whole header, so an invented UA measures the CDN's opinion of
 * our invention rather than its policy on the crawler. These are the strings the
 * vendors document.
 *
 * `Google-Extended` is deliberately absent: Google publishes no such user agent.
 * It is a robots.txt control token, and the fetching is done by Googlebot — so
 * there is nothing to probe, and probing an invented "Google-Extended" UA would
 * manufacture a finding.
 */
export const CRAWLER_AGENTS: { agent: string; ua: string }[] = [
  {
    agent: "GPTBot",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
  },
  {
    agent: "OAI-SearchBot",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
  },
  { agent: "ClaudeBot", ua: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" },
  {
    agent: "PerplexityBot",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot",
  },
  { agent: "CCBot", ua: "CCBot/2.0 (https://commoncrawl.org/faq/)" },
];

/** The control. Every verdict below is a comparison against this, never against
 *  an absolute status — a site that is down answers everyone badly, and that is
 *  an outage, not a crawler policy. */
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export type BasicsProbe = {
  /** Final status after redirects; the request throwing is an error, not a status. */
  status: number;
  /** Where the request landed after redirects. */
  finalUrl: string;
  /** Response body, used only to tell a styled 404 from a bare server error. */
  body: string;
};

export type BasicsDeps = {
  probe: (url: string) => Promise<BasicsProbe>;
  /** Same fetch, with a chosen user-agent. Separate from `probe` because these
   *  requests are about the HEADER, not the URL. */
  probeAs?: (url: string, userAgent: string) => Promise<BasicsProbe>;
};

/** What one AI crawler gets when it asks for the homepage, next to what a
 *  browser gets. `blocked` is always a COMPARISON — a site that is down answers
 *  everyone badly, and that is an outage, not a crawler policy. */
export type CrawlerReach = {
  agent: string;
  status: number | null;
  blocked: boolean;
  error: string | null;
};

export type CrawlerReachability = {
  /** False when the browser control itself failed, so nothing below can be
   *  attributed to crawler policy and the report must say "not measured". */
  measured: boolean;
  browserStatus: number | null;
  agents: CrawlerReach[];
  /** Agents served something a browser is not. The finding. */
  blocked: string[];
};

/** One reachability answer. `measured: false` means the request failed for a
 *  reason that is ours or the network's, not the site's — and a report must say
 *  "not measured" rather than convert our own failure into their defect. */
export type Reachability = {
  measured: boolean;
  /** What was requested, so the finding has an address the reader can try. */
  url: string;
  ok: boolean;
  /** Where it landed, when it landed anywhere. */
  landedOn: string | null;
  error: string | null;
};

export type BasicsCheck = {
  /**
   * Typing the address without `https://`. Browsers still default to plain
   * http for a bare hostname in plenty of places — a pasted link in a text
   * message, an old bookmark, a printed card — and a site that does not
   * redirect either shows a "Not secure" warning or does not answer at all.
   */
  insecureEntry: Reachability;
  /**
   * The other of www / apex. Whichever one the site does not use, somebody
   * types anyway; if it has no DNS record the visitor gets a browser error page
   * with the site's name on it.
   */
  hostVariant: Reachability & { host: string };
  /**
   * A URL that cannot exist. Two things can be wrong: the server answers 200
   * (a "soft 404" — search engines index the junk and a mistyped link looks
   * like a real page), or it answers 404 with a bare server error page carrying
   * no way back into the site.
   */
  notFound: Reachability & {
    status: number | null;
    /** Did the response carry any link back into the site? A default nginx or
     *  Apache error page carries none, and a visitor who lands there leaves. */
    linksBackToSite: boolean;
  };
  /**
   * Images loaded over plain http on an https page. Browsers block or refuse to
   * upgrade these, so they are broken images for some visitors and a mixed-
   * content warning for the rest. `measured` is false when the site is not on
   * https at all, in which case `insecureEntry` is the finding instead.
   */
  mixedContent: { measured: boolean; imageUrls: string[]; imagesSeen: number };
  /** Alt text coverage across the pages examined. An image counted once per page
   *  it appears on — the ratio is the honest reading, not the totals. */
  altText: { imagesTotal: number; imagesWithAlt: number; pagesExamined: number };
  /** Titles used by more than one page. The browser tab, the bookmark and the
   *  search result all show this text, and repeating it makes them
   *  indistinguishable. */
  duplicateTitles: { title: string; pages: string[] }[];
  /**
   * What each AI crawler is actually served, as opposed to what robots.txt says
   * it may have.
   *
   * These are different questions and the audit used to answer only the first
   * while reporting the second. robots.txt is a request the site publishes; a
   * CDN's bot management is an answer it enforces, and the second can contradict
   * the first without the owner knowing. Verified on a live prospect: see the
   * note on CRAWLER_AGENTS.
   *
   * Undefined on reports stored before this existed — absence is "not measured",
   * never "nothing blocked".
   */
  crawlerReachability?: CrawlerReachability;
};

function extractOf(page: PageCapture): PageExtract | null {
  return page.rendered ?? page.raw;
}

/** The www/apex counterpart of a hostname, or null when there is no sensible
 *  one — a subdomain like `shop.example.com` has no counterpart worth probing,
 *  and `www.` is not a thing you add to it. */
export function counterpartHost(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (host.startsWith("www.")) return host.slice(4);
  // Exactly two labels — an apex like `example.com` or `example.co`. Anything
  // longer is already a subdomain of something, and prefixing `www.` to
  // `shop.example.com` probes a host nobody has ever published.
  return host.split(".").length === 2 ? `www.${host}` : null;
}

/** Same registrable site, ignoring a `www.` prefix — so an apex that redirects
 *  to www counts as landing where it should. */
function sameSite(a: string, b: string): boolean {
  const strip = (h: string): string => h.toLowerCase().replace(/^www\./, "");
  try {
    return strip(new URL(a).hostname) === strip(new URL(b).hostname);
  } catch {
    return false;
  }
}

async function reach(
  url: string,
  deps: BasicsDeps,
  judge: (probe: BasicsProbe) => boolean,
): Promise<Reachability & { probe: BasicsProbe | null }> {
  try {
    const probe = await deps.probe(url);
    return { measured: true, url, ok: judge(probe), landedOn: probe.finalUrl, error: null, probe };
  } catch (err) {
    return {
      measured: false,
      url,
      ok: false,
      landedOn: null,
      error: err instanceof Error ? err.message : String(err),
      probe: null,
    };
  }
}

/** Does this HTML carry a link back into the site? Used only on the 404
 *  response, to tell a page the owner designed from the web server's default. */
export function hasSiteLink(html: string, origin: string): boolean {
  let originHost: string;
  try {
    originHost = new URL(origin).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const href = (match[1] ?? "").trim();
    if (!href || href.startsWith("#")) continue;
    // A relative href on the site's own 404 page points back into the site by
    // definition — no resolution needed, and resolving would only introduce a
    // way to get it wrong.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("//")) return true;
    try {
      if (new URL(href, origin).hostname.toLowerCase().replace(/^www\./, "") === originHost) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Ask for the homepage as each AI crawler, and as a browser, and compare.
 *
 * Only a DIFFERENCE is reportable. An absolute status cannot distinguish "this
 * CDN turns ClaudeBot away" from "this site is down", and only the first is a
 * finding about the prospect. A crawler that gets the same answer as a browser
 * is recorded as not blocked — which is a statement about this moment, not a
 * guarantee: bot management also keys on IP reputation, geography and rate, none
 * of which one request from us can characterise.
 */
async function checkCrawlerReach(
  origin: string,
  probeAs: (url: string, ua: string) => Promise<BasicsProbe>,
): Promise<CrawlerReachability> {
  const url = `${origin}/`;
  let browserStatus: number;
  try {
    browserStatus = (await probeAs(url, BROWSER_UA)).status;
  } catch {
    // No control, no comparison. Everything below would be unattributable.
    return { measured: false, browserStatus: null, agents: [], blocked: [] };
  }

  const agents: CrawlerReach[] = [];
  for (const { agent, ua } of CRAWLER_AGENTS) {
    try {
      const { status } = await probeAs(url, ua);
      agents.push({ agent, status, blocked: status !== browserStatus, error: null });
    } catch (err) {
      // A thrown request is ours or the network's — never reported as a block.
      agents.push({
        agent,
        status: null,
        blocked: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    // A browser control that itself failed to load leaves nothing to compare
    // against, and a site erroring for everyone is an outage, not a policy.
    measured: browserStatus < 400,
    browserStatus,
    agents,
    blocked: agents.filter((a) => a.blocked).map((a) => a.agent),
  };
}

export async function checkBasics(crawl: CrawlResult, deps: BasicsDeps): Promise<BasicsCheck> {
  const origin = new URL(crawl.origin);
  const usable = crawl.pages.map(extractOf).filter((e): e is PageExtract => e !== null);

  // ── Reachability: three requests, no more ──────────────────────────────
  //
  // Sequential rather than concurrent, for the same reason the crawl is: this
  // is a stranger's server and we are here uninvited.

  const insecure = await reach(`http://${origin.host}/`, deps, (p) => {
    // Landing on https is the pass. A 4xx/5xx over http is a fail even if the
    // protocol is right — the visitor still sees nothing.
    let landed: URL;
    try {
      landed = new URL(p.finalUrl);
    } catch {
      return false;
    }
    return landed.protocol === "https:" && p.status < 400;
  });

  const otherHost = counterpartHost(origin.hostname);
  const hostVariant: BasicsCheck["hostVariant"] =
    otherHost === null || isPrivateOrLoopbackHost(otherHost)
      ? {
          measured: false,
          url: "",
          host: otherHost ?? "",
          ok: false,
          landedOn: null,
          // Not a defect and not a failure: there is simply no counterpart to
          // check. Distinguished from a failed request by the empty url.
          error: null,
        }
      : await (async () => {
          const url = `${origin.protocol}//${otherHost}/`;
          const r = await reach(url, deps, (p) => p.status < 400 && sameSite(p.finalUrl, origin.href));
          return { measured: r.measured, url, host: otherHost, ok: r.ok, landedOn: r.landedOn, error: r.error };
        })();

  const missing = await reach(`${crawl.origin}${MISSING_PATH}`, deps, (p) => p.status === 404);
  const linksBackToSite = missing.probe ? hasSiteLink(missing.probe.body, crawl.origin) : false;
  const notFound: BasicsCheck["notFound"] = {
    measured: missing.measured,
    url: missing.url,
    // Both halves have to hold: the right status AND a page the visitor can
    // leave. A correct 404 that is a blank server error is still a dead end.
    ok: missing.ok && linksBackToSite,
    landedOn: missing.landedOn,
    error: missing.error,
    status: missing.probe?.status ?? null,
    linksBackToSite,
  };

  // ── Derived from the crawl: no requests at all ─────────────────────────

  const isHttps = origin.protocol === "https:";
  const insecureImages = new Set<string>();
  let imagesSeen = 0;
  let imagesTotal = 0;
  let imagesWithAlt = 0;
  const titles = new Map<string, string[]>();

  for (const page of crawl.pages) {
    const extract = extractOf(page);
    if (!extract) continue;
    imagesTotal += extract.images.total;
    imagesWithAlt += extract.images.withAlt;
    for (const src of extract.imageSrcs ?? []) {
      imagesSeen += 1;
      if (isHttps && /^http:\/\//i.test(src.trim())) insecureImages.add(src.trim());
    }
    const title = extract.title?.trim();
    if (title) {
      const pages = titles.get(title);
      if (pages) {
        if (!pages.includes(page.url)) pages.push(page.url);
      } else {
        titles.set(title, [page.url]);
      }
    }
  }

  return {
    insecureEntry: {
      measured: insecure.measured,
      url: insecure.url,
      ok: insecure.ok,
      landedOn: insecure.landedOn,
      error: insecure.error,
    },
    hostVariant,
    notFound,
    mixedContent: {
      // Only meaningful on an https site, and only over the images the extract
      // records — stylesheets and scripts are not captured, so the report must
      // not claim to have checked them.
      measured: isHttps && usable.length > 0,
      imageUrls: [...insecureImages].slice(0, 12),
      imagesSeen,
    },
    altText: { imagesTotal, imagesWithAlt, pagesExamined: usable.length },
    duplicateTitles: [...titles.entries()]
      .filter(([, pages]) => pages.length > 1)
      .map(([title, pages]) => ({ title, pages }))
      .sort((a, b) => b.pages.length - a.pages.length),
    // Optional dependency: without a UA-capable probe this check simply does not
    // run, and its absence reads as "not measured" rather than "nothing blocked".
    ...(deps.probeAs
      ? { crawlerReachability: await checkCrawlerReach(crawl.origin, deps.probeAs) }
      : {}),
  };
}
