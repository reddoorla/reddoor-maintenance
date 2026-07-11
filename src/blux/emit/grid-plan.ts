import type { SliceSpec, Media } from "../grid/index.js";
import { collectMedia } from "../grid/classify-band.js";
import type { SiteIR } from "../ir.js";
import { buildCustomType } from "./custom-types.js";
import { sliceSpecToPlanSlice } from "./grid-slice.js";
import { type MigrationPlan, type PlanAsset, type PlanDocument, richText } from "./plan.js";

/** Build the CDN url for a media from its parser-captured base + uuid + ext. */
function cdnUrl(m: Media): string | null {
  return m.base ? `${m.base}${m.assetId}${m.ext ? `.${m.ext}` : ""}` : null;
}

/** Every Media referenced across all specs: band backgrounds, direct media
 * fields, and media inside node trees (SplitFeature.text / Grid.root). Deduped
 * by assetId, first occurrence wins, insertion order preserved. */
export function collectPlanAssets(specs: SliceSpec[], altFor: (id: string) => string): PlanAsset[] {
  const byId = new Map<string, PlanAsset>();
  const add = (m: Media) => {
    if (byId.has(m.assetId)) return;
    const url = cdnUrl(m);
    if (url) byId.set(m.assetId, { id: m.assetId, url, alt: altFor(m.assetId) });
  };
  for (const spec of specs) {
    if (spec.background) add(spec.background);
    switch (spec.slice) {
      case "Gallery":
        spec.media.forEach(add);
        break;
      case "MediaFull":
      case "VideoFeature":
        add(spec.media);
        break;
      case "SplitFeature":
        add(spec.media);
        collectMedia(spec.text).forEach(add);
        break;
      case "Grid":
        collectMedia(spec.root).forEach(add);
        break;
      default:
        break; // Hero/TitleBand/RichText/LocationMap: only background (handled above)
    }
  }
  return [...byId.values()];
}

/** Build the Prismic migration plan for a grid-converted site: one text-only
 * page document + the assets its manifest references (uploaded so the manifest
 * can be rewritten to Prismic urls at migrate time). Collections flow through
 * `buildCustomType`, unchanged from archetype. */
export function buildGridPlan(specs: SliceSpec[], ir: SiteIR): MigrationPlan {
  const page = ir.pages[0];
  const uid = page?.uid ?? "home";
  const title = page?.title ?? uid;
  const doc: PlanDocument = {
    type: "page",
    uid,
    data: { title: richText(`<h1>${title}</h1>`), slices: specs.map(sliceSpecToPlanSlice) },
  };
  const altById = new Map(ir.assets.map((a) => [a.id, a.alt ?? ""]));
  const assets = collectPlanAssets(specs, (id) => altById.get(id) ?? "");
  const customTypes = ir.collections.map(buildCustomType);
  return { customTypes, documents: [doc], assets, stylesManifest: [], diagnostics: ir.diagnostics ?? [] };
}
