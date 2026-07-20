import type { Media } from "../grid/types.js";
import type { Diagnostic } from "../ir.js";
// Only `mediaUrl`/`mediaCdnUrl` are reused from the grid emit; `collectPlanAssets`/
// `collectMedia` there only understand SliceSpec shapes, so the skeleton resolves
// its own CatalogSpec media below (see grid-plan.ts `buildGridSitePlan` for the pattern).
import { mediaCdnUrl, mediaUrl } from "../emit/grid-plan.js";
import {
  type MigrationPlan,
  type PlanAsset,
  type PlanDocument,
  type PlanSlice,
  assetRef,
  richText,
} from "../emit/plan.js";
import type { CatalogCell, CatalogSpec } from "./spec.js";

/** An inline `<video>` tag for a video Media. Videos cannot ride Prismic
 * Image fields (PrismicImage would render a broken <img>) — they play from
 * the export's CDN url instead (self-hosted upload pends the 4d asset
 * strategy). Url logic mirrors `mediaCdnUrl`; bare assetId as last resort. */
function videoTag(m: Media): string {
  return `<video controls playsinline src="${mediaCdnUrl(m) ?? m.assetId}"></video>`;
}

/** One catalog cell → its nested-group item object. Rich text and media become
 * `{__richtext_html}` / `{__asset_id}` markers (resolveDocData resolves them,
 * including at this depth). Absent fields are omitted so the item stays lean.
 * Video media becomes `embed_html` (joined with any captured raw html), never
 * an Image-field marker. */
function cellToItem(cell: CatalogCell): Record<string, unknown> {
  const video = cell.media?.kind === "video" ? videoTag(cell.media) : undefined;
  const embeds = [video, cell.embedHtml].filter((s): s is string => Boolean(s));
  return {
    kind: cell.kind,
    ...(cell.title ? { title: richText(cell.title) } : {}),
    ...(cell.body ? { body: richText(cell.body) } : {}),
    ...(cell.media && cell.media.kind !== "video"
      ? { media: assetRef(cell.media.assetId) }
      : {}),
    ...(cell.mediaRatio ? { media_ratio: cell.mediaRatio } : {}),
    ...(embeds.length ? { embed_html: embeds.join("\n") } : {}),
    ...(cell.subgrid ? { subgrid: cell.subgrid.map(cellToItem) } : {}),
  };
}

/** `{slice_type, variation:"default", items:[], primary}` — every Plan-2 catalog
 * slice shares this envelope; only the primary differs. */
function sliceOf(type: string, primary: Record<string, unknown>): PlanSlice {
  return { slice_type: type, variation: "default", items: [], primary };
}

/** The optional section heading as a rich-text marker (container specs only). */
function heading(spec: CatalogSpec): Record<string, unknown> {
  return "heading" in spec && spec.heading ? { heading: richText(spec.heading) } : {};
}

/** Map one catalog spec to its populated page-doc slice (Plan-2 field names). */
export function catalogSpecToPlanSlice(spec: CatalogSpec): PlanSlice {
  const bg = spec.background
    ? { background_image: assetRef(spec.background.assetId) }
    : {};
  const bgc = spec.backgroundColor
    ? { background_color: spec.backgroundColor }
    : {};
  switch (spec.slice) {
    case "BluxSection":
      return sliceOf("blux_section", {
        ...bg,
        ...bgc,
        ...heading(spec),
        cells: spec.cells.map(cellToItem),
      });
    case "BluxGrid":
      return sliceOf("blux_grid", {
        ...bg,
        ...bgc,
        ...heading(spec),
        ...(spec.columns ? { columns: spec.columns } : {}),
        cells: spec.cells.map(cellToItem),
      });
    case "BluxGallery":
      return sliceOf("blux_gallery", {
        ...bg,
        ...bgc,
        ...heading(spec),
        cells: spec.cells.map(cellToItem),
      });
    case "BluxCarousel":
      return sliceOf("blux_carousel", {
        ...bg,
        ...bgc,
        ...heading(spec),
        ...(spec.columnsVisible ? { columns_visible: spec.columnsVisible } : {}),
        cells: spec.cells.map(cellToItem),
      });
    case "BluxMedia":
      return sliceOf("blux_media", {
        ...bg,
        ...bgc,
        // Video plays from its CDN url via `video_embed` — an Image-field
        // marker would render a broken <img> in the starter (PrismicImage).
        ...(spec.media.kind === "video"
          ? { video_embed: videoTag(spec.media) }
          : { media: assetRef(spec.media.assetId) }),
        ...(spec.caption ? { caption: richText(spec.caption) } : {}),
      });
    case "BluxMediaText":
      return sliceOf("blux_media_text", {
        ...bg,
        ...bgc,
        media: assetRef(spec.media.assetId),
        media_side: spec.mediaSide,
        ...(spec.layoutRatio ? { layout_ratio: spec.layoutRatio } : {}),
        ...(spec.title ? { title: richText(spec.title) } : {}),
        ...(spec.body ? { body: richText(spec.body) } : {}),
      });
    case "BluxBlock": {
      // Besides the primary background fields (which the starter model gains
      // in a parallel change), wrap the payload root in a background div so
      // the fallback renders the band background even on today's model.
      const payload = spec.background
        ? {
            tag: "div",
            style: {
              backgroundImage: `url(${
                mediaCdnUrl(spec.background) ?? spec.background.assetId
              })`,
            },
            children: [spec.payload],
          }
        : spec.payload;
      return sliceOf("blux_block", {
        ...bg,
        ...bgc,
        payload: JSON.stringify(payload),
      });
    }
  }
}

