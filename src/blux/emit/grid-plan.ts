import { type SliceSpec, type Media, collectMedia } from "../grid/index.js";
import type { Diagnostic, SiteIR } from "../ir.js";
import { buildCustomType } from "./custom-types.js";
import { sliceSpecToPlanSlice } from "./grid-slice.js";
import { type MigrationPlan, type PlanAsset, type PlanDocument, richText } from "./plan.js";

/** Build the CDN url for a media from its parser-captured base + uuid + ext.
 * Null when the node carried no `data-base` (the manifest resolver then falls
 * back to the IR asset's sourceUrl — see `buildGridPlan`). Exported so the
 * `blux convert` manifest resolver builds byte-identical urls (a later task
 * rewrites the manifest by matching plan.assets urls). */
export function mediaCdnUrl(m: Media): string | null {
  return m.base ? `${m.base}${m.assetId}${m.ext ? `.${m.ext}` : ""}` : null;
}

/** The absolute source url for a media: the parser-captured CDN url
 * (data-base + uuid + ext) if present, else the IR asset's scraped sourceUrl,
 * else null. Shared by the plan's asset list and the manifest resolver so the
 * two url strings are byte-identical (the migrate rewrite keys on that). */
export function mediaUrl(
  m: Media,
  sourceUrlById: Map<string, string | null | undefined>,
): string | null {
  return mediaCdnUrl(m) ?? sourceUrlById.get(m.assetId) ?? null;
}

/** Every Media referenced across all specs: band backgrounds, direct media
 * fields, and media inside node trees (SplitFeature.text / Grid.root). Deduped
 * by assetId, first occurrence wins, insertion order preserved. `resolve`
 * turns a media into its upload entry (CDN-base url, else IR sourceUrl) or null
 * when neither is available — an unresolvable media is dropped and (if a
 * `diagnostics` sink is passed) recorded once per assetId. */
export function collectPlanAssets(
  specs: SliceSpec[],
  resolve: (m: Media) => PlanAsset | null,
  diagnostics?: Diagnostic[],
): PlanAsset[] {
  const byId = new Map<string, PlanAsset>();
  const seen = new Set<string>();
  const add = (m: Media) => {
    if (seen.has(m.assetId)) return;
    seen.add(m.assetId);
    const asset = resolve(m);
    if (asset) byId.set(m.assetId, asset);
    else
      diagnostics?.push({
        kind: "unresolved-asset",
        where: m.assetId,
        message: `media ${m.assetId} has no CDN base nor IR source url — not uploaded`,
      });
  };
  for (const spec of specs) {
    if (spec.background) add(spec.background);
    switch (spec.slice) {
      case "Gallery":
        spec.media.forEach(add);
        break;
      case "Carousel":
        spec.slides.forEach((s) => add(s.media));
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
  // Upload-url resolution MUST stay identical to the later manifest resolver:
  // CDN-base url first, else the IR asset's sourceUrl. `mediaUrl` is the
  // single shared implementation (see its doc comment above).
  const assetById = new Map(ir.assets.map((a) => [a.id, a] as const));
  const sourceUrlById = new Map(ir.assets.map((a) => [a.id, a.sourceUrl] as const));
  const resolve = (m: Media): PlanAsset | null => {
    const asset = assetById.get(m.assetId);
    const url = mediaUrl(m, sourceUrlById);
    return url ? { id: m.assetId, url, alt: asset?.alt ?? "" } : null;
  };
  const diagnostics: Diagnostic[] = [...(ir.diagnostics ?? [])];
  const assets = collectPlanAssets(specs, resolve, diagnostics);
  const customTypes = ir.collections.map(buildCustomType);
  return { customTypes, documents: [doc], assets, stylesManifest: [], diagnostics };
}
