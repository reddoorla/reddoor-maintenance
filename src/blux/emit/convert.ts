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
import type { SiteIR } from "../ir.js";
import { blockStylesByIndex } from "./block-styles.js";
import { buildGridPlan, mediaUrl } from "./grid-plan.js";
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
        ...(m.playback ? { playback: m.playback } : {}),
      };
      return rm;
    },
    styleFor: (i) => styles.get(i),
    map: mapConfig ? mapRenderFromConfig(mapConfig) : null,
  };

  const plan = buildGridPlan(specs, ir);
  const presentation = buildPresentation(specs, deps);
  return { bands, specs, ir, mapConfig, plan, presentation };
}
