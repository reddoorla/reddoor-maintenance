import { usablePages } from "./pages.js";
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
  /**
   * Did every page examined carry a recorded anchor list?
   *
   * False means the crawl did not record links (reports stored before
   * `PageExtract.anchors` existed), and NOTHING here is a finding: `deadEnds`
   * is empty and `worstClicksToContact` is null, because a page whose links we
   * never captured is a page we cannot say anything about. Reading an absent
   * anchors array as "no links" would report our own missing field as every
   * page on the site being a dead end.
   */
  anchorsMeasured: boolean;
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

const TEL_HREF = /^tel:(.+)$/i;
const MAILTO_HREF = /^mailto:([^?]+)/i;

/** Every way of making contact on one page. */
export function affordancesOn(page: PageCapture, view?: PageExtract): ContactAffordance[] {
  // The view is passed in by `buildJourney` so every page in one journey is
  // read the same way; on its own the function falls back to what a visitor
  // sees, since a nav injected by JavaScript is a real path for a human.
  const extract = view ?? page.rendered ?? page.raw;
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
    // Only an enquiry form. A search box, a filter and a lone newsletter email
    // box are all forms too, and counting any of them would report a site
    // nobody can actually reach as having a conversion path — the exact
    // failure this check exists to catch. See `FormKind` for why the
    // one-field case had to be split out: on one audited site a footer email
    // box otherwise put every page at zero clicks from reaching a person.
    if (form.kind !== "enquiry") continue;
    found.push({ kind: "form", page: page.url, detail: form.action ?? page.url });
  }

  return found;
}

export function buildJourney(pages: PageCapture[]): JourneyMap {
  // What counts as a page of this site, all read from one view — see pages.ts.
  // A URL the server answered with a 404 is not a dead end on their site; it
  // is a link we followed and should not have.
  const usable = usablePages(pages);

  const nodes = new Map<string, { page: PageCapture; extract: PageExtract }>();
  for (const entry of usable.pages) {
    const key = canonicalizeUrl(entry.page.url);
    if (key) nodes.set(key, entry);
  }

  const affordances: ContactAffordance[] = [];
  // Keys of pages that carry a way to make contact — the BFS targets.
  const hasContact = new Set<string>();
  for (const [key, entry] of nodes) {
    const found = affordancesOn(entry.page, entry.extract);
    affordances.push(...found);
    if (found.length > 0) hasContact.add(key);
  }

  // Forward edges, and the reverse graph the search actually runs on.
  //
  // The search runs BACKWARDS from every contact page at once, rather than
  // forwards from each page separately: one traversal then labels every page
  // with its true distance, instead of one traversal per page. Same answer,
  // and it cannot drift between pages the way N separate searches can.
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  for (const [key, entry] of nodes) {
    const out = new Set<string>();
    for (const anchor of entry.extract.anchors ?? []) {
      const abs = resolveNavigable(anchor.href, entry.page.url);
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

  const journeys: PageJourney[] = [...nodes.entries()].map(([key, entry]) => ({
    url: entry.page.url,
    clicksToContact: usable.anchorsMeasured ? (distance.get(key) ?? null) : null,
    internalLinks: outgoing.get(key)?.size ?? 0,
  }));

  const reachable = journeys.map((j) => j.clicksToContact).filter((d): d is number => d !== null);

  return {
    affordances,
    pages: journeys,
    // Without recorded anchors there is no evidence either way, so there is no
    // finding — not "every page is a dead end", which is what reading the
    // absent array as an empty one used to produce.
    deadEnds: usable.anchorsMeasured
      ? journeys.filter((j) => j.clicksToContact === null).map((j) => j.url)
      : [],
    worstClicksToContact: reachable.length > 0 ? Math.max(...reachable) : null,
    pagesExamined: journeys.length,
    anchorsMeasured: usable.anchorsMeasured,
  };
}
