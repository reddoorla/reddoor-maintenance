/** Index-page extractors — parse a rendered Webflow index/listing page
 *  (team roster, services grid, ask-the-doctor list, homepage reviews) into
 *  the ordering and grouping data that drives detail-page crawl order and
 *  page assembly. */
import { parse } from "node-html-parser";
import type { WfReview, WfServiceCategory } from "./types.js";

const slugOf = (href: string, prefix: string) => href.slice(prefix.length);
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const clean = (s: string | undefined) => s?.replace(/\s+/g, " ").trim() || undefined;

/** Team roster order from `/our-team`, deduped (each member's card links to
 *  their detail page multiple times — photo + name + button). */
export function extractTeamOrder(html: string): string[] {
  return uniq(
    parse(html)
      .querySelectorAll('a[href^="/team-members/"]')
      .map((a) => slugOf(a.getAttribute("href") ?? "", "/team-members/")),
  );
}

/** Ask-the-doctor question order from `/ask-the-doctor`, deduped, in page
 *  order — feeds each WfQuestion's 0-based `order` field. */
export function extractQuestionOrder(html: string): string[] {
  return uniq(
    parse(html)
      .querySelectorAll('a[href^="/questions/"]')
      .map((a) => slugOf(a.getAttribute("href") ?? "", "/questions/")),
  );
}

/** Group service links under the nearest preceding `h3.mb-4` category
 *  heading on `/services`. Flat document-order scan (not a recursive DOM
 *  walk, which would double-visit nested nodes): pull `h3.mb-4`, `p.para-20px`,
 *  and `a[href^="/services/"]` in one query, then iterate once — an `h3.mb-4`
 *  starts a new category, the first `p.para-20px` after it becomes the
 *  intro, and each service link appends (deduped, page order) to the
 *  current category. Categories with no slugs are dropped. */
export function extractServiceCategories(html: string): WfServiceCategory[] {
  const nodes = parse(html).querySelectorAll('h3.mb-4, p.para-20px, a[href^="/services/"]');
  const categories: WfServiceCategory[] = [];
  let current: WfServiceCategory | undefined;
  let introTaken = false;
  for (const node of nodes) {
    if (node.tagName === "H3") {
      const name = clean(node.structuredText);
      if (!name) continue;
      current = { name, slugs: [] };
      introTaken = false;
      categories.push(current);
    } else if (node.tagName === "P") {
      if (!current || introTaken) continue;
      const intro = clean(node.structuredText);
      if (intro) current.intro = intro;
      introTaken = true;
    } else if (node.tagName === "A") {
      if (!current) continue;
      const slug = slugOf(node.getAttribute("href") ?? "", "/services/");
      if (slug && !current.slugs.includes(slug)) current.slugs.push(slug);
    }
  }
  return categories.filter((c) => c.slugs.length > 0);
}

/** Homepage review carousel entries (`.big-review-item`). Each item holds
 *  exactly one anchor (the `.social-logo-big-review` link out to the review
 *  source — Yelp or Google Maps), so a plain first-anchor query is safe. */
export function extractReviews(html: string): WfReview[] {
  return parse(html)
    .querySelectorAll(".big-review-item")
    .map((item) => {
      const photo = item.querySelector("img.reviewer-photo")?.getAttribute("src");
      const reviewerPlace = clean(item.querySelector(".reviewer-place")?.structuredText);
      const reviewUrl = item.querySelector("a")?.getAttribute("href");
      return {
        quote: clean(item.querySelector("p.text-body")?.structuredText) ?? "",
        reviewerName: clean(item.querySelector(".reviewer-name")?.structuredText) ?? "",
        ...(reviewerPlace !== undefined ? { reviewerPlace } : {}),
        ...(photo ? { reviewerPhoto: { url: photo } } : {}),
        ...(reviewUrl !== undefined ? { reviewUrl } : {}),
      };
    })
    .filter((r) => r.quote);
}
