import { anchorsTruncated } from "./extract.js";
import { canonicalizeUrl, resolveNavigable } from "./journey.js";
import { usablePages } from "./pages.js";
import type { PageCapture } from "./types.js";

/**
 * Does the site tell the same story on every page?
 *
 * Two findings live here, and they share a property that makes them worth
 * checking together: each is cheap to fix, embarrassing to leave, and invisible
 * from any single page. You only see them by comparing pages, which is exactly
 * what nobody does when they look at their own site.
 *
 *   - A stale copyright year. It says nobody has touched this in years, to
 *     every visitor, on every page, for free.
 *   - Pages that do not share the site's navigation. Usually a landing page
 *     built outside the template — a visitor who lands there is in a different
 *     website with no way back into this one.
 *
 * The contact numbers and addresses are an INVENTORY, not a third finding, and
 * that is a correction rather than an omission. This module used to treat more
 * than one phone number as "a business that disagrees with itself". Replayed
 * over every stored audit, that rule failed 8 of 22 sites and every single hit
 * was legitimate: our own site's labelled California and Texas office lines, a
 * nonprofit listing thirteen partner helplines on a resources page, a company's
 * fax line, a firm publishing separate general and business-inquiry numbers. A
 * business with two numbers is not confused; it has two numbers. The count was
 * correct data and the claim built on it was false, which is the worst of both
 * — and it was refutable by the reader from their own contact page.
 *
 * What survives is real and actionable: WHICH numbers appear, on which pages,
 * and whether each was ever written as a `tel:` link (see `linked`). Consumers
 * must render the list as a receipt. Any future "you have too many numbers"
 * finding needs a way to tell a second office from a contradiction first, and
 * this data does not carry one.
 *
 * Deliberately NOT checked: the postal address. Addresses cannot be pulled out
 * of free text reliably enough to accuse someone of inconsistency, and a false
 * positive here would have a prospect checking a page that is perfectly fine.
 * When a site publishes a `PostalAddress` in its schema we already read it; a
 * text scrape would be a guess wearing a finding's clothes.
 */

export type ContactVariant = {
  /** Digits only for a phone, lower-cased for an email — what makes two
   *  spellings of the same thing compare equal. */
  normalized: string;
  /** Every spelling actually seen, so the report shows the receipts rather
   *  than asserting a mismatch the reader cannot check. */
  seenAs: string[];
  pages: string[];
  /**
   * Was it ever written as a `tel:` / `mailto:` link, anywhere on the site?
   *
   * False means the number exists only as prose. On a phone — which is where
   * most people read a number and where the intent to call is highest — that is
   * a piece of text you cannot tap, and the visitor has to memorise it and
   * switch apps. It is a one-attribute fix, and it is invisible from a desktop,
   * which is exactly where nobody looks.
   *
   * Optional: reports stored before this was recorded lack it, and a reader must
   * treat its absence as "not measured" rather than as "not a link".
   */
  linked?: boolean;
};

export type ConsistencyResult = {
  phones: ContactVariant[];
  emails: ContactVariant[];
  /** Every copyright year found in page text, ascending. Empty when the site
   *  publishes no copyright line at all, which is not a defect. */
  copyrightYears: number[];
  /** The newest year found, or null when none was. */
  newestCopyrightYear: number | null;
  /** Pages carrying none of the site's shared navigation links. Empty when
   *  there is no shared navigation to compare against — see `sharedNavLinks`.
   *  A page in `pagesWithTruncatedAnchors` can never appear here. */
  pagesOffTemplate: string[];
  /** How many links appear on EVERY page examined. This is the site's shared
   *  navigation, derived rather than assumed: no `<nav>` element is required,
   *  because plenty of sites do not use one. */
  sharedNavLinks: number;
  pagesExamined: number;
  /**
   * Pages whose anchor list hit `MAX_ANCHORS`, so we read only its first 300
   * links (see `anchorsTruncated`).
   *
   * They take no part in the template comparison in EITHER direction, and that
   * is the difference from the journey graph, where a truncated page's links
   * stay in as edges. Shared navigation is derived by MAJORITY VOTE, and a link
   * that fell past the cap is indistinguishable from a link the page does not
   * have — so an incomplete page silently votes "absent" for every one of them
   * and can push a genuine nav link below the threshold. It is not purely
   * positive evidence here the way an edge is there, so it is excluded from the
   * derivation as well as from the finding.
   */
  pagesWithTruncatedAnchors: string[];
};

/**
 * A phone number in prose, matched on SHAPE rather than as a run of digits.
 *
 * The first version was a loose digit run — `\+?\d[\d\s().-]{8,}\d` — and it
 * was greedy across whitespace, so on a real dental site it swallowed the
 * suite number sitting next to the phone and produced:
 *
 *     3103789241        from "+13103789241"
 *     31037892411706    from "310) 378-9241 1706"
 *
 * One number reported as two, which is precisely the invented inconsistency
 * this module's own comments warn against. The digit cap in `normalizePhone`
 * did not catch it either: 14 digits is under the 15 it allows.
 *
 * So: an explicit North American shape, with `(?<!\d)`/`(?!\d)` fencing it out
 * of any longer digit run. The trade-off is real and deliberate — an
 * international number in prose is missed. A missed number costs a finding we
 * would have liked; a false one costs the reader's trust in every other finding
 * on the page, and numbers written as links are caught by `tel:` regardless of
 * format.
 */
