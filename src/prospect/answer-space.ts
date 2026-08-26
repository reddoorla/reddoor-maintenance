import type { ProbeAnswer } from "./types.js";

/**
 * Who does the engine actually answer this category with?
 *
 * `visibilityScore` alone is close to useless as a report headline: across the
 * 12 audits stored to date it is 0 for eight of them and takes only four
 * distinct values in total, so it cannot rank two thirds of prospects against
 * each other at all. Worse, a bare 0 invites the one question we cannot
 * honestly answer — "how do we make it go up?"
 *
 * What IS honest, and what a prospect can act on, is the shape of the answer
 * they are absent from. Two zeros mean opposite things:
 *
 *   - Revogen scores 0, and the engine answers their category with Stryker,
 *     Arthrex, Conmed, Globus, NCBI and the FDA. No website edit puts anyone
 *     in that answer. The honest advice is to not buy AEO at all.
 *   - Beachfront Dentistry scores 0, and the engine answers "dentist in
 *     Redondo Beach CA" with Yelp plus five other local practices' own
 *     websites — businesses exactly their size. Being in that answer is
 *     plainly possible; they simply are not.
 *
 * Same number, opposite counsel. This module computes the evidence that tells
 * them apart. Everything here is arithmetic over citations the engine actually
 * returned — no judgment, no weighting, nothing we chose. A label sits on top
 * of it elsewhere; the numbers below are what the label has to survive.
 */

export type SourceCount = {
  domain: string;
  /** Total citations, counting repeats within a single answer. */
  count: number;
  /** `count` as a fraction of every category citation, 0..1. */
  share: number;
};

export type AnswerSpace = {
  /** Category answers that produced at least one citation. Answers that cited
   *  nothing are excluded here but still counted in `queriesAsked` — an engine
   *  that declined to cite anything is a fact about the query, not about the
   *  prospect, and folding it into the shares would dilute them with silence. */
  answersWithCitations: number;
  queriesAsked: number;
  /** Every citation across every category answer, repeats included. */
  citationsTotal: number;
  /** Distinct domains behind those citations. The fragmentation headline: on
   *  the benchmark this ran 53–77 per site across five queries.
   *
   *  Scales with how many queries ran, so it is NOT comparable between a
   *  3-query run and a 5-query run (the early Reddoor audits sit at 14–38 for
   *  that reason alone, not because their categories are less crowded).
   *  `medianWidthPerAnswer` is the per-query figure to compare across sites. */
  distinctDomains: number;
  /** Ranked, most-cited first. */
  topSources: SourceCount[];
  /** How many distinct domains it takes to account for half of all citations.
   *  This is the number that killed the "get listed in the three directories
   *  the engine reads" pitch: on the benchmark it ran 10–18, meaning no such
   *  short list exists to buy your way onto. Null when nothing was cited. */
  domainsToHalf: number | null;
  /** Median distinct domains cited within a SINGLE answer — how crowded one
   *  reply is, as opposed to the category across five of them. Null when no
   *  answer cited anything. */
  medianWidthPerAnswer: number | null;
  /** 1-based position of the prospect's own domain in `topSources`, or null
   *  when it was never cited.
   *
   *  An earlier read of a 9-site benchmark held that every site scoring above
   *  zero was the TOP source in its own category. At 12 sites that breaks:
   *  Ludlow Kingsley scores 40 from rank 4. Being cited at all is what tracks
   *  the score — which is very nearly a restatement of how the score is
   *  computed, so this field is evidence for the reader, not an independent
   *  finding. Do not build a claim on rank 1. */
  ownDomainRank: number | null;
  ownDomainCount: number;
  /** The most-cited source that is NOT the prospect, on the queries we ran.
   *
   *  ⚠️ This is NOT "who owns your category", and the report must never call
   *  it that. Real shares from the benchmark: Icovy's top rival holds 4%,
   *  ParkerWhite's 6%, Designity's 8%. At those shares there is no owner —
   *  the answer space is fragmented (see `domainsToHalf`, which ran 5–18).
   *  What this legitimately answers is narrower and still useful: "on the
   *  specific searches we ran, here is who came back instead of you."
   *  The character of the whole source list — local practices vs. Stryker and
   *  the FDA — is the actual finding; no single row carries it. */
  topRival: SourceCount | null;
};

