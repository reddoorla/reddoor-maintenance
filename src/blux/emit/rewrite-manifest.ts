import type { BandPresentation, Presentation, RenderMedia, RenderNode } from "./presentation.js";

const swap = (m: RenderMedia, map: Map<string, string>): RenderMedia => {
  const url = map.get(m.url);
  return url ? { ...m, url } : m;
};

function walkNode(node: RenderNode, map: Map<string, string>): RenderNode {
  switch (node.kind) {
    case "row":
      return { kind: "row", cells: node.cells.map((c) => ({ token: c.token, node: walkNode(c.node, map) })) };
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
  if (bp.tree) out.tree = walkNode(bp.tree, map);
  if (bp.split) out.split = { ...bp.split, media: swap(bp.split.media, map), text: walkNode(bp.split.text, map) };
  return out; // style / map untouched (no media urls)
}

/** Deep copy of the manifest with every RenderMedia.url present in `urlMap`
 * replaced by its mapped value. Unknown urls left intact. Pure. */
export function rewriteManifestUrls(manifest: Presentation, urlMap: Map<string, string>): Presentation {
  const bands: Record<string, BandPresentation> = {};
  for (const [k, bp] of Object.entries(manifest.bands)) bands[k] = walkBand(bp, urlMap);
  return { bands };
}
