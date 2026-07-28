/** Site crawler — composes the index + detail extractors into a full
 *  WebflowIR, and derives the deduped content-image asset manifest the
 *  migration step downloads. The fetch strategy is injected so tests never
 *  touch the network; `liveFetcher` is the real implementation used by the
 *  CLI (Task 7). */
import { extractQuestion, extractService, extractTeamMember } from "./extract.js";
import {
  extractQuestionOrder,
  extractReviews,
  extractServiceCategories,
  extractTeamOrder,
} from "./indexes.js";
import type { WebflowIR, WfService, WfTeamMember, WfQuestion } from "./types.js";

export type FetchPage = (path: string) => Promise<string>;

/** Live fetcher: 3 tries, 500ms courtesy delay, real UA. */
export function liveFetcher(baseUrl: string): FetchPage {
  return async (path) => {
    for (let i = 0; ; i++) {
      const res = await fetch(baseUrl + path, {
        headers: { "User-Agent": "Mozilla/5.0 (reddoor webflow-import)" },
      });
      if (res.ok) {
        await new Promise((r) => setTimeout(r, 500));
        return res.text();
      }
      if (i >= 2) throw new Error(`${path}: ${res.status}`);
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  };
}

/** Crawl a live (or fake-fetched) Webflow site into a WebflowIR: fetch the
 *  four index pages in parallel to learn ordering/grouping, then fetch every
 *  detail page (team member, service, question) in that order. */
export async function crawlSite(
  baseUrl: string,
  fetchPage: FetchPage,
  now: () => string = () => new Date().toISOString(),
): Promise<WebflowIR> {
  const [home, teamIndex, servicesIndex, atd] = await Promise.all([
    fetchPage("/"),
    fetchPage("/our-team"),
    fetchPage("/services"),
    fetchPage("/ask-the-doctor"),
  ]);
  const teamSlugs = extractTeamOrder(teamIndex);
  const serviceCategories = extractServiceCategories(servicesIndex);
  const questionSlugs = extractQuestionOrder(atd);

  // Sequential, not Promise.all — liveFetcher's courtesy delay is per-call;
  // don't hammer the live site.
  const team: WfTeamMember[] = [];
  for (const slug of teamSlugs)
    team.push(extractTeamMember(await fetchPage(`/team-members/${slug}`), slug));
  const services: WfService[] = [];
  for (const slug of serviceCategories.flatMap((c) => c.slugs))
    services.push(extractService(await fetchPage(`/services/${slug}`), slug));
  const questions: WfQuestion[] = [];
  for (const [i, slug] of questionSlugs.entries())
    questions.push(extractQuestion(await fetchPage(`/questions/${slug}`), slug, i));

  return {
    baseUrl,
    capturedAt: now(),
    team,
    services,
    serviceCategories,
    questions,
    reviews: extractReviews(home),
  };
}

export type AssetRef = { filename: string; url: string };

/** Every content image in the IR, deduped by url. Filename = last url segment
 *  (query stripped), byte-for-byte the same derivation as
 *  src/blux/emit/run-migration.ts (`url.split("/").pop()` then `.split("?")[0]`)
 *  — it's the Prismic asset-library dedupe key runMigration matches against,
 *  so percent-encoded names (logo%3Dwhite.svg) must stay ENCODED, never
 *  decoded here. */
export function collectAssets(ir: WebflowIR): AssetRef[] {
  const urls = [
    ...ir.team.map((t) => t.photo?.url),
    ...ir.services.map((s) => s.hero?.url),
    ...ir.questions.map((q) => q.image?.url),
    ...ir.reviews.map((r) => r.reviewerPhoto?.url),
  ].filter((u): u is string => !!u);
  return [...new Set(urls)].map((url) => {
    const lastSegment = url.split("/").pop();
    if (!lastSegment) throw new Error(`collectAssets: url has no path segment: ${url}`);
    return { url, filename: lastSegment.split("?")[0] ?? lastSegment };
  });
}
