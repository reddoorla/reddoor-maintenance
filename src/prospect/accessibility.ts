import type { PageCapture } from "./types.js";

/**
 * What axe-core found, in the browser the crawl already opened.
 *
 * WHAT THIS IS AND IS NOT NEW. The Lighthouse stage we already run IS axe — a
 * subset of roughly forty-five rules, reported as one number between 0 and 100.
 * Running it ourselves does not discover a different site; it does three things
 * that number cannot:
 *
 *   - turns "accessibility: 82" into named rules with named fixes, each with an
 *     element to go and look at;
 *   - adds the rules Lighthouse omits — every `best-practice` landmark and
 *     heading rule, which is most of what is structurally wrong with most
 *     sites, and which a wcag-tags-only scan cannot see at all;
 *   - absorbs several checks we would otherwise have written worse by hand
 *     (link names, tap-target size, viewport zoom, `lang`, form labels).
 *
 * THE TAG SET IS THE WHOLE POINT. Our own fleet audit scans `wcag2a`,
 * `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` and nothing else, and every
 * landmark and heading-order rule in axe is tagged `best-practice` — so a green
 * run there proves nothing about structure. This runs the DEFAULT rule set,
 * which is all of them.
 *
 * WHAT IT MAY NOT SAY. Never that a site "is inaccessible", and never a score.
 * axe finds what a machine can find, which is a minority of what a disabled
 * person actually encounters; a page can pass every rule here and be unusable.
 * The report says: we ran N rules, these M produced findings, here is the
 * element and the rule's own explanation. That is a fact with a receipt, and it
 * is all this instrument earns.
 */

export type AxeImpact = "minor" | "moderate" | "serious" | "critical";

/** One rule that produced findings on one page. Sized for persistence: the
 *  node COUNT plus a single example, never every matching element. */
export type AxeViolation = {
  /** axe's rule id — `color-contrast`, `landmark-one-main`. Stable, and the
   *  thing to search for. */
  id: string;
  impact: AxeImpact | null;
  /** axe's own one-line explanation. Quoted rather than paraphrased: it is
   *  written by people who know the rule better than we do. */
  help: string;
  helpUrl: string;
  /** Elements on this page the rule matched. */
  nodes: number;
  /** One of them, truncated — so a reader can go and find it. */
  sample: string | null;
};

export type AxePageResult = {
  violations: AxeViolation[];
  /**
   * Rules that found something to judge on this page and judged it fine.
   *
   * NOT "the number of rules axe has". Measured on our own report page, the
   * default set is 90 rules, of which 42 passed, 47 were INAPPLICABLE — the
   * page contains no table, no video, no iframe, so those rules had nothing to
   * look at — and one was incomplete. Printing 90 as though we had checked 90
   * things would be a number inflated on our own behalf, which is why
   * `inapplicable` is carried rather than quietly folded into this one.
   */
  passes: number;
  /** Rules axe could not decide — genuinely "we do not know", reported as such
   *  rather than folded into either column. */
  incomplete: number;
  /** WHICH rules those were. A count alone tells a reader three things need a
   *  human without saying what to look at, which is a worry rather than a job.
   *  Optional: absent on any result stored before it was captured. */
  incompleteIds?: string[];
  /** Rules with nothing on the page to check. Carried so the report can say
   *  "43 of axe's 90 rules had something to check here" and be exactly right. */
  inapplicable: number;
};

export type AccessibilityResult = {
  /**
   * Did the rules run anywhere?
   *
   * False when no page carried a result — every report stored before this
   * existed, every run whose browser never started, and every test that stubs
   * the renderer. An empty `violations` with `measured: false` means "we did
   * not look"; with `measured: true` it means the rules ran and found nothing,
   * which is a real and excellent answer.
   */
  measured: boolean;
  pagesExamined: number;
  /**
   * Rules that had something to check and passed — the number the report may
   * print as "we checked N things", and no larger one.
   *
   * The MAXIMUM across pages, never the sum. The same rule set runs on every
   * page, so summing reports "210 checks" for 42 rules over five pages. Max is
   * a deliberate under-count where pages differ: it can only understate what we
   * looked at, and understating our own work is the safe direction.
   */
  rulesPassed: number;
  rulesIncomplete: number;
  /** The undecided rules by name, so the disclosure can say what to look at
   *  instead of only how many. Empty when none, absent-safe for old reports. */
  incompleteIds: string[];
  /** Rules that found nothing on these pages to apply to. Not a pass and not a
   *  failure — the page simply has no table, video or iframe for them. */
  rulesInapplicable: number;
  /** Rules that produced findings, worst impact first, each naming the pages it
   *  fired on. Capped — see `violationsTotal`. */
  violations: (AxeViolation & { pages: string[] })[];
  /** True number of distinct rules with findings, before the cap. A truncated
   *  list that looks complete is the quiet lie this codebase is built to avoid. */
  violationsTotal: number;
};