/** Every Media a catalog spec references (background + leaf media + cell media,
 * recursing through subgrids). */
function specMedia(spec: CatalogSpec): Media[] {
  const out: Media[] = [];
  if (spec.background) out.push(spec.background);
  const walk = (cells: CatalogCell[]) => {
    for (const c of cells) {
      if (c.media) out.push(c.media);
      if (c.subgrid) walk(c.subgrid);
    }
  };
  switch (spec.slice) {
    case "BluxMedia":
    case "BluxMediaText":
      out.push(spec.media);
      break;
    case "BluxSection":
    case "BluxGrid":
    case "BluxGallery":
    case "BluxCarousel":
      walk(spec.cells);
      break;
    case "BluxBlock":
      // The payload inlines each media as a CDN url; the same Media surface
      // on `spec.media` so the assets still upload. Payload urls remain CDN
      // until the 4d migrate-time rewrite (runMigration's assetUrlByCdn is
      // the map for it).
      out.push(...spec.media);
      break;
  }
  // Video assets stay OUT of the image uploads — video plays from the CDN url
  // inside the emitted <video> tag, pending the 4d asset strategy.
  return out.filter((m) => m.kind !== "video");
}

export type CatalogAssetIndex = {
  assets: { id: string; url: string; alt: string; sourceUrl?: string | null }[];
  diagnostics?: Diagnostic[];
};

/** Build the migration plan for catalog-converted pages: one text+slices page
 * document each, plus the asset union (uploaded so nested `{__asset_id}` markers
 * resolve at migrate time). No custom types / sidecar in the skeleton. */
export function buildCatalogPlan(
  pages: { uid: string; title: string; specs: CatalogSpec[] }[],
  ir: CatalogAssetIndex,
): MigrationPlan {
  const documents: PlanDocument[] = pages.map((p) => ({
    type: "page",
    uid: p.uid,
    data: { title: richText(`<h1>${p.title}</h1>`), slices: p.specs.map(catalogSpecToPlanSlice) },
  }));
  const assetById = new Map(ir.assets.map((a) => [a.id, a] as const));
  const sourceUrlById = new Map(ir.assets.map((a) => [a.id, a.sourceUrl] as const));
  const resolve = (m: Media): PlanAsset | null => {
    const asset = assetById.get(m.assetId);
    const url = mediaUrl(m, sourceUrlById);
    return url ? { id: m.assetId, url, alt: asset?.alt ?? "" } : null;
  };
  const diagnostics: Diagnostic[] = [...(ir.diagnostics ?? [])];
  // collectPlanAssets only understands SliceSpec shapes, so gather media here and
  // resolve directly (skeleton) — keep insertion order, dedupe by assetId.
  const seen = new Set<string>();
  const assets: PlanAsset[] = [];
  for (const spec of pages.flatMap((p) => p.specs)) {
    for (const m of specMedia(spec)) {
      if (seen.has(m.assetId)) continue;
      seen.add(m.assetId);
      const a = resolve(m);
      if (a) assets.push(a);
      else
        diagnostics.push({
          kind: "unresolved-asset",
          where: m.assetId,
          message: `media ${m.assetId} has no CDN base nor IR source url — not uploaded`,
        });
    }
  }
  return { customTypes: [], documents, assets, stylesManifest: [], diagnostics };
}
