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
 *  detail page (team member, service, question) in that order. `log` fires
 *  once per detail-page fetch (phase + running count + slug, e.g.
 *  "team 3/11: stacey") — mirrors runMigration(plan, log) in
 *  src/blux/emit/run-migration.ts: a ~80-fetch crawl with a per-fetch
 *  courtesy delay takes about a minute, and silence reads as a hang. Default
 *  no-op keeps existing offline/test call-sites unchanged. */
export async function crawlSite(
  baseUrl: string,
  fetchPage: FetchPage,
  now: () => string = () => new Date().toISOString(),
  log: (line: string) => void = () => {},
): Promise<WebflowIR> {
  const [home, teamIndex, servicesIndex, atd] = await Promise.all([
    fetchPage("/"),
    fetchPage("/our-team"),
    fetchPage("/services"),
    fetchPage("/ask-the-doctor"),
  ]);
  const teamSlugs = extractTeamOrder(teamIndex);
  const serviceCategories = extractServiceCategories(servicesIndex);
  const serviceSlugs = serviceCategories.flatMap((c) => c.slugs);
  const questionSlugs = extractQuestionOrder(atd);

  // Sequential, not Promise.all — liveFetcher's courtesy delay is per-call;
  // don't hammer the live site.
  const team: WfTeamMember[] = [];
  for (const [i, slug] of teamSlugs.entries()) {
    log(`team ${i + 1}/${teamSlugs.length}: ${slug}`);
    team.push(extractTeamMember(await fetchPage(`/team-members/${slug}`), slug));
  }
  const services: WfService[] = [];
  for (const [i, slug] of serviceSlugs.entries()) {
    log(`service ${i + 1}/${serviceSlugs.length}: ${slug}`);
    services.push(extractService(await fetchPage(`/services/${slug}`), slug));
  }
  const questions: WfQuestion[] = [];
  for (const [i, slug] of questionSlugs.entries()) {
    log(`question ${i + 1}/${questionSlugs.length}: ${slug}`);
    questions.push(extractQuestion(await fetchPage(`/questions/${slug}`), slug, i));
  }

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

/** Filename = last url path segment (query stripped), byte-for-byte the same
 *  derivation as src/blux/emit/run-migration.ts (`url.split("/").pop()` then
 *  `.split("?")[0]`) — it's the Prismic asset-library dedupe key runMigration
 *  matches against, so percent-encoded names (logo%3Dwhite.svg) must stay
 *  ENCODED, never decoded here. Exported so to-docs's asset placeholder
 *  filename and this manifest's filename can never drift apart. */
export function assetFilename(url: string): string {
  const lastSegment = url.split("/").pop();
  if (!lastSegment) throw new Error(`assetFilename: url has no path segment: ${url}`);
  return lastSegment.split("?")[0] ?? lastSegment;
}

/** Every content image in the IR, deduped by url. */
export function collectAssets(ir: WebflowIR): AssetRef[] {
  const urls = [
    ...ir.team.map((t) => t.photo?.url),
    ...ir.services.map((s) => s.hero?.url),
    ...ir.questions.map((q) => q.image?.url),
    ...ir.reviews.map((r) => r.reviewerPhoto?.url),
  ].filter((u): u is string => !!u);
  return [...new Set(urls)].map((url) => ({ url, filename: assetFilename(url) }));
}
