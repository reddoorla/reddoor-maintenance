import type { PlanDocument } from "../emit/plan.js";

export type RewriteResult = {
  documents: PlanDocument[];
  /** Total url occurrences swapped. */
  rewritten: number;
  /** CDN-looking urls that survived the swap — surface these, never silent. */
  unmatched: string[];
};

// The exclusion class ends the match at whitespace, `"`, `'`, `\`, or `)`, so
// urls embedded in serialized JSON (followed by `"` or, when doubly
// serialized, `\"`) and in `background-image:url(...)` are captured exactly —
// verified: neither the closing quote nor the escaping backslash leaks in.
const CDN_URL_RE = /https?:\/\/[a-z0-9.-]*cloudfront\.net\/[^\s"'\\)]+/g;

/** Swap every occurrence of a plan-asset CDN url for its uploaded Prismic url
 * inside EVERY string value of the documents (serialized BluxBlock payloads,
 * widget_html, embed_html, background wrappers — the surfaces resolveDocData
 * does not touch). Pure: returns a deep copy; marker objects pass through
 * untouched because they hold no CDN urls. */
export function rewriteDocUrls(
  documents: PlanDocument[],
  urlByCdn: Map<string, string>,
): RewriteResult {
  let rewritten = 0;
  const unmatched = new Set<string>();
  const swapString = (s: string): string => {
    let out = s;
    for (const [cdn, prismic] of urlByCdn) {
      if (!out.includes(cdn)) continue;
      rewritten += out.split(cdn).length - 1;
      out = out.split(cdn).join(prismic);
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
  return {
    documents: documents.map((d) => walk(d) as PlanDocument),
    rewritten,
    unmatched: [...unmatched],
  };
}
