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
import type { SiteIR } from "../ir.js";
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
export type SitePresentation = { pages: Record<string, Presentation> };

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
  presentation: SitePresentation;
} {
  const ir = assembleIR({ siteJson, htmls: [...htmlByUid.values()] });
  const assetsById = new Map(ir.assets.map((a) => [a.id, a] as const));
  const sourceUrlById = new Map(ir.assets.map((a) => [a.id, a.sourceUrl] as const));
  const defaults = blockClassDefaults(siteJson);

  const pages: ConvertedPage[] = [];
  const presentation: SitePresentation = { pages: {} };
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
