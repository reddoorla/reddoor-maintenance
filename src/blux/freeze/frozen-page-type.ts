// The migration-owned `frozen_page` custom type. A frozen Blux site keeps the
// export's own markup as a byte-faithful template (a repo file) and exposes only
// the editable leaves — text runs and image urls — as Prismic `slots`. `blux
// migrate-frozen` POSTs one `frozen_page` document per page, so the migration
// tool must OWN + push the type definition (a cloned starter repo does not ship
// it — mirrors catalog-page-type.ts). Its `json` is the FULL Prismic Custom
// Types API definition (id/label/format/status + the tabbed model), so
// pushCustomTypes can ship it verbatim.
import type { PlanCustomType } from "../emit/plan.js";

export const FROZEN_PAGE_TYPE = "frozen_page";
const FROZEN_PAGE_LABEL = "Frozen Page (Blux migration)";

/** The `frozen_page` custom type: a `format:"page"` doc holding the editable
 * slots of a frozen Blux page. The Main tab carries uid + title (a plain Text
 * field — the frozen render substitutes it back into the template's <title>)
 * plus the repeatable `slots` group; the "SEO & Metadata" tab mirrors the
 * catalog type's meta fields. Each `slots` row is one editable leaf: `key` (the
 * stable document-order slot key the template token carries), `kind` (a Select
 * pinning text|image so the render knows which field to read), `text` (Rich
 * Text — filled for text slots), `image` (Image — filled for image slots).
 * Shipped on EVERY frozen migrate so the migration owns the type it emits. */
export function frozenPageCustomType(): PlanCustomType {
  return {
    id: FROZEN_PAGE_TYPE,
    label: FROZEN_PAGE_LABEL,
    repeatable: true,
    json: {
      id: FROZEN_PAGE_TYPE,
      label: FROZEN_PAGE_LABEL,
      format: "page",
      repeatable: true,
      status: true,
      json: {
        Main: {
          uid: { type: "UID", config: { label: "UID", placeholder: "" } },
          title: {
            type: "Text",
            config: { label: "Title", placeholder: "" },
          },
          slots: {
            type: "Group",
            config: {
              label: "Slots",
              fields: {
                key: { type: "Text", config: { label: "Key", placeholder: "" } },
                kind: {
                  type: "Select",
                  config: {
                    label: "Kind",
                    placeholder: "",
                    options: ["text", "image"],
                  },
                },
                text: {
                  type: "StructuredText",
                  config: {
                    label: "Text",
                    placeholder: "",
                    allowTargetBlank: true,
                    multi:
                      "paragraph,preformatted,heading1,heading2,heading3,heading4,heading5,heading6,strong,em,hyperlink,image,embed,list-item,o-list-item,rtl",
                  },
                },
                image: {
                  type: "Image",
                  config: { label: "Image", constraint: {}, thumbnails: [] },
                },
              },
            },
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
