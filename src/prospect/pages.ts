import type { PageCapture, PageExtract } from "./types.js";

/**
 * Which of the crawled URLs are actually PAGES of this website?
 *
 * Every check that reasons across pages — the journey graph, the shared
 * template, the goal-fit content checks — first has to answer this, and the
 * cost of each one answering it privately was a class of finding the audit
 * exists to prevent: OUR missing data reported as THEIR defect.
 *
 * Two real cases, both found by replaying the checks over stored audits:
 *
 *   - Cloudflare's `/cdn-cgi/l/email-protection` is linked from the obfuscated
 *     mailto on the page, answers HTTP 404, and still paints something a
 *     browser can screenshot. Consumers that asked only "is there an extract?"
 *     admitted it, and it became the only dead end and the only off-template
 *     page in the entire stored corpus — a report telling a real client that a
 *     visitor landing there "is in a different website with no way back", about
 *     a URL no human ever lands on.
 *   - A page whose Playwright render timed out has `raw` but no `rendered`.
 *     Judged from `raw` while its siblings are judged from `rendered`, it
 *     carries a different set of links than they do and falls out of the shared
 *     navigation — so our timeout became "this page is built outside your
 *     template". Hence `usablePages` picking ONE view for the whole set.
 *
 * The rule both cases share: a page earns its place by being fetched
 * successfully, not by having left something behind that we can parse.
 */

export type PageView = "rendered" | "raw";

export type UsablePage = {
  page: PageCapture;
  /** The chosen view's extract — never null, and always the same view as every
   *  other entry in the same set. */
  extract: PageExtract;
};

export type UsablePageSet = {
  pages: UsablePage[];
  /** Which view every entry was read from, so a consumer can say so. */
  view: PageView;
  /** Pages dropped because they lacked the chosen view. Reported rather than
   *  silently absent: "we looked at 12 of your 14 pages" is a different claim
   *  from "we looked at your site". */
  excluded: number;
  /**
   * Did every kept page carry an `anchors` array?
   *
   * `PageExtract.anchors` is optional, and its docstring is explicit that an
   * absent array means "not measured", never "no links". A consumer that reads
   * `anchors ?? []` turns a report stored before anchors existed into a site
   * where every page is a dead end. Consumers must degrade to "not measured"
   * when this is false rather than publish the finding.
   */
  anchorsMeasured: boolean;
};

/**
 * Did this URL come back as a page at all?
 *
 * A null status is a transport failure; 4xx and 5xx are the server declining to
 * give us the page. In every one of those cases we have no evidence about the
 * prospect's site, and "no evidence" must never render as a finding.
 */
export function fetchedOk(page: PageCapture): boolean {
  return page.status !== null && page.status < 400;
}

/**
 * Infrastructure URLs that a crawler can follow but a visitor never lands on.
 *
 * These are matched on a path SEGMENT, not a substring, so a blog post at
 * `/blog/cdn-cgi-explained` stays an ordinary page. Kept deliberately short:
 * every entry here is a URL we would otherwise describe to a client as one of
 * their pages, and a wrong entry hides a real page instead.
 */
const INFRA_SEGMENTS = [/^cdn-cgi$/i, /^wp-admin$/i, /^wp-json$/i, /^xmlrpc\.php$/i];

export function isInfraPath(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  return path
    .split("/")
    .filter(Boolean)
    .some((segment) => INFRA_SEGMENTS.some((re) => re.test(segment)));
}

/**
 * The pages a cross-page check may reason about, all read from one view.
 *
 * The view is whichever of rendered/raw more pages actually have, with rendered
 * winning a tie — rendered is what a human sees, and a nav injected by
 * JavaScript is a real path for the visitor even though the crawlers cannot
 * follow it. (Whether crawlers can see the content is a different question,
 * asked and answered separately by the readability check.)
 */
export function usablePages(pages: PageCapture[]): UsablePageSet {
  const candidates = pages.filter((p) => fetchedOk(p) && !isInfraPath(p.url));
  const withRendered = candidates.filter((p) => p.rendered !== null);
  const withRaw = candidates.filter((p) => p.raw !== null);
  const view: PageView = withRendered.length >= withRaw.length ? "rendered" : "raw";
  const kept = view === "rendered" ? withRendered : withRaw;

  const usable: UsablePage[] = [];
  for (const page of kept) {
    const extract = view === "rendered" ? page.rendered : page.raw;
    if (extract) usable.push({ page, extract });
  }

  return {
    pages: usable,
    view,
    excluded: candidates.length - usable.length,
    anchorsMeasured: usable.length > 0 && usable.every((p) => p.extract.anchors !== undefined),
  };
}
