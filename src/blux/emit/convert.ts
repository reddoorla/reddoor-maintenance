import {
  parseGridBands,
  extractMapConfig,
  classifyBands,
  makeIsMapMount,
  type Band,
  type MapConfig,
  type SliceSpec,
} from "../grid/index.js";
import { assembleIR } from "../assemble.js";
import { parseBluxSite } from "../parse.js";
import { normalizePages } from "../normalize.js";
import {
  buildFeedResolvers,
  feedAssetBase,
  isFeedBand,
  materializeFeedGrid,
  resolveFeedTiles,
  type FeedResolvers,
} from "../grid/feed-grid.js";
import type { Node } from "../grid/types.js";
import type { Diagnostic, SiteIR } from "../ir.js";
import { blockClassDefaults, blockStylesByIndex } from "./block-styles.js";
import { buildGridPlan, buildGridSitePlan, mediaUrl } from "./grid-plan.js";
import type { MigrationPlan } from "./plan.js";
import {
  buildPresentation,
  type MapRenderConfig,
  type Presentation,
  type PresentationDeps,
  type RenderMedia,
} from "./presentation.js";

export type ConvertResult = {
  bands: Band[];
  specs: SliceSpec[];
  ir: SiteIR;
  mapConfig: MapConfig | null;
  plan: MigrationPlan;
  presentation: Presentation;
};

/** Drop the source-only `mountId` from an extracted MapConfig → the render-side
 * MapRenderConfig the presentation manifest carries. */
export function mapRenderFromConfig(c: MapConfig): MapRenderConfig {
  return {
    mid: c.mid,
    layers: c.layers,
    toggles: c.toggles,
    styles: c.styles,
    ...(c.center ? { center: c.center } : {}),
    ...(c.zoom !== undefined ? { zoom: c.zoom } : {}),
    ...(c.height ? { height: c.height } : {}),
    ...(c.defaultToggle !== undefined ? { defaultToggle: c.defaultToggle } : {}),
  };
}

/** The offline convert pipeline shared by `blux convert` (writes files) and
 * `blux validate` (checks fidelity): parse + classify index.html, assemble the
 * IR from site.json, and build both emit artifacts through a single media
 * resolver (CDN base ?? IR sourceUrl) so plan, manifest, and validation all
 * agree on which media resolve. Pure + offline — no writes, no network. */
export function convertExport({
  html,
  siteJson,
}: {
  html: string;
  siteJson: unknown;
}): ConvertResult {
  const bands = parseGridBands(html);
  const mapConfig = extractMapConfig(html);
  const specs = classifyBands(bands, mapConfig ? { isMapMount: makeIsMapMount(mapConfig) } : {});
  const ir = assembleIR({ siteJson, htmls: [html] });

  const assetsById = new Map(ir.assets.map((a) => [a.id, a] as const));
  const sourceUrlById = new Map(ir.assets.map((a) => [a.id, a.sourceUrl] as const));
  const styles = blockStylesByIndex(siteJson);
  const defaults = blockClassDefaults(siteJson);
  const deps: PresentationDeps = {
    resolveMedia: (m) => {
      const url = mediaUrl(m, sourceUrlById);
      if (!url) return null;
      const alt = assetsById.get(m.assetId)?.alt;
      const rm: RenderMedia = {
        kind: m.kind,
        url,
        ...(alt ? { alt } : {}),
        ...(m.width !== undefined ? { width: m.width } : {}),
        ...(m.aspect !== undefined ? { aspect: m.aspect } : {}),
        ...(m.fit ? { fit: m.fit } : {}),
        ...(m.position ? { position: m.position } : {}),
        ...(m.minHeight ? { minHeight: m.minHeight } : {}),
        ...(m.playback ? { playback: m.playback } : {}),
      };
      return rm;
    },
    styleFor: (i) => styles.get(i),
    defaultsFor: (blockClass) => defaults.get(blockClass),
    map: mapConfig ? mapRenderFromConfig(mapConfig) : null,
  };

  const plan = buildGridPlan(specs, ir);
  const presentation = buildPresentation(specs, deps);
  return { bands, specs, ir, mapConfig, plan, presentation };
}

/** The leading heading/subtitle nodes of a parsed band root — a feed band's
 * real heading survives the parse (only the tile template was dropped), so we
 * keep it and append the materialized tile row below. */