/** Enough distinct rules to be a fix list, not so many it is a wall. */
export const MAX_REPORTED_RULES = 12;

const IMPACT_ORDER: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };

/**
 * Roll per-page results up to the site.
 *
 * Aggregated by RULE rather than by page, because "your headings skip a level
 * on six pages" is one job and six rows of the same sentence is not.
 */
export function summarizeAccessibility(pages: PageCapture[]): AccessibilityResult {
  const withResults = pages.filter((p) => p.axe != null);
  if (withResults.length === 0) {
    return {
      measured: false,
      pagesExamined: 0,
      rulesPassed: 0,
      rulesIncomplete: 0,
      incompleteIds: [],
      rulesInapplicable: 0,
      violations: [],
      violationsTotal: 0,
    };
  }

  const byRule = new Map<string, AxeViolation & { pages: string[] }>();
  let passes = 0;
  let incomplete = 0;
  const undecided = new Set<string>();
  let inapplicable = 0;
  for (const page of withResults) {
    const axe = page.axe!;
    // The per-page pass counts are the same rule set every time, so the site
    // figure is the per-page one, not their sum — adding them would report
    // "we ran 470 checks" for 94 rules across five pages.
    passes = Math.max(passes, axe.passes);
    incomplete = Math.max(incomplete, axe.incomplete);
    for (const id of axe.incompleteIds ?? []) undecided.add(id);
    inapplicable = Math.max(inapplicable, axe.inapplicable ?? 0);
    for (const v of axe.violations) {
      const existing = byRule.get(v.id);
      if (existing) {
        existing.nodes += v.nodes;
        if (!existing.pages.includes(page.url)) existing.pages.push(page.url);
        existing.sample ??= v.sample;
      } else {
        byRule.set(v.id, { ...v, pages: [page.url] });
      }
    }
  }

  const all = [...byRule.values()].sort(
    (a, b) =>
      (IMPACT_ORDER[a.impact ?? "minor"] ?? 4) - (IMPACT_ORDER[b.impact ?? "minor"] ?? 4) ||
      b.nodes - a.nodes ||
      a.id.localeCompare(b.id),
  );

  return {
    measured: true,
    pagesExamined: withResults.length,
    rulesPassed: passes,
    // The UNION when we have the names, the per-page max otherwise.
    //
    // `Math.max` was only ever a proxy for "how many distinct rules", chosen
    // because summing would have counted the same rule once per page. Now that
    // the ids are collected, the distinct count is known exactly — and the two
    // disagreed on our own site, where the report said "3 rules need a human"
    // and then listed four. A reader who can count is a reader who stops
    // trusting the numbers.
    rulesIncomplete: undecided.size > 0 ? undecided.size : incomplete,
    incompleteIds: [...undecided].sort(),
    rulesInapplicable: inapplicable,
    violations: all.slice(0, MAX_REPORTED_RULES),
    violationsTotal: all.length,
  };
}

/**
 * What the browser itself reported while the page was open.
 *
 * Collected in the SAME pass as the rendered DOM and the axe run — listeners
 * attached before navigation, one viewport resize after it. A resize reflows
 * the page the browser has already loaded; it costs no request and puts nothing
 * extra on the prospect's server, which is why the mobile-overflow measurement
 * is affordable at all.
 */
export type PageVitals = {
  /** Uncaught exceptions and `console.error` calls, capped and deduped. The
   *  most demonstrable "your site is broken" evidence there is. */
  consoleErrors: string[];
  /**
   * Requests the page made that failed or came back 4xx/5xx.
   *
   * `firstParty` decides whether it is a finding at all. A blocked third-party
   * analytics beacon is our network or an ad blocker; a 404 on the site's own
   * stylesheet is theirs, and only the second belongs in a report.
   */
  failedRequests: { url: string; status: number | null; firstParty: boolean }[];
  /**
   * Pixels the document overflows a 375px viewport, or null when we could not
   * measure. Zero is the answer a correct site gives.
   */
  overflowAt375: number | null;
  /** Text nodes rendering below 12px, with one example. Null = not measured. */
  tinyText: { count: number; sample: string | null } | null;
  /** Images downloaded far larger than they are drawn — the bytes a visitor
   *  pays for and never sees. */
  oversizedImages: { src: string; naturalWidth: number; renderedWidth: number }[];
};

/** Enough to name the problem, not so many the report becomes a log file. */
export const MAX_CONSOLE_ERRORS = 8;
export const MAX_FAILED_REQUESTS = 12;
export const MAX_OVERSIZED_IMAGES = 6;
