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
import { videoTag } from "./cells.js";
import { buildEntityEmit } from "./entities.js";
import { hasVisibleContent, sanitizeHtml } from "./sanitize.js";
import type { BlockNode, CatalogBase, CatalogCell, CatalogSpec } from "./spec.js";

/** Clamp a heading level into the `[min, max]` window a target field's model
 * allows. Classify wraps headings at their TRUE source level (section-heading
 * promotion and BluxBlock fidelity need it) — the emit boundary is where the
 * destination field is known, so clamping lives here. */
function clampHeading(level: number, min: number, max: number): number {
  return Math.min(Math.max(level, min), max);
}

/** Re-tag a wrapped `<hN>…</hN>` rich-text string into the destination
 * field's heading window: cell titles + carousel captions model heading3/
 * heading4 (h3–h4); section/grid heading fields model heading2/heading3
 * (h2–h3). Body fields are NEVER clamped — folded headings keep their true
 * level (bodies are paragraph-modeled; see cells.ts textOf). Non-heading
 * html (e.g. a `<p>` caption) passes through untouched. */
function clampHeadingHtml(html: string, min: number, max: number): string {
  const m = /^<h([1-6])>([\s\S]*)<\/h\1>$/.exec(html.trim());
  if (!m) return html;
  const level = clampHeading(Number(m[1]), min, max);
  return `<h${level}>${m[2]}</h${level}>`;
}

/** Emit-time context: the band index + owning page uid (for diagnostics
 * `where`) and the optional diagnostics sink threaded down from
 * `buildCatalogPlan`. */
type EmitCtx = { index: number; pageUid?: string; diagnostics?: Diagnostic[] };

const MOUNT_RE = /data-exec="(custom_[a-f0-9_]+)"/;

/** Record a dropped behavior-script widget — never silent. A custom mount
 * names its widget uuid; other script-only embeds report generically. `where`
 * is page-qualified (round-3 4: `<pageUid>:<band>`) whenever the caller knows
 * the page — a bare band index is ambiguous across a multi-page site. */
function reportDrop(ctx: EmitCtx, html: string): void {
  const uuid = MOUNT_RE.exec(html)?.[1];
  ctx.diagnostics?.push({
    kind: "dropped-widget",
    where: ctx.pageUid !== undefined ? `${ctx.pageUid}:${ctx.index}` : `band ${ctx.index}`,
    message: uuid
      ? `custom widget ${uuid} is a behavior script (no visible content) — not migrated`
      : "embed html has no visible content after sanitize — not migrated",
  });
}

/** One catalog cell → its nested-group item object. Rich text and media become
 * `{__richtext_html}` / `{__asset_id}` markers (resolveDocData resolves them,
 * including at this depth). Absent fields are omitted so the item stays lean.
 * Video media becomes `embed_html` (joined with any captured raw html), never
 * an Image-field marker. */
function cellToItem(cell: CatalogCell, ctx: EmitCtx): Record<string, unknown> {
  const video = cell.media?.kind === "video" ? videoTag(cell.media) : undefined;
  // Sanitize captured raw html at the boundary — the spec keeps it pristine.
  const embedHtml = cell.embedHtml ? sanitizeHtml(cell.embedHtml) : undefined;
  const embeds = [video, embedHtml].filter((s): s is string => Boolean(s && s.trim()));
  return {
    kind: cell.kind,
    ...(cell.title ? { title: richText(clampHeadingHtml(cell.title, 3, 4)) } : {}),
    ...(cell.body ? { body: richText(cell.body) } : {}),
    ...(cell.media && cell.media.kind !== "video" ? { media: assetRef(cell.media.assetId) } : {}),
    ...(cell.mediaRatio ? { media_ratio: cell.mediaRatio } : {}),
    ...(embeds.length ? { embed_html: embeds.join("\n") } : {}),
    ...(cell.subgrid ? { subgrid: emitCells(cell.subgrid, ctx) } : {}),
  };
}

/** Emit a cell list, dropping EMBED cells whose html sanitizes to nothing
 * visible (a behavior-script mount is not content — an empty shell would
 * migrate as a blank cell). By construction (cells.ts buildCell) an "embed"
 * cell carries ONLY embedHtml, so nothing else is lost by the drop; every
 * drop is recorded on the diagnostics sink. */
function emitCells(cells: CatalogCell[], ctx: EmitCtx): Record<string, unknown>[] {
  const kept: Record<string, unknown>[] = [];
  for (const c of cells) {
    if (c.kind === "embed" && c.embedHtml && !hasVisibleContent(c.embedHtml)) {
      reportDrop(ctx, c.embedHtml);
      continue;
    }
    kept.push(cellToItem(c, ctx));
  }
  return kept;
}

/** `{slice_type, variation:"default", items:[], primary}` — every Plan-2 catalog
 * slice shares this envelope; only the primary differs. */