/** Strips a leading `www.` so `www.example.com` and `example.com` are one
 *  source rather than two competing rows in the ranking. Everything else is
 *  left alone: `blog.example.com` really is a different source from the root,
 *  and collapsing it would overstate concentration. */
export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
}

/** The prospect's own registrable-ish host, for matching citations against.
 *  Returns null rather than throwing on a URL we cannot parse — a malformed
 *  entry must not take the whole analysis down, and "we could not tell whether
 *  they were cited" is reported as `ownDomainRank: null`, same as absence.
 *  Those two are genuinely different, but the report never claims the stronger
 *  reading from this field alone; `ownDomainCount` distinguishes them. */
export function ownHost(url: string): string | null {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

export function analyzeAnswerSpace(answers: ProbeAnswer[], prospectUrl: string): AnswerSpace {
  // Category answers only. Branded answers ("who is X") hand the engine the
  // name and are excluded from every visibility measure for that reason; a
  // competitor answer is a head-to-head we posed, not a question a buyer
  // types, so it does not describe the category's answer space either.
  const category = answers.filter((a) => a.kind === "category");
  const host = ownHost(prospectUrl);

  const counts = new Map<string, number>();
  const widths: number[] = [];
  let citationsTotal = 0;
  let answersWithCitations = 0;

  for (const answer of category) {
    if (answer.citedDomains.length === 0) continue;
    answersWithCitations += 1;
    const seenInThisAnswer = new Set<string>();
    for (const raw of answer.citedDomains) {
      const domain = normalizeDomain(raw);
      if (!domain) continue;
      counts.set(domain, (counts.get(domain) ?? 0) + 1);
      citationsTotal += 1;
      seenInThisAnswer.add(domain);
    }
    widths.push(seenInThisAnswer.size);
  }

  const topSources: SourceCount[] = [...counts.entries()]
    // Count descending, then domain ascending. The tiebreak is not cosmetic:
    // without it two sources on equal counts would rank by Map insertion
    // order, so the report could name a different "top rival" for the same
    // data depending on which query happened to run first.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([domain, count]) => ({
      domain,
      count,
      share: citationsTotal === 0 ? 0 : count / citationsTotal,
    }));

  // How many distinct domains to reach half of all citations. Walk the ranked
  // list accumulating until the running total crosses 50%.
  let domainsToHalf: number | null = null;
  if (citationsTotal > 0) {
    let running = 0;
    for (const [i, source] of topSources.entries()) {
      running += source.count;
      if (running * 2 >= citationsTotal) {
        domainsToHalf = i + 1;
        break;
      }
    }
  }

  const ownIndex = host === null ? -1 : topSources.findIndex((s) => s.domain === host);
  // Read through the index rather than indexing again, so the count comes from
  // the same lookup that established the rank — `noUncheckedIndexedAccess` is
  // on, and re-indexing would need an assertion that could outlive the guard.
  const own = ownIndex === -1 ? undefined : topSources[ownIndex];

  return {
    answersWithCitations,
    queriesAsked: category.length,
    citationsTotal,
    distinctDomains: topSources.length,
    topSources,
    domainsToHalf,
    medianWidthPerAnswer: median(widths),
    ownDomainRank: own ? ownIndex + 1 : null,
    ownDomainCount: own?.count ?? 0,
    topRival: topSources.find((s) => s.domain !== host) ?? null,
  };
}

/** Lower median on an even count — the report quotes this as "half the answers
 *  drew on N sources or fewer", which an interpolated 13.5 cannot mean. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
}
