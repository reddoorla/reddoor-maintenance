import type { PageCapture, PageExtract } from "./types.js";

/**
 * Does the site tell the same story on every page?
 *
 * Three findings live here, and they share a property that makes them worth
 * checking together: each is cheap to fix, embarrassing to leave, and invisible
 * from any single page. You only see them by comparing pages, which is exactly
 * what nobody does when they look at their own site.
 *
 *   - More than one phone number or email. A visitor cannot tell which one is
 *     real, and directory listings and answer engines that reconcile a business
 *     across sources see a business that disagrees with itself.
 *   - A stale copyright year. It says nobody has touched this in years, to
 *     every visitor, on every page, for free.
 *   - Pages that do not share the site's navigation. Usually a landing page
 *     built outside the template — a visitor who lands there is in a different
 *     website with no way back into this one.
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
   *  there is no shared navigation to compare against — see `sharedNavLinks`. */
  pagesOffTemplate: string[];
  /** How many links appear on EVERY page examined. This is the site's shared
   *  navigation, derived rather than assumed: no `<nav>` element is required,
   *  because plenty of sites do not use one. */
  sharedNavLinks: number;
  pagesExamined: number;
};

/**
 * A phone number in prose, matched on SHAPE rather than as a run of digits.
 *
 * The first version was a loose digit run — `\+?\d[\d\s().-]{8,}\d` — and it
 * was greedy across whitespace, so on beachfrontdentistry.com it swallowed the
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
const PHONE_IN_TEXT = /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const COPYRIGHT_YEAR = /(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–—]\s*)?(\d{4})/gi;

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

function extractOf(page: PageCapture): PageExtract | null {
  return page.rendered ?? page.raw;
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
  const usable = pages.filter((p) => extractOf(p) !== null);

  const phones = new Map<string, ContactVariant>();
  const emails = new Map<string, ContactVariant>();
  const years = new Set<number>();
  // Link sets per page, for the shared-navigation intersection below.
  const linkSets: { url: string; hrefs: Set<string> }[] = [];

  for (const page of usable) {
    const extract = extractOf(page);
    if (!extract) continue;

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
      hrefs.add(href);
    }
    linkSets.push({ url: page.url, hrefs });

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
      const year = Number(match[1]);
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
  const counts = new Map<string, number>();
  for (const { hrefs } of linkSets) {
    for (const href of hrefs) counts.set(href, (counts.get(href) ?? 0) + 1);
  }
  const threshold = Math.ceil(linkSets.length * 0.6);
  const sharedNav = new Set(
    [...counts.entries()].filter(([, n]) => n >= threshold).map(([href]) => href),
  );

  // With fewer than three pages "most pages" is not evidence of a template —
  // two pages that happen to link to each other would produce one. And with no
  // shared links at all there is nothing to be off.
  const canJudgeTemplate = linkSets.length >= 3 && sharedNav.size > 0;
  const sortedYears = [...years].sort((a, b) => a - b);

  return {
    phones: [...phones.values()],
    emails: [...emails.values()],
    copyrightYears: sortedYears,
    newestCopyrightYear: sortedYears.at(-1) ?? null,
    pagesOffTemplate: canJudgeTemplate
      ? linkSets.filter((p) => ![...sharedNav].some((h) => p.hrefs.has(h))).map((p) => p.url)
      : [],
    sharedNavLinks: sharedNav.size,
    pagesExamined: linkSets.length,
  };
}
