import type { Media } from "../grid/types.js";
import type { Diagnostic } from "../ir.js";
// Only `mediaUrl` is reused from the grid emit; `collectPlanAssets`/`collectMedia`
// there only understand SliceSpec shapes, so the skeleton resolves its own
// CatalogSpec media below (see grid-plan.ts `buildGridSitePlan` for the pattern).
import { mediaUrl } from "../emit/grid-plan.js";
import {
  type MigrationPlan,
  type PlanAsset,
  type PlanDocument,
  type PlanSlice,
  assetRef,
  richText,
} from "../emit/plan.js";
import type { CatalogCell, CatalogSpec } from "./spec.js";

/** One catalog cell → its nested-group item object. Rich text and media become
 * `{__richtext_html}` / `{__asset_id}` markers (resolveDocData resolves them,
 * including at this depth). Absent fields are omitted so the item stays lean. */
function cellToItem(cell: CatalogCell): Record<string, unknown> {
  return {
    kind: cell.kind,
    ...(cell.title ? { title: richText(cell.title) } : {}),
    ...(cell.body ? { body: richText(cell.body) } : {}),
    ...(cell.media ? { media: assetRef(cell.media.assetId) } : {}),
    ...(cell.mediaRatio ? { media_ratio: cell.mediaRatio } : {}),
    ...(cell.subgrid ? { subgrid: cell.subgrid.map(cellToItem) } : {}),
  };
}

/** Map one catalog spec to its populated page-doc slice. Skeleton: BluxSection. */
export function catalogSpecToPlanSlice(spec: CatalogSpec): PlanSlice {
  return {
    slice_type: "blux_section",
    variation: "default",
    items: [],
    primary: {
      ...(spec.background ? { background_image: assetRef(spec.background.assetId) } : {}),
      ...(spec.backgroundColor ? { background_color: spec.backgroundColor } : {}),
      ...(spec.heading ? { heading: richText(spec.heading) } : {}),
      cells: spec.cells.map(cellToItem),
    },
  };
}

/** Every Media a catalog spec references (background + cell media + subgrid media). */
function specMedia(spec: CatalogSpec): Media[] {
  const out: Media[] = [];
  if (spec.background) out.push(spec.background);
  const walk = (cells: CatalogCell[]) => {
    for (const c of cells) {
      if (c.media) out.push(c.media);
      if (c.subgrid) walk(c.subgrid);
    }
  };
  walk(spec.cells);
  return out;
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
