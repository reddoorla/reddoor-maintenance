/** Content-coverage validation: does a converted site actually render every
 * piece of text the Blux export shows? The export's rendered `index.html` is
 * the answer key; we extract its visible text runs and check each appears in
 * the converted site's rendered HTML. A missing run is a content gap the
 * deterministic transform left behind (e.g. a hero title that never mapped
 * onto a slice field) — surfaced without spending a token eyeballing pages. */

const DROP_ELEMENTS = /<(script|style|head|noscript|svg|template)[\s\S]*?<\/\1>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;

/** Decode the entity forms an export mixes in so they match the raw characters
 * a Prismic render emits. Numeric first, then the common named ones. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&(?:amp);/gi, "&")
    .replace(/&(?:lt);/gi, "<")
    .replace(/&(?:gt);/gi, ">")
    .replace(/&(?:quot);/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'");
}

function codePoint(n: number): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return " ";
  }
}

/** Fold text to a matchable form: decode, lowercase, and reduce every run of
 * non-alphanumeric characters (punctuation, smart quotes, em-dashes, symbols)
 * to a single space. Coverage then compares words, not typography — so
 * "CBRE & Co. — Leasing" and "cbre co leasing" are the same content. */
export function normalizeText(s: string): string {
  return decodeEntities(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A normalized run counts as content only if it carries a real word — at least
 * three alphanumeric characters together. Filters whitespace, lone punctuation,
 * and single/double-letter fragments left by inline tags. */
function hasWord(run: string): boolean {
  return /[a-z0-9]{3,}/.test(run);
}

/** Strip the non-content elements and all tags from an HTML string, leaving
 * one normalized text blob (used for the render side of a coverage check). */
export function flattenText(html: string): string {
  const text = html
    .replace(DROP_ELEMENTS, " ")
    .replace(COMMENTS, " ")
    .replace(/<[^>]+>/g, " ");
  return normalizeText(text);
}

/** Split an HTML string into de-duplicated, normalized visible text runs — the
 * text between tags, once script/style/head are removed. Inline tags fragment a
 * sentence into several runs; each must still appear in the render to count. */
export function extractTextRuns(html: string): string[] {
  const stripped = html.replace(DROP_ELEMENTS, " ").replace(COMMENTS, " ");
  const seen = new Set<string>();
  for (const piece of stripped.split(/<[^>]+>/)) {
    const run = normalizeText(piece);
    if (hasWord(run)) seen.add(run);
  }
  return [...seen];
}

export type CoverageReport = {
  total: number;
  covered: number;
  missing: string[];
  coveragePct: number;
};

/** Compare the export's rendered HTML (answer key) against the converted site's
 * rendered HTML. Every text run in the export should appear somewhere in the
 * render; the ones that don't are the content the transform dropped. */
export function validateCoverage(exportHtml: string, renderedHtml: string): CoverageReport {
  const runs = extractTextRuns(exportHtml);
  const blob = flattenText(renderedHtml);
  const missing = runs.filter((run) => !blob.includes(run));
  const covered = runs.length - missing.length;
  const coveragePct = runs.length === 0 ? 100 : Math.round((covered / runs.length) * 100);
  return { total: runs.length, covered, missing, coveragePct };
}