function sliceOf(type: string, primary: Record<string, unknown>): PlanSlice {
  return { slice_type: type, variation: "default", items: [], primary };
}

/** The optional section heading as a rich-text marker (container specs only),
 * clamped to the heading field's h2–h3 model window. */
function heading(spec: CatalogSpec): Record<string, unknown> {
  return "heading" in spec && spec.heading
    ? { heading: richText(clampHeadingHtml(spec.heading, 2, 3)) }
    : {};
}

/** Decision-B widget emission (plan 4b). Contract with the starter design
 * layer: Plan-2 BluxSection renders `widget_html` via {@html} inside a
 * `.blux-widget` div; when a MapConfig was extracted the sanitized mount is
 * wrapped in `.blux-map[data-map-config]` — the design layer parses that JSON
 * and hydrates an interactive Google map on the mount, while the sanitized
 * legend markup renders statically regardless. Config JSON escapes `'` as
 * &#39; so the single-quoted attribute survives any styles content. The
 * parameter is structural (the CatalogBase widget triple) so every spec that
 * can carry a widget — Section, Collection, and (round 3) Grid + Block —
 * shares the exact same emission and Section-identical field names. */
function widgetFields(
  spec: Pick<CatalogBase, "widgetKind" | "widgetHtml" | "mapConfig">,
): Record<string, unknown> {
  if (!spec.widgetHtml) return {};
  const clean = sanitizeHtml(spec.widgetHtml);
  const html = spec.mapConfig
    ? `<div class="blux-map" data-map-config='${JSON.stringify(spec.mapConfig).replace(/'/g, "&#39;")}'>${clean}</div>`
    : clean;
  return {
    ...(spec.widgetKind ? { widget_kind: spec.widgetKind } : {}),
    widget_html: html,
  };
}

/** Map one catalog spec to its populated page-doc slice (Plan-2 field names).
 * `diagnostics` (optional) records every content drop — dropped behavior-script
 * widgets are reported, never silent. `pageUid` (optional) page-qualifies the
 * drops' `where` — `buildCatalogPlan` always passes it. */
export function catalogSpecToPlanSlice(
  spec: CatalogSpec,
  diagnostics?: Diagnostic[],
  pageUid?: string,
): PlanSlice {
  const ctx: EmitCtx = {
    index: spec.index,
    ...(pageUid !== undefined ? { pageUid } : {}),
    ...(diagnostics ? { diagnostics } : {}),
  };
  const bg = spec.background ? { background_image: assetRef(spec.background.assetId) } : {};
  const bgc = spec.backgroundColor ? { background_color: spec.backgroundColor } : {};
  switch (spec.slice) {
    case "BluxSection":
      return sliceOf("blux_section", {
        ...bg,
        ...bgc,
        ...heading(spec),
        ...widgetFields(spec),
        cells: emitCells(spec.cells, ctx),
      });
    case "BluxGrid":
      return sliceOf("blux_grid", {
        ...bg,
        ...bgc,
        ...heading(spec),
        ...widgetFields(spec),
        ...(spec.columns ? { columns: spec.columns } : {}),
        cells: emitCells(spec.cells, ctx),
      });
    case "BluxGallery":
      return sliceOf("blux_gallery", {
        ...bg,
        ...bgc,
        ...heading(spec),
        cells: emitCells(spec.cells, ctx),
      });
    case "BluxCarousel":
      return sliceOf("blux_carousel", {
        ...bg,
        ...bgc,
        ...heading(spec),
        ...(spec.columnsVisible ? { columns_visible: spec.columnsVisible } : {}),
        cells: emitCells(spec.cells, ctx),
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
        ...(spec.title ? { title: richText(clampHeadingHtml(spec.title, 3, 4)) } : {}),
        ...(spec.body ? { body: richText(spec.body) } : {}),
      });
    case "BluxCollection":
      // Query-spec slice (spec §6 row 5): no cells — the starter fetches the
      // mapped entity documents at load time and filters via the tagFilter
      // DSL. scroll_load_more is a Select ("off"|"on") in the model, so a
      // truthy flag emits the literal "on"; absent optionals are omitted.
      return sliceOf("blux_collection", {
        ...bg,
        ...bgc,
        ...heading(spec),
        ...widgetFields(spec),
        collection_type: spec.entityType,
        feed_ids: spec.feedIds.join(","),
        ...(spec.filterTag ? { filter_tag: spec.filterTag } : {}),
        ...(spec.sort ? { sort: spec.sort } : {}),
        ...(spec.limit ? { limit: spec.limit } : {}),
        ...(spec.mediaRatio ? { media_ratio: spec.mediaRatio } : {}),
        layout: spec.layout,
        ...(spec.scrollLoadMore ? { scroll_load_more: "on" } : {}),
      });
    case "BluxBlock": {
      // The starter's blux_block model has NO background fields (the
      // Migration API may reject unknown primary fields), so the band
      // background rides a payload wrapper div instead. Style keys are
      // kebab-case: the starter's styleString emits keys VERBATIM into the
      // style attribute, so camelCase would parse to zero CSS declarations.
      const wrapStyle: Record<string, string> = {
        ...(spec.background
          ? {
              "background-image": `url(${mediaCdnUrl(spec.background) ?? spec.background.assetId})`,
            }
          : {}),
        ...(spec.backgroundColor ? { "background-color": spec.backgroundColor } : {}),
      };
      // Sanitize at the boundary: the spec payload stays the pristine source
      // tree; only the serialized copy the document ships loses its scripts.
      const clean = sanitizePayload(spec.payload, ctx);
      const payload = Object.keys(wrapStyle).length
        ? { tag: "div", style: wrapStyle, children: [clean] }
        : clean;
      // Round 3: a Block-fallback band can carry a lifted map mount too — the
      // widget triple emits with Section-identical field names (the starter
      // render util is shared across the catalog slices).
      return sliceOf("blux_block", {
        ...widgetFields(spec),
        payload: JSON.stringify(payload),
      });
    }
  }
}

