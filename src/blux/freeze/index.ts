import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { settleExport } from "./settle.js";
import { mapPlaceholder } from "./map-placeholder.js";
import { pinSliders } from "./slider-pin.js";
import { resolveAnchors } from "./resolve-anchors.js";
import { bakeImages } from "./bake-images.js";
import { tokenizeText } from "./tokenize-text.js";
import { finalize } from "./finalize.js";
import { extractMapConfig } from "../grid/extract-map.js";
import { validateExtraSlots } from "./extra-slots.js";
import type { FrozenResult } from "./types.js";

export type { Slot, FrozenManifest, FrozenResult, ExtraSlotsFile } from "./types.js";
export { frozenPageCustomType, FROZEN_PAGE_TYPE } from "./frozen-page-type.js";
export { validateExtraSlots } from "./extra-slots.js";
export { EXTRA_SLOT_PREFIX } from "./types.js";

export interface FreezeOptions {
  /** Path to the export's index.html. */
  indexHtmlPath: string;
  /** Site slug — names the emitted template/style/manifest files. */
  site: string;
  /** Prismic uid for the page doc (default "home"). */
  uid?: string;
  /** A site's own extra-slots declaration (parsed `ExtraSlotsFile`), for
   *  editable content the template carries no token for. See types.ts. */
  extraSlots?: unknown;
}

/**
 * Freeze one Blux page into a byte-faithful template + editable slot manifest.
 * Order matters: bake images (their urls become slots) BEFORE tokenizing text,
 * so image tokens live in style attributes and never collide with text tokens.
 */
export async function freezeSite(opts: FreezeOptions): Promise<FrozenResult> {
  const { html: settled, anchorTargets } = await settleExport(opts.indexHtmlPath);
  // Settled-DOM repairs run before image/text tokenizing: swap the dead
  // Google-Map DOM for a placeholder (using the raw export for the KML mid),
  // pin each hero slider to slide 1, and bake nav hashlink targets (settle's
  // click audit measured them against the export's own runtime).
  const exportHtml = await readFile(opts.indexHtmlPath, "utf-8");
  const mapped = mapPlaceholder(settled, exportHtml);
  const pinned = pinSliders(mapped);
  const anchored = resolveAnchors(pinned, anchorTargets);
  const baked = bakeImages(anchored);
  const tokenized = tokenizeText(baked.html);
  const fin = finalize(tokenized.html);

  // The full map widget config (layers/toggles/styles) lives in the export's
  // initMap script — carried alongside the template so the render can hydrate
  // the real map. Only meaningful when its mount survived into the template.
  const rawMap = extractMapConfig(exportHtml);
  const mapConfig =
    rawMap && fin.templateHtml.includes(`id="${rawMap.mountId}"`) ? rawMap : undefined;

  // Derived slots first, then the site's own. Validated against the derived
  // keys so a declaration can never shadow real page content.
  const derived = [...baked.slots, ...tokenized.slots];
  const extra = validateExtraSlots(opts.extraSlots, derived);

  return {
    manifest: {
      site: opts.site,
      uid: opts.uid ?? "home",
      title: fin.title,
      metaTitle: fin.metaTitle,
      metaImageUrl: fin.metaImageUrl,
      fontLinks: fin.fontLinks,
      slots: [...derived, ...extra],
    },
    templateHtml: fin.templateHtml,
    styleCss: fin.styleCss,
    mapConfig,
  };
}

/**
 * Write the freeze artifacts under `outDir`. Returns their paths.
 *
 * `frozen/` is site-repo-ready: uid-keyed `<uid>.html` / `<uid>.style.css` /
 * `<uid>.fonts.json` (+ `<uid>.map.json` when the export has a map widget),
 * copied verbatim into the site repo's `src/lib/blux-frozen/frozen/` — exactly
 * the names the starter's artifact globs load. The slots manifest stays
 * site-keyed at the out-dir root, where `blux migrate-frozen` finds it.
 */
export async function emitFrozen(
  outDir: string,
  result: FrozenResult,
): Promise<{
  template: string;
  style: string;
  fonts: string;
  manifest: string;
  map?: string;
}> {
  const { site, uid } = result.manifest;
  const frozenDir = join(outDir, "frozen");
  await mkdir(frozenDir, { recursive: true });
  const template = join(frozenDir, `${uid}.html`);
  const style = join(frozenDir, `${uid}.style.css`);
  const fonts = join(frozenDir, `${uid}.fonts.json`);
  const manifest = join(outDir, `${site}.slots.json`);
  await writeFile(template, result.templateHtml, "utf-8");
  await writeFile(style, result.styleCss, "utf-8");
  await writeFile(fonts, JSON.stringify(result.manifest.fontLinks, null, 2), "utf-8");
  await writeFile(manifest, JSON.stringify(result.manifest, null, 2), "utf-8");
  if (!result.mapConfig) return { template, style, fonts, manifest };
  const map = join(frozenDir, `${uid}.map.json`);
  await writeFile(map, JSON.stringify(result.mapConfig, null, 2), "utf-8");
  return { template, style, fonts, manifest, map };
}
