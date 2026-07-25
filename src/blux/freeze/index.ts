import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { settleExport } from "./settle.js";
import { mapPlaceholder } from "./map-placeholder.js";
import { pinSliders } from "./slider-pin.js";
import { bakeImages } from "./bake-images.js";
import { tokenizeText } from "./tokenize-text.js";
import { finalize } from "./finalize.js";
import type { FrozenResult } from "./types.js";

export type { Slot, FrozenManifest, FrozenResult } from "./types.js";
export { frozenPageCustomType, FROZEN_PAGE_TYPE } from "./frozen-page-type.js";

export interface FreezeOptions {
  /** Path to the export's index.html. */
  indexHtmlPath: string;
  /** Site slug — names the emitted template/style/manifest files. */
  site: string;
  /** Prismic uid for the page doc (default "home"). */
  uid?: string;
}

/**
 * Freeze one Blux page into a byte-faithful template + editable slot manifest.
 * Order matters: bake images (their urls become slots) BEFORE tokenizing text,
 * so image tokens live in style attributes and never collide with text tokens.
 */
export async function freezeSite(opts: FreezeOptions): Promise<FrozenResult> {
  const settled = await settleExport(opts.indexHtmlPath);
  // v2 transforms run on the settled DOM before image/text tokenizing: swap the
  // dead Google-Map DOM for a placeholder (using the raw export for the KML mid)
  // and pin each hero slider to slide 1.
  const exportHtml = await readFile(opts.indexHtmlPath, "utf-8");
  const mapped = mapPlaceholder(settled, exportHtml);
  const pinned = pinSliders(mapped);
  const baked = bakeImages(pinned);
  const tokenized = tokenizeText(baked.html);
  const fin = finalize(tokenized.html);

  return {
    manifest: {
      site: opts.site,
      uid: opts.uid ?? "home",
      title: fin.title,
      metaTitle: fin.metaTitle,
      metaImageUrl: fin.metaImageUrl,
      fontLinks: fin.fontLinks,
      slots: [...baked.slots, ...tokenized.slots],
    },
    templateHtml: fin.templateHtml,
    styleCss: fin.styleCss,
  };
}

/** Write the three freeze artifacts under `outDir`. Returns their paths. */
export async function emitFrozen(
  outDir: string,
  result: FrozenResult,
): Promise<{ template: string; style: string; manifest: string }> {
  const site = result.manifest.site;
  const frozenDir = join(outDir, "frozen");
  await mkdir(frozenDir, { recursive: true });
  const template = join(frozenDir, `${site}.html`);
  const style = join(frozenDir, `${site}.style.css`);
  const manifest = join(outDir, `${site}.slots.json`);
  await writeFile(template, result.templateHtml, "utf-8");
  await writeFile(style, result.styleCss, "utf-8");
  await writeFile(manifest, JSON.stringify(result.manifest, null, 2), "utf-8");
  return { template, style, manifest };
}
