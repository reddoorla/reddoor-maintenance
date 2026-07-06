import type { SectionIR } from "../ir.js";
import { richText, assetRef, type PlanSlice } from "./plan.js";

function rt(html?: string) {
  return html ? richText(html) : undefined;
}
function img(id?: string) {
  return id ? assetRef(id) : undefined;
}
function compact(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

export function sectionToSlice(s: SectionIR): PlanSlice {
  const f = s.fields;
  switch (s.sliceType) {
    case "hero":
      return {
        slice_type: "hero",
        variation: "default",
        primary: compact({
          heading: rt(f.heading),
          body: rt(f.body),
          background_image: img(f.backgroundMedia ?? f.media),
        }),
        items: [],
      };
    case "media_text":
      return {
        slice_type: "media_text",
        variation: s.variation === "imageLeft" ? "imageLeft" : "imageRight",
        primary: compact({ heading: rt(f.heading), body: rt(f.body), media: img(f.media) }),
        items: [],
      };
    case "collection_list":
      return {
        slice_type: "collection_list",
        variation: s.variation === "list" ? "list" : "grid",
        primary: compact({
          heading: rt(f.heading),
          collection_type: s.collectionRef?.apiId ?? "",
          max_items: 24,
        }),
        items: [],
      };
    case "grid":
    case "slider":
      return {
        slice_type: "section_grid",
        variation: "default",
        primary: compact({ heading: rt(f.heading), columns: f.columns ?? 3 }),
        items: (s.children ?? []).map((c) =>
          compact({
            item_heading: rt(c.fields.heading),
            item_body: rt(c.fields.body),
            item_media: img(c.fields.media),
          }),
        ),
      };
    case "rich_text":
    default:
      return {
        slice_type: "rich_text",
        variation: "default",
        primary: compact({ content: rt(f.heading ? `${f.heading}${f.body ?? ""}` : f.body) }),
        items: [],
      };
  }
}
