import type { PlanDocument } from "../emit/plan.js";

export type RewriteResult = {
  documents: PlanDocument[];
  /** Total url occurrences swapped. */
  rewritten: number;
  /** CDN-looking urls that survived the swap — surface these, never silent. */
  unmatched: string[];
};

/** Generic rewrite over any JSON value (a deep copy is returned). */
export type ValueRewriteResult<T> = {
  value: T;
  /** Total url occurrences swapped. */
  rewritten: number;
  /** CDN-looking urls that survived the swap — surface these, never silent. */
  unmatched: string[];
};

// The exclusion class ends the match at whitespace, `"`, `'`, `\`, or `)`, so
// urls embedded in serialized JSON (followed by `"` or, when doubly
// serialized, `\"`) and in `background-image:url(...)` are captured exactly —
// the backslash boundary is pinned by the doubly-serialized-JSON test.
const CDN_URL_RE = /https?:\/\/[a-z0-9.-]*cloudfront\.net\/[^\s"'\\)]+/g;

/** Swap every occurrence of a plan-asset CDN url for its uploaded Prismic url
 * inside EVERY string value of an arbitrary JSON value. Pure: returns a deep
 * copy. Shared by the document rewrite (serialized BluxBlock payloads,
 * widget_html, embed_html, background wrappers) and the site-config / chrome
 * rewrite (nav + footer logo urls). Non-string, non-CDN values pass through
 * untouched. */
export function rewriteValueUrls<T>(
  value: T,
  urlByCdn: Map<string, string>,
): ValueRewriteResult<T> {
  let rewritten = 0;
  const unmatched = new Set<string>();
  // Longest key first: a mapped url that is a prefix of another mapped url can
  // then never fire inside the longer url's occurrence.
  const entries = [...urlByCdn].sort(([a], [b]) => b.length - a.length);
  const swapString = (s: string): string => {
    // Fast path — safe for both passes: every map key and CDN_URL_RE alike
    // require the cloudfront.net host, so this string can neither swap nor
    // surface an unmatched url.
    if (!s.includes("cloudfront.net")) return s;
    let out = s;
    for (const [cdn, prismic] of entries) {
      if (!out.includes(cdn)) continue;
      const parts = out.split(cdn);
      rewritten += parts.length - 1;
      out = parts.join(prismic);
    }
    for (const m of out.matchAll(CDN_URL_RE)) unmatched.add(m[0]);
    return out;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return swapString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, rewritten, unmatched: [...unmatched] };
}

/** Rewrite plan documents — the surfaces resolveDocData does not touch. Thin
 * wrapper over {@link rewriteValueUrls}; marker objects pass through untouched
 * because they hold no CDN urls. */
export function rewriteDocUrls(
  documents: PlanDocument[],
  urlByCdn: Map<string, string>,
): RewriteResult {
  const r = rewriteValueUrls(documents, urlByCdn);
  return { documents: r.value, rewritten: r.rewritten, unmatched: r.unmatched };
}