/** Deep-copy a BluxBlock payload tree with every `html` field sanitized
 * (mirrors the embed_html/widget_html boundaries — see sanitize.ts). A leaf
 * that is a custom mount with no visible content is a behavior script — it is
 * kept (sanitized, harmless) but the drop of its behavior is recorded. */
function sanitizePayload(node: BlockNode, ctx: EmitCtx): BlockNode {
  if (node.html !== undefined && MOUNT_RE.test(node.html) && !hasVisibleContent(node.html)) {
    reportDrop(ctx, node.html);
  }
  return {
    ...node,
    ...(node.html !== undefined ? { html: sanitizeHtml(node.html) } : {}),
    ...(node.children ? { children: node.children.map((c) => sanitizePayload(c, ctx)) } : {}),
  };
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
  // Videos migrate too: the Blux CDN is being retired, so every referenced
  // asset must land in Prismic. A video uploads by its CDN url exactly like an
  // image; the emitted <video src> (that same CDN url, in video_embed /
  // embed_html) is then swapped to the Prismic url by the migrate-time
  // rewriteDocUrls, which keys on the identical mediaCdnUrl string.
  return out;
}

export type CatalogAssetIndex = {
  assets: { id: string; url: string; alt: string; sourceUrl?: string | null }[];
  diagnostics?: Diagnostic[];
};

/** Build the migration plan for catalog-converted pages: one text+slices page
 * document each, plus the asset union (uploaded so nested `{__asset_id}` markers
 * resolve at migrate time). When `feeds` is passed, the entity emit rides the
 * same plan: its documents/custom types/diagnostics merge in and its record
 * media join the asset walk (resolved like all other media). */
export function buildCatalogPlan(
  pages: { uid: string; title: string; specs: CatalogSpec[] }[],
  ir: CatalogAssetIndex,
  feeds?: Record<string, { name?: string; items?: unknown[]; fields?: unknown } | undefined>,
): MigrationPlan {
  const diagnostics: Diagnostic[] = [...(ir.diagnostics ?? [])];
  const entity = feeds ? buildEntityEmit(feeds) : null;
  const documents: PlanDocument[] = pages.map((p) => ({
    type: "page",
    uid: p.uid,
    data: {
      title: richText(`<h1>${p.title}</h1>`),
      slices: p.specs.map((s) => catalogSpecToPlanSlice(s, diagnostics, p.uid)),
    },
  }));
  if (entity) {
    documents.push(...entity.documents);
    diagnostics.push(...entity.diagnostics);
  }
  const assetById = new Map(ir.assets.map((a) => [a.id, a] as const));
  const sourceUrlById = new Map(ir.assets.map((a) => [a.id, a.sourceUrl] as const));
  const resolve = (m: Media): PlanAsset | null => {
    const asset = assetById.get(m.assetId);
    const url = mediaUrl(m, sourceUrlById);
    return url ? { id: m.assetId, url, alt: asset?.alt ?? "" } : null;
  };
  // collectPlanAssets only understands SliceSpec shapes, so gather media here and
  // resolve directly (skeleton) — keep insertion order, dedupe by assetId.
  // Entity record media walk the same path so their assets upload too.
  const seen = new Set<string>();
  const assets: PlanAsset[] = [];
  const allMedia = [...pages.flatMap((p) => p.specs).flatMap(specMedia), ...(entity?.media ?? [])];
  for (const m of allMedia) {
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
  return {
    customTypes: entity ? entity.customTypes : [],
    documents,
    assets,
    stylesManifest: [],
    diagnostics,
  };
}
