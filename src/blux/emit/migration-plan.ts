import type { SiteIR, RecordIR, PageIR, AssetRef, Diagnostic } from "../ir.js";
import { richText, assetRef, type MigrationPlan, type PlanDocument } from "./plan.js";
import { buildCustomType } from "./custom-types.js";
import { sectionToSlice } from "./slices.js";
import { coerceHeadingHtml, demoteHeadingsHtml } from "./coerce-html.js";
import { flattenSections } from "./flatten.js";

/** Slice fields modeled as Prismic Image fields — only image assets may land here. */
const IMAGE_FIELDS = new Set(["background_image", "media", "item_media"]);

const RICHTEXT = new Set(["body", "description"]);

/** A page with no title and no sections emits no document (and no review pair). */
export function isEmptyPage(p: PageIR): boolean {
  return !p.sections.length && !p.title.trim();
}

/** True when the asset may occupy a Prismic Image field. A known non-image
 *  mime is disqualifying; a MISSING mime (exports often omit `type`) falls
 *  back to the filename extension and keeps the asset unless it is clearly
 *  not an image. */
const NON_IMAGE_EXT = /\.(mp4|mov|webm|avi|mp3|wav|pdf|zip)$/i;
function isImageAsset(a: AssetRef | undefined): boolean {
  if (!a) return true; // unknown asset id: leave it; migrate reports the miss
  if (a.mime) return a.mime.startsWith("image/");
  return !NON_IMAGE_EXT.test(a.name);
}

function recordData(rec: RecordIR): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rec.values)) {
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { media?: string }).media === "string"
    ) {
      data[key] = assetRef((value as { media: string }).media);
    } else if (RICHTEXT.has(key) && typeof value === "string") {
      // record rich-text models allow no heading blocks (see buildCustomType)
      data[key] = richText(demoteHeadingsHtml(value));
    } else {
      data[key] = value;
    }
  }
  return data;
}

export function buildMigrationPlan(ir: SiteIR): MigrationPlan {
  const diagnostics: Diagnostic[] = [];
  const customTypes = ir.collections.map(buildCustomType);
  const assetById = new Map(ir.assets.map((a) => [a.id, a]));

  /** Drop non-image assets referenced by an Image field, with a diagnostic. */
  const dropNonImages = (rec: Record<string, unknown>, keys: Set<string> | null, where: string) => {
    for (const [key, val] of Object.entries(rec)) {
      if ((keys && !keys.has(key)) || !val || typeof val !== "object" || !("__asset_id" in val))
        continue;
      const asset = assetById.get((val as { __asset_id: string }).__asset_id);
      if (!isImageAsset(asset)) {
        diagnostics.push({
          kind: "non-image-in-image-field",
          where: `${where}.${key}`,
          message: `${asset?.mime || "unknown mime"} asset dropped from image field`,
        });
        delete rec[key];
      }
    }
  };

  const documents: PlanDocument[] = [];
  for (const page of ir.pages) {
    if (isEmptyPage(page)) {
      diagnostics.push({
        kind: "empty-page",
        where: page.uid,
        message: "page has no title and no sections; skipped",
      });
      continue;
    }
    const slices = flattenSections(page.sections)
      .map(sectionToSlice)
      .filter((slice) => {
        for (const rec of [slice.primary, ...slice.items]) {
          dropNonImages(rec, IMAGE_FIELDS, `${page.uid}/${slice.slice_type}`);
        }
        // Structural defaults aren't content — a slice with nothing else to
        // show (e.g. a block whose only content was hidden text, or whose
        // sole video was dropped from an image field) is invisible; skip it.
        const STRUCTURAL = new Set(["columns", "collection_type", "max_items"]);
        const hasContent =
          Object.keys(slice.primary).some((k) => !STRUCTURAL.has(k)) || slice.items.length > 0;
        if (!hasContent) {
          diagnostics.push({
            kind: "empty-slice",
            where: `${page.uid}/${slice.slice_type}`,
            message: "slice has no content after filtering; dropped",
          });
        }
        return hasContent;
      });
    documents.push({
      type: "page",
      uid: page.uid,
      // the page type's title is StructuredText(single heading1)
      data: {
        title: richText(coerceHeadingHtml(page.title || page.uid, ["h1"])),
        slices,
      },
    });
  }
  for (const c of ir.collections) {
    for (const rec of c.records) {
      const data = recordData(rec);
      // record asset markers only ever occupy Image fields — check them all
      dropNonImages(data, null, `${c.apiId}/${rec.uid}`);
      documents.push({ type: c.apiId, uid: rec.uid, data });
    }
  }

  const assets = ir.assets
    .filter((a) => a.sourceUrl !== null)
    .map((a) => ({ id: a.id, url: a.sourceUrl as string, alt: a.alt }));

  return { customTypes, documents, assets, diagnostics };
}
