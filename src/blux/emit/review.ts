import type { SiteIR, Diagnostic } from "../ir.js";

export type ReviewPair = { uid: string; converted: string; original: string };
export type ReviewManifest = { pairs: ReviewPair[]; diagnostics: Diagnostic[] };

export function buildReviewManifest(
  ir: SiteIR,
  opts: { convertedBase: string; bluxBase: string },
): ReviewManifest {
  const pairs = ir.pages.map((p) => ({
    uid: p.uid,
    converted: `${opts.convertedBase}/${p.uid}`,
    // The home page maps to the site root; other pages to /uid.
    original: p.uid === "home" ? `${opts.bluxBase}/` : `${opts.bluxBase}/${p.uid}`,
  }));
  return { pairs, diagnostics: ir.diagnostics };
}
