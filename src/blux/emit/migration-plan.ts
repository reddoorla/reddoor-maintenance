import type { SiteIR, RecordIR, Diagnostic } from "../ir.js";
import { richText, assetRef, type MigrationPlan, type PlanDocument } from "./plan.js";
import { buildCustomType } from "./custom-types.js";
import { sectionToSlice } from "./slices.js";
import { coerceHeadingHtml } from "./coerce-html.js";
import { flattenSections } from "./flatten.js";

/** Slice fields modeled as Prismic Image fields — only image assets may land here. */
const IMAGE_FIELDS = new Set(["background_image", "media", "item_media"]);

const RICHTEXT = new Set(["body", "description"]);

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
      data[key] = richText(value);
    } else {
      data[key] = value;
    }
  }
  return data;
}

export function buildMigrationPlan(ir: SiteIR): MigrationPlan {
  const diagnostics: Diagnostic[] = [];
  const customTypes = ir.collections.map(buildCustomType);
  const mimeById = new Map(ir.assets.map((a) => [a.id, a.mime]));

  const documents: PlanDocument[] = [];
  for (const page of ir.pages) {
    if (!page.sections.length && !page.title.trim()) {
      diagnostics.push({
        kind: "empty-page",
        where: page.uid,
        message: "page has no title and no sections; skipped",
      });
      continue;
    }
    const slices = flattenSections(page.sections).map(sectionToSlice);
    for (const slice of slices) {
      for (const rec of [slice.primary, ...slice.items]) {
        for (const [key, val] of Object.entries(rec)) {
          if (!IMAGE_FIELDS.has(key) || !val || typeof val !== "object" || !("__asset_id" in val))
            continue;
          const mime = mimeById.get((val as { __asset_id: string }).__asset_id) ?? "";
          if (!mime.startsWith("image/")) {
            diagnostics.push({
              kind: "non-image-in-image-field",
              where: `${page.uid}/${slice.slice_type}.${key}`,
              message: `${mime || "unknown mime"} asset dropped from image field`,
            });
            delete rec[key];
          }
        }
      }
    }
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
      documents.push({ type: c.apiId, uid: rec.uid, data: recordData(rec) });
    }
  }

  const assets = ir.assets
    .filter((a) => a.sourceUrl !== null)
    .map((a) => ({ id: a.id, url: a.sourceUrl as string, alt: a.alt }));

  return { customTypes, documents, assets, diagnostics };
}
