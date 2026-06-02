import type { SearchApiConfig } from "./config.js";

export type SearchPresenceQuery = SearchApiConfig & {
  /** The search term (operator-supplied, e.g. the business name). */
  query: string;
  /** The site's URL or bare domain — used to find the site in the results. */
  siteUrl: string;
};

export type SearchPresence = {
  /** True when the site's domain appears anywhere in the top 10 organic results. */
  foundOnPage1: boolean;
  /** 1-based position of the first matching result, or null if not on page 1. */
  position: number | null;
};

const ENDPOINT = "https://www.googleapis.com/customsearch/v1";

/** Reduce a URL or bare host to a comparable hostname: no scheme, no path, no leading `www.`. */
function bareHost(urlOrHost: string): string {
  const noScheme = urlOrHost.trim().replace(/^https?:\/\//i, "");
  const host = noScheme.split("/")[0]!.split("?")[0]!;
  return host.toLowerCase().replace(/^www\./, "");
}

/**
 * Google the `query` via the Custom Search JSON API and report whether `siteUrl`'s domain
 * appears in the top 10 organic results. Throws on a non-OK response (quota, bad key, etc.)
 * so the caller can soft-fail. De-personalized/de-localized — a national-ranking proxy.
 */
export async function fetchSearchPresence(q: SearchPresenceQuery): Promise<SearchPresence> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("key", q.apiKey);
  url.searchParams.set("cx", q.engineId);
  url.searchParams.set("q", q.query);
  url.searchParams.set("num", "10");

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`Custom Search API returned ${resp.status}`);
  }
  const data = (await resp.json()) as { items?: Array<{ link?: string }> };
  const items = data.items ?? [];
  const target = bareHost(q.siteUrl);

  for (let i = 0; i < items.length; i++) {
    const link = items[i]?.link;
    if (link && bareHost(link) === target) {
      return { foundOnPage1: true, position: i + 1 };
    }
  }
  return { foundOnPage1: false, position: null };
}
