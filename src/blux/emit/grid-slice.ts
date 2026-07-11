import type { SliceSpec } from "../grid/index.js";
import { type PlanSlice, richText } from "./plan.js";

/** Strip all tags → the plain text a Prismic "Text" (key-text) field holds. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map one classified band to its page-doc slice. Text + band index only —
 * media, layout, style and map all live in the presentation manifest. */
export function sliceSpecToPlanSlice(spec: SliceSpec): PlanSlice {
  switch (spec.slice) {
    case "Hero":
      return {
        slice_type: "hero",
        variation: "band",
        items: [],
        primary: {
          band: spec.index,
          ...(spec.heading ? { heading: spec.heading } : {}),
          ...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
          ...(spec.body ? { body: stripTags(spec.body) } : {}),
        },
      };
    case "TitleBand":
      return {
        slice_type: "title_band",
        variation: "default",
        items: [],
        primary: {
          band: spec.index,
          heading: spec.heading,
          ...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
        },
      };
    case "RichText":
      return {
        slice_type: "rich_text",
        variation: "default",
        items: [],
        primary: { content: richText(spec.html), band: spec.index },
      };
    case "SplitFeature":
      return {
        slice_type: "split_feature",
        variation: "default",
        items: [],
        primary: { band: spec.index },
      };
    case "Gallery":
      return {
        slice_type: "gallery",
        variation: "default",
        items: [],
        primary: { band: spec.index },
      };
    case "MediaFull":
    case "VideoFeature":
      return {
        slice_type: "media_full",
        variation: "default",
        items: [],
        primary: { band: spec.index },
      };
    case "LocationMap":
      return {
        slice_type: "location_map",
        variation: "default",
        items: [],
        primary: { band: spec.index },
      };
    case "Grid":
      return {
        slice_type: "grid_band",
        variation: "default",
        items: [],
        primary: { band: spec.index },
      };
  }
}
