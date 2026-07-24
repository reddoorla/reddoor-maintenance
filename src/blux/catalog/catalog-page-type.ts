// The migration-owned `catalog_page` custom type. A migrated Blux site emits
// `catalog_page` documents (see spec.ts CATALOG_PAGE_TYPE), so the migration
// tool must also OWN + push the type definition — a cloned starter repo does
// not ship it (the starter's own `page` type is the /new-site flow's; see the
// starter's src/lib/blux-catalog/page-doc.ts module note). This is the type the
// migrate action pushes via pushCustomTypes, so its `json` is the FULL Prismic
// Custom Types API definition (id/label/format/status + the tabbed model),
// exactly like the entity types buildEntityEmit emits.
import type { PlanCustomType } from "../emit/plan.js";
import { CATALOG_PAGE_TYPE } from "./spec.js";

const CATALOG_PAGE_LABEL = "Catalog Page (Blux migration)";

/** The SharedSlice choices a migrated catalog page can hold — the `blux_*`
 * catalog slices ONLY. The starter's `page` type also lists its native slice
 * choices (lead_text/hero/…), but a migrated page emits nothing but `blux_*`
 * slices (see emit.ts catalogSpecToPlanSlice), so the native choices are
 * dropped: the type models exactly what the migration populates. Mirrors the
 * starter page type's `blux_*` entries (customtypes/page/index.json). */
const BLUX_SLICE_CHOICES = [
  "blux_section",
  "blux_text",
  "blux_block",
  "blux_grid",
  "blux_gallery",
  "blux_carousel",
  "blux_media",
  "blux_media_text",
  "blux_embed",
  "blux_table",
  "blux_collection",
] as const;

function sliceChoices(): Record<string, { type: "SharedSlice" }> {
  return Object.fromEntries(BLUX_SLICE_CHOICES.map((t) => [t, { type: "SharedSlice" }]));
}

/** The `catalog_page` custom type: a `format:"page"` clone of the starter's
 * `page` type (customtypes/page/index.json) — the Main tab (uid + title + the
 * `blux_*` SharedSlices zone) and the "SEO & Metadata" tab
 * (meta_title/meta_description/meta_image). The SEO field types match the
 * starter render's reads (blux-catalog/page-doc.ts pageMeta): meta_title +
 * meta_description are Text (plain string), meta_image is an Image field
 * (`.url`/`.alt`). Shipped on EVERY catalog plan so the migration owns the type
 * it emits documents for. */
export function catalogPageCustomType(): PlanCustomType {
  return {
    id: CATALOG_PAGE_TYPE,
    label: CATALOG_PAGE_LABEL,
    repeatable: true,
    json: {
      id: CATALOG_PAGE_TYPE,
      label: CATALOG_PAGE_LABEL,
      format: "page",
      repeatable: true,
      status: true,
      json: {
        Main: {
          uid: { type: "UID", config: { label: "UID", placeholder: "" } },
          title: {
            type: "StructuredText",
            config: {
              label: "Title",
              placeholder: "",
              allowTargetBlank: true,
              single: "heading1",
            },
          },
          slices: {
            type: "Slices",
            fieldset: "Slice Zone",
            config: { choices: sliceChoices() },
          },
        },
        "SEO & Metadata": {
          meta_title: {
            type: "Text",
            config: {
              label: "Meta Title",
              placeholder: "A title of the page used for social media and search engines",
            },
          },
          meta_description: {
            type: "Text",
            config: {
              label: "Meta Description",
              placeholder: "A brief summary of the page",
            },
          },
          meta_image: {
            type: "Image",
            config: {
              label: "Meta Image",
              constraint: { width: 2400, height: 1260 },
              thumbnails: [],
            },
          },
        },
      },
    },
  };
}
