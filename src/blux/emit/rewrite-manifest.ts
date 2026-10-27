import type {
  BandPresentation,
  Presentation,
  RenderMedia,
  RenderNode,
  SitePresentation,
} from "./presentation.js";

const swap = (m: RenderMedia, map: Map<string, string>): RenderMedia => {
  const url = map.get(m.url);
  return url ? { ...m, url } : m;
};

function walkNode(node: RenderNode, map: Map<string, string>): RenderNode {
  switch (node.kind) {
    case "row":
      return {
        kind: "row",
        cells: node.cells.map((c) => ({ token: c.token, node: walkNode(c.node, map) })),
      };
    case "stack":
      return { kind: "stack", children: node.children.map((c) => walkNode(c, map)) };
    case "media":
      return { kind: "media", media: swap(node.media, map) };
    default:
      return node; // heading/body/subtitle/raw/widget carry no media url
  }
}

function walkBand(bp: BandPresentation, map: Map<string, string>): BandPresentation {
  const out: BandPresentation = { ...bp };
  if (bp.background) out.background = swap(bp.background, map);
  if (bp.media) out.media = swap(bp.media, map);
  if (bp.gallery) out.gallery = bp.gallery.map((m) => swap(m, map));
  if (bp.carousel)
    out.carousel = {
      ...bp.carousel,
      slides: bp.carousel.slides.map((s) => ({ ...s, media: swap(s.media, map) })),
    };
  if (bp.tree) out.tree = walkNode(bp.tree, map);
  if (bp.split)
    out.split = {
      ...bp.split,
      media: swap(bp.split.media, map),
      text: walkNode(bp.split.text, map),
    };
  return out; // style / map untouched (no media urls)
}

function rewritePage(p: Presentation, map: Map<string, string>): Presentation {
  const bands: Record<string, BandPresentation> = {};
  for (const [k, bp] of Object.entries(p.bands)) bands[k] = walkBand(bp, map);
  return { bands };
}

/** Deep copy of the manifest with every RenderMedia.url present in `urlMap`
 * replaced by its mapped value. Unknown urls left intact. Handles BOTH shapes:
 * the flat single-page `{ bands }` and the multi-page `{ pages: { <uid>:
 * { bands } } }` that `blux convert` now writes — the migrate step must rewrite
 * every site's urls regardless of shape. Pure. */
export function rewriteManifestUrls(
  manifest: SitePresentation,
  urlMap: Map<string, string>,
): SitePresentation {
  if ("pages" in manifest && manifest.pages) {
    const pages: Record<string, Presentation> = {};
    for (const [uid, p] of Object.entries(manifest.pages)) pages[uid] = rewritePage(p, urlMap);
    return { pages };
  }
  // The flat branch is a Presentation by construction (cast bridges the union).
  return rewritePage(manifest as Presentation, urlMap);
}