export const PHONE_IN_TEXT = /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
/**
 * A copyright line, allowing the company's name to sit between the symbol and
 * the year.
 *
 * This used to require the year immediately after the symbol, so our own footer
 * — "© Reddoor Creative 2006-2026" — read as no copyright line at all. It is
 * one of the most ordinary ways to write it, and missing it means never
 * reporting a stale year on any site that does. Found by running the audit
 * against our own site before showing the tool to anyone.
 *
 * Group 1 is the gap, and it is captured rather than skipped so the caller can
 * reject a match that reached across a sentence. Group 3 is the year — group 2
 * is the opening year of a range like 2006-2026, deliberately discarded,
 * because the question is always how recently the line was updated.
 *
 * The gap is the whole safety margin. Unbounded, the word "copyright" anywhere
 * on a page would bind to the next four-digit number on it — a founding date, a
 * street address, a case-study figure — and report it as the site's copyright
 * year. A false stale-site finding is worse than a missed one: it is a claim
 * about their business that they can disprove.
 *
 * The margin used to be "anything without digits, under 30 characters", and 30
 * characters is four or five words of ordinary English. Measured:
 *
 *     "Copyright law changed in 2019 and we updated our terms."  →  [2019]
 *
 * — so any legal, licensing or publishing page reported the site as stale by
 * years. The gap now has to look like a NAME: whitespace and name punctuation
 * around CAPITALISED words, and nothing else. "law changed in" is not a name;
 * "Reddoor Creative" and "Acme Industries Ltd" are. The old length bound is
 * kept as a repetition bound (at most six words) rather than a character count.
 *
 * `i` is deliberately NOT set. With it, `[A-Z]` matches lowercase and the name
 * test means nothing, so the spellings of the marker itself are written out.
 */
const NAME_GAP = "(?:[\\s.,&'’-]*[A-Z][A-Za-z.'’&-]{0,19}){0,6}[\\s.,&'’-]*";
const COPYRIGHT_YEAR = new RegExp(
  `(?:©|&[Cc]opy;|&COPY;|[Cc]opyright|COPYRIGHT)(${NAME_GAP})(?:(\\d{4})\\s*[-–—]\\s*)?(\\d{4})`,
  "g",
);

/**
 * A gap that crosses a sentence boundary is not a company name, and the year
 * after it is some other number that happens to follow the word.
 *
 * This was `/[.!?]\s/`, which trips on `Co. ` / `Inc. ` / `Ltd. ` — at least as
 * common in a footer as the bare form the widening above was added to catch. So
 * `© Acme Design Co. 2019` reported as NO COPYRIGHT LINE AT ALL, which is the
 * exact failure the widening existed to stop, reintroduced by its own guard.
 *
 * A full stop only ends a sentence when a CAPITAL follows it; before a year it
 * is an abbreviation. The residual, named rather than hidden: `Co. Ltd 2019`
 * still reads as a sentence break and is missed. That direction is the safe one
 * — a missed copyright line costs a finding we would have liked, a false one
 * costs the reader's trust in every other finding on the page.
 */
const SENTENCE_BREAK = /[.!?]\s+[A-Z]/;

/** Digits only, with a leading US country code dropped so `+1 310 341 3571` and
 *  `(310) 341-3571` are one number rather than two. Numbers shorter than 10
 *  digits are rejected: a year, a price and a street number all match the loose
 *  text pattern above, and reporting those as phone numbers would manufacture
 *  an inconsistency out of nothing. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length < 10 || national.length > 15) return null;
  return national;
}

/** Merge one sighting into the variant list, keyed on the normalized form.
 *
 *  `linked` accumulates with OR, not last-write-wins: a number written as prose
 *  in the body and as a `tel:` link in the footer is tappable, and the order the
 *  two sightings happen to be visited in must not decide the finding. */
function record(
  into: Map<string, ContactVariant>,
  normalized: string,
  seenAs: string,
  page: string,
  linked: boolean,
): void {
  const existing = into.get(normalized);
  if (!existing) {
    into.set(normalized, { normalized, seenAs: [seenAs], pages: [page], linked });
    return;
  }
  if (!existing.seenAs.includes(seenAs)) existing.seenAs.push(seenAs);
  if (!existing.pages.includes(page)) existing.pages.push(page);
  existing.linked = existing.linked === true || linked;
}