function leadingHeadings(root: Node): Node[] {
  if (root.kind === "heading" || root.kind === "subtitle") return [root];
  if (root.kind === "stack") {
    const out: Node[] = [];
    for (const c of root.children) {
      if (c.kind === "heading" || c.kind === "subtitle") out.push(c);
      else break; // headings lead; stop at the first non-heading (the dropped grid)
    }
    return out;
  }
  return [];
}

/** A feed band's grid column count: the source `columns` (site.json), else a
 * sensible default. */
function feedColumns(item: { columns?: unknown }): number {
  const n = Number(item.columns);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/** Did this band lose its content to the feed-template drop? — its parsed root
 * is empty (just heading(s)/subtitle/empty-raw, no media and no populated
 * row). Only such a band is a safe materialization target: a band that already
 * parsed real content is NOT a JS-hydrated feed grid, so the positional
 * site.json join landed on the wrong band and must not clobber it. */
function isEmptyish(root: Node): boolean {
  switch (root.kind) {
    case "heading":
    case "subtitle":
      return true;
    case "raw":
      return root.html.trim() === "";
    case "media":
    case "widget":
      return false;
    case "row":
      return root.cells.length === 0;
    case "stack":
      return root.children.every(isEmptyish);
    default:
      return false;
  }
}

/** Replace each feed band's root (parsed to just its heading, the tile
 * template having been dropped) with the heading over a materialized tile row
 * rebuilt from the feed records. Feed bands whose source resolves to no tiles
 * keep their heading and get an `empty-feed-grid` diagnostic. Mutates `bands`.
 * The join is positional: site.json `items[i]` ↔ the band whose index is `i`
 * (the block-styles convention); a page with non-contiguous band ids simply
 * finds no item and is left as parsed. */
function materializeFeedBands(
  bands: Band[],
  pageItems: unknown[] | undefined,
  resolvers: FeedResolvers,
  diagnostics: Diagnostic[],
): void {
  if (!Array.isArray(pageItems)) return;
  for (const band of bands) {
    const item = pageItems[band.index];
    if (!isFeedBand(item)) continue;
    // Guard the positional join: only a band that lost its content to the
    // template drop is a real feed grid. A band that already parsed real
    // content means items[band.index] misaligned (a non-contiguous page) —
    // materializing would CLOBBER it, so skip with a diagnostic instead.
    if (!isEmptyish(band.root)) {
      diagnostics.push({
        kind: "empty-feed-grid",
        where: String(band.index),
        message: `band ${band.index} has parsed content but site.json item is a feed source — positional join misaligned, left as parsed`,
      });
      continue;
    }
    const tiles = resolveFeedTiles(item, resolvers);
    if (!tiles) {
      diagnostics.push({
        kind: "empty-feed-grid",
        where: String(band.index),
        message: `feed band ${band.index} (source ${String(item.sources[0])}) resolved to no tiles`,
      });
      continue;
    }
    const spacing = parseInt(String((item as { spacing?: unknown }).spacing ?? ""), 10);
    const row = materializeFeedGrid({
      tiles,
      columns: feedColumns(item as { columns?: unknown }),
      ...(Number.isFinite(spacing) && spacing > 0 ? { spacing } : {}),
    });
    if (!row) continue;
    const headings = leadingHeadings(band.root);
    band.root = headings.length ? { kind: "stack", children: [...headings, row] } : row;
  }
}

/** The site's page routing table (uid + export path + title), derivable from
 * site.json alone — the CLI uses it to locate each page's rendered html
 * (root index.html for the homepage, `<path>/index.html` for the rest)
 * before running convertSite. */
export function sitePages(siteJson: unknown): { uid: string; path: string; title: string }[] {
  const { pages } = normalizePages(parseBluxSite(siteJson));
  return pages.map((p) => ({ uid: p.uid, path: p.path, title: p.title }));
}

/** One converted page of a multi-page site. */
export type ConvertedPage = {
  uid: string;
  title: string;
  path: string;
  bands: Band[];
  specs: SliceSpec[];
  mapConfig: MapConfig | null;
};

/** A multi-page presentation manifest: per-page band manifests keyed by page
 * uid. Band indices are page-local (`page-block-N` restarts at 0 on every
 * page), so a flat bands map would collide across pages — the render side's
 * `loadPresentation(uid)` selects the page slice. */
export type MultiPagePresentation = { pages: Record<string, Presentation> };

/** The whole-site faithful-grid convert: every page of the export (each page
 * dir's rendered index.html) through the same parse → classify → presentation
 * pipeline `convertExport` runs for one page. One IR assembled from ALL page
 * htmls (the asset urlMap then resolves media that only appear on inner
 * pages), one migration plan (a document per page, the asset union), and a
 * per-page presentation manifest. Pages whose html is missing from
 * `htmlByUid` (unexported drafts) are skipped with a diagnostic. */
export function convertSite({
  siteJson,
  htmlByUid,
}: {
  siteJson: unknown;
  htmlByUid: Map<string, string>;
}): {
  pages: ConvertedPage[];
  ir: SiteIR;
  plan: MigrationPlan;
  presentation: MultiPagePresentation;
} {
  const ir = assembleIR({ siteJson, htmls: [...htmlByUid.values()] });
  const assetsById = new Map(ir.assets.map((a) => [a.id, a] as const));
  const sourceUrlById = new Map(ir.assets.map((a) => [a.id, a.sourceUrl] as const));
  const defaults = blockClassDefaults(siteJson);

  // Feed-grid materialization: gallery/portfolio tiles render client-side from
  // feed records (the static export ships only the dropped {{…}} template), so
  // we rebuild them deterministically from the feed data (see feed-grid.ts).
  // The asset base is scraped from the export's own data-base so feed images
  // use the RIGHT CDN host (Blux spreads assets across two).
  const raw = parseBluxSite(siteJson);
  const assetBase = feedAssetBase([...htmlByUid.values()], ir.meta.bluxSiteId);
  const feedResolvers = buildFeedResolvers(raw.feeds, raw.media, assetBase);
  const pageItemsByIndex = (siteJson as { content?: { pages?: { items?: unknown[] }[] } })?.content
    ?.pages;

  const pages: ConvertedPage[] = [];
  const presentation: MultiPagePresentation = { pages: {} };
  ir.pages.forEach((page, pageIndex) => {
    const html = htmlByUid.get(page.uid);
    if (html === undefined) {
      ir.diagnostics.push({
        kind: "missing-page-html",
        where: page.uid,
        message: `no rendered html for page "${page.uid}" (${page.path || "/"}) — page skipped`,
      });
      return;
    }
    const bands = parseGridBands(html);
    materializeFeedBands(
      bands,
      pageItemsByIndex?.[pageIndex]?.items,
      feedResolvers,
      ir.diagnostics,
    );
    const mapConfig = extractMapConfig(html);
    const specs = classifyBands(bands, mapConfig ? { isMapMount: makeIsMapMount(mapConfig) } : {});
    const styles = blockStylesByIndex(siteJson, pageIndex);
    const deps: PresentationDeps = {
      resolveMedia: (m) => {
        const url = mediaUrl(m, sourceUrlById);
        if (!url) return null;
        const alt = assetsById.get(m.assetId)?.alt;
        const rm: RenderMedia = {
          kind: m.kind,
          url,
          ...(alt ? { alt } : {}),
          ...(m.width !== undefined ? { width: m.width } : {}),
          ...(m.aspect !== undefined ? { aspect: m.aspect } : {}),
          ...(m.fit ? { fit: m.fit } : {}),
          ...(m.position ? { position: m.position } : {}),
          ...(m.minHeight ? { minHeight: m.minHeight } : {}),
          ...(m.playback ? { playback: m.playback } : {}),
        };
        return rm;
      },
      styleFor: (i) => styles.get(i),
      defaultsFor: (blockClass) => defaults.get(blockClass),
      map: mapConfig ? mapRenderFromConfig(mapConfig) : null,
    };
    presentation.pages[page.uid] = buildPresentation(specs, deps);
    pages.push({ uid: page.uid, title: page.title, path: page.path, bands, specs, mapConfig });
  });

  const plan = buildGridSitePlan(
    pages.map((p) => ({ uid: p.uid, title: p.title, specs: p.specs })),
    ir,
  );
  return { pages, ir, plan, presentation };
}
