import type { PageCapture, PageExtract } from "./types.js";

/**
 * Can a visitor actually get from where they landed to a way of contacting you?
 *
 * Everything else in this audit measures whether a site can be found and read.
 * This measures whether it can be ACTED ON, which is the part that decides
 * whether traffic becomes a phone call.
 *
 * The measurement that matters is click distance, and it matters because of
 * where visitors actually land. A search engine — and an answer engine citing a
 * page — sends people to a deep page, not the homepage. A site whose only
 * contact form sits behind the homepage nav is asking a stranger who arrived on
 * a blog post to go looking. Some do. Most leave.
 *
 * So this builds a link graph across the pages the crawl retrieved, finds every
 * way of making contact on each one, and walks outward to find how far the
 * nearest one is. A page with no path at all is a dead end, and a dead end is a
 * defect with a price attached.
 *
 * The honest limit, which every consumer must carry into what it prints: the
 * crawl retrieves a handful of pages, not the whole site. "Dead end" here means
 * "no path among the pages we looked at" — real, worth reporting, and not the
 * same claim as "no path exists". `pagesExamined` is reported so the sentence
 * can say which one it means.
 */

export type AffordanceKind = "form" | "tel" | "mailto";

export type ContactAffordance = {
  kind: AffordanceKind;
  /** The crawled page it was found on. */
  page: string;
  /** The number, the address, or the form's action — the receipt. */
  detail: string;
};

export type PageJourney = {
  url: string;
  /** Clicks to the nearest page carrying a contact affordance. 0 means it is on
   *  this page; null means no path was found among the pages examined. */
  clicksToContact: number | null;
  /** Links from this page to other pages the crawl retrieved. Zero means a
   *  visitor who lands here can go nowhere, which is a different and worse
   *  problem than merely being far from the contact page. */
  internalLinks: number;
};

export type JourneyMap = {
  affordances: ContactAffordance[];
  pages: PageJourney[];
  /** Pages with no path to any contact affordance, among those examined. */
  deadEnds: string[];
  /** The worst distance among pages that DO have a path — the honest headline,
   *  because an average hides the one page that strands people. Null when no
   *  page has a path. */
  worstClicksToContact: number | null;
  /** How many pages this was computed over. Reported so no consumer can
   *  describe a five-page sample as though it were the whole site. */
  pagesExamined: number;
};

/** Trailing slash and case folded on the host, so "/about" and "/about/" are one
 *  node in the graph rather than two that never link to each other. The query
 *  and hash are dropped: they address a state of a page, not another page. */
export function canonicalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.hostname.replace(/^www\./i, "").toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

/** Absolute URL for an anchor's href, or null when it does not navigate to a
 *  page — `tel:`, `mailto:`, `javascript:`, and bare fragments all resolve to
 *  "nowhere else", and treating them as edges would make every page look
 *  better connected than it is. */
export function resolveNavigable(href: string, pageUrl: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (/^(tel:|mailto:|javascript:|sms:|data:)/i.test(trimmed)) return null;
  try {
    return new URL(trimmed, pageUrl).toString();
  } catch {
    return null;
  }
}

/** The extract to reason about: rendered when we have it, raw otherwise.
 *
 *  Rendered first because a visitor uses a browser — a nav injected by
 *  JavaScript is a real path for the person we are measuring here, even though
 *  it is invisible to the crawlers the rest of the audit worries about. Those
 *  are two different questions and this one is about the human. */
function extractOf(page: PageCapture): PageExtract | null {
  return page.rendered ?? page.raw;
}

const TEL_HREF = /^tel:(.+)$/i;
const MAILTO_HREF = /^mailto:([^?]+)/i;

/** Every way of making contact on one page. */
export function affordancesOn(page: PageCapture): ContactAffordance[] {
  const extract = extractOf(page);
  if (!extract) return [];
  const found: ContactAffordance[] = [];

  for (const anchor of extract.anchors ?? []) {
    const tel = TEL_HREF.exec(anchor.href);
    if (tel?.[1]) {
      found.push({ kind: "tel", page: page.url, detail: tel[1].trim() });
      continue;
    }
    const mail = MAILTO_HREF.exec(anchor.href);
    if (mail?.[1]) {
      found.push({ kind: "mailto", page: page.url, detail: mail[1].trim() });
    }
  }

  for (const form of extract.forms ?? []) {
    // A form only counts when it asks for a way to reply. A search box and a
    // filter are forms too, and counting them would report a site nobody can
    // reach as having a conversion path — the exact failure this check exists
    // to catch.
    if (!form.hasContactField) continue;
    found.push({ kind: "form", page: page.url, detail: form.action ?? page.url });
  }

  return found;
}

export function buildJourney(pages: PageCapture[]): JourneyMap {
  // Only pages that actually produced an extract. One that failed to fetch
  // tells us nothing about its links, and treating it as a node with no edges
  // would invent a dead end out of our own transport failure.
  const usable = pages.filter((p) => extractOf(p) !== null);

  const nodes = new Map<string, PageCapture>();
  for (const page of usable) {
    const key = canonicalizeUrl(page.url);
    if (key) nodes.set(key, page);
  }

  const affordances: ContactAffordance[] = [];
  // Keys of pages that carry a way to make contact — the BFS targets.
  const hasContact = new Set<string>();
  for (const page of usable) {
    const key = canonicalizeUrl(page.url);
    const found = affordancesOn(page);
    affordances.push(...found);
    if (key && found.length > 0) hasContact.add(key);
  }

  // Forward edges, and the reverse graph the search actually runs on.
  //
  // The search runs BACKWARDS from every contact page at once, rather than
  // forwards from each page separately: one traversal then labels every page
  // with its true distance, instead of one traversal per page. Same answer,
  // and it cannot drift between pages the way N separate searches can.
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  for (const [key, page] of nodes) {
    const extract = extractOf(page);
    const out = new Set<string>();
    for (const anchor of extract?.anchors ?? []) {
      const abs = resolveNavigable(anchor.href, page.url);
      if (!abs) continue;
      const target = canonicalizeUrl(abs);
      if (!target || target === key || !nodes.has(target)) continue;
      out.add(target);
      if (!incoming.has(target)) incoming.set(target, new Set());
      incoming.get(target)?.add(key);
    }
    outgoing.set(key, out);
  }

  const distance = new Map<string, number>();
  let frontier = [...hasContact];
  for (const key of frontier) distance.set(key, 0);
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: string[] = [];
    for (const key of frontier) {
      for (const source of incoming.get(key) ?? []) {
        if (distance.has(source)) continue;
        distance.set(source, depth);
        next.push(source);
      }
    }
    frontier = next;
  }

  const journeys: PageJourney[] = [...nodes.entries()].map(([key, page]) => ({
    url: page.url,
    clicksToContact: distance.get(key) ?? null,
    internalLinks: outgoing.get(key)?.size ?? 0,
  }));

  const reachable = journeys.map((j) => j.clicksToContact).filter((d): d is number => d !== null);

  return {
    affordances,
    pages: journeys,
    deadEnds: journeys.filter((j) => j.clicksToContact === null).map((j) => j.url),
    worstClicksToContact: reachable.length > 0 ? Math.max(...reachable) : null,
    pagesExamined: journeys.length,
  };
}