export function checkConsistency(pages: PageCapture[]): ConsistencyResult {
  // Only pages the server actually served, all read from the same view — see
  // pages.ts. A 404 the crawler followed carries none of the site's navigation
  // by definition, so admitting it produced a guaranteed "off template" finding
  // about a URL no visitor ever lands on.
  const usable = usablePages(pages);

  const phones = new Map<string, ContactVariant>();
  const emails = new Map<string, ContactVariant>();
  const years = new Set<number>();
  // Link sets per page, for the shared-navigation intersection below.
  const linkSets: { url: string; hrefs: Set<string>; truncated: boolean }[] = [];

  for (const { page, extract } of usable.pages) {
    const hrefs = new Set<string>();
    for (const anchor of extract.anchors ?? []) {
      const href = anchor.href.trim();
      const tel = /^tel:(.+)$/i.exec(href);
      if (tel?.[1]) {
        const normalized = normalizePhone(tel[1]);
        if (normalized) record(phones, normalized, tel[1].trim(), page.url, true);
        continue;
      }
      const mail = /^mailto:([^?]+)/i.exec(href);
      if (mail?.[1]) {
        const address = mail[1].trim();
        record(emails, address.toLowerCase(), address, page.url, true);
        continue;
      }
      // Canonicalised, not compared as authored. A homepage rendered with
      // absolute URLs while the templated inner pages emit relative ones used
      // to produce two disjoint sets: the majority threshold picked one
      // spelling and flagged every page using the other as off-template. Same
      // outcome from `?utm_source=nav` on one template, or `/contact` against
      // `/contact/`. `journey.ts` already solved this for the graph, and its
      // functions are imported rather than re-derived so the two cannot drift
      // apart — the same reason `basics.ts` imports `canonicalizeUrl` for its
      // duplicate-title grouping. `resolveNavigable` also drops the hrefs that
      // go nowhere (`#`, `javascript:`), which were never template evidence.
      const abs = resolveNavigable(href, page.url);
      if (!abs) continue;
      const key = canonicalizeUrl(abs);
      if (key) hrefs.add(key);
    }
    linkSets.push({ url: page.url, hrefs, truncated: anchorsTruncated(extract) });

    // Phone numbers written in prose but not linked. Worth catching: a number
    // that appears only as text is both a consistency risk and a tap target
    // nobody on a phone can use.
    for (const match of extract.text.matchAll(PHONE_IN_TEXT)) {
      const raw = match[0];
      if (!raw) continue;
      const normalized = normalizePhone(raw);
      if (normalized) record(phones, normalized, raw.trim(), page.url, false);
    }

    for (const match of extract.text.matchAll(COPYRIGHT_YEAR)) {
      if (SENTENCE_BREAK.test(match[1] ?? "")) continue;
      const year = Number(match[3]);
      // A plausible range. A four-digit number next to the word "copyright" is
      // usually a year, but not always, and a stray 1200 would make the "stale
      // by N years" sentence nonsense.
      if (year >= 1990 && year <= 2100) years.add(year);
    }
  }

  // The site's template navigation: hrefs that appear on MOST pages.
  //
  // Emphatically NOT the intersection of every page. An intersection is
  // vacuous here — a page missing the nav deletes those links from the
  // intersection, so every page ends up containing whatever survives and no
  // page can ever be found to be missing it. The one thing this check exists
  // to find is precisely the page that would have destroyed the evidence.
  //
  // A majority threshold instead: links on at least 60% of pages are the
  // template, and a page carrying none of them is on a different one.
  //
  // Pages whose anchor list was CUT OFF at MAX_ANCHORS are excluded from the
  // vote entirely. A link past the cap is indistinguishable from a link the
  // page does not have, so an incomplete page votes "absent" for every one of
  // them and can push a genuine nav link under the threshold. Unlike an edge in
  // the journey graph, a majority vote is not purely additive, so the honest
  // move is to leave the page out of the derivation as well as the finding.
  const templateSets = linkSets.filter((p) => !p.truncated);
  const counts = new Map<string, number>();
  for (const { hrefs } of templateSets) {
    for (const href of hrefs) counts.set(href, (counts.get(href) ?? 0) + 1);
  }
  const threshold = Math.ceil(templateSets.length * 0.6);
  const sharedNav = new Set(
    [...counts.entries()].filter(([, n]) => n >= threshold).map(([href]) => href),
  );

  // With fewer than three pages "most pages" is not evidence of a template —
  // two pages that happen to link to each other would produce one. And with no
  // shared links at all there is nothing to be off.
  const canJudgeTemplate = templateSets.length >= 3 && sharedNav.size > 0;
  const sortedYears = [...years].sort((a, b) => a - b);

  return {
    phones: [...phones.values()],
    emails: [...emails.values()],
    copyrightYears: sortedYears,
    newestCopyrightYear: sortedYears.at(-1) ?? null,
    pagesOffTemplate: canJudgeTemplate
      ? templateSets.filter((p) => ![...sharedNav].some((h) => p.hrefs.has(h))).map((p) => p.url)
      : [],
    sharedNavLinks: sharedNav.size,
    pagesExamined: linkSets.length,
    pagesWithTruncatedAnchors: linkSets.filter((p) => p.truncated).map((p) => p.url),
  };
}
