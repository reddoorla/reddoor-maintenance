import type { SectionIR } from "../ir.js";
import { richText, assetRef, type PlanSlice } from "./plan.js";
import { coerceHeadingHtml, demoteHeadingsHtml } from "./coerce-html.js";

/** Allowed heading tags per slice heading slot — MUST mirror the
 *  StructuredText configs in reddoor-starter/src/lib/slices/<Slice>/model.json. */
const HEADING_TAGS = {
  hero: ["h1", "h2"],
  media_text: ["h2", "h3"],
  section_grid: ["h2", "h3"],
  section_grid_item: ["h3", "h4"],
} satisfies Record<string, string[]>;

function rt(html?: string) {
  return html ? richText(html) : undefined;
}
function rtHeading(html: string | undefined, slot: keyof typeof HEADING_TAGS) {
  return html ? richText(coerceHeadingHtml(html, HEADING_TAGS[slot])) : undefined;
}
function rtBody(html?: string) {
  return html ? richText(demoteHeadingsHtml(html)) : undefined;
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
          heading: rtHeading(f.heading, "hero"),
          body: rtBody(f.body),
          background_image: img(f.backgroundMedia ?? f.media),
        }),
        items: [],
      };
    case "media_text":
      return {
        slice_type: "media_text",
        variation: s.variation === "imageLeft" ? "imageLeft" : "imageRight",
        primary: compact({
          heading: rtHeading(f.heading, "media_text"),
          body: rtBody(f.body),
          media: img(f.media),
        }),
        items: [],
      };
    case "collection_list":
      return {
        slice_type: "collection_list",
        variation: s.variation === "list" ? "list" : "grid",
        primary: compact({
          heading: rtHeading(f.heading, "section_grid"),
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
        primary: compact({
          heading: rtHeading(f.heading, "section_grid"),
          columns: f.columns ?? 3,
        }),
        items: (s.children ?? [])
          .map((c) =>
            compact({
              item_heading: rtHeading(c.fields.heading, "section_grid_item"),
              item_body: rtBody(c.fields.body),
              item_media: img(c.fields.media),
            }),
          )
          // a child whose only content was hidden text has nothing to show
          .filter((item) => Object.keys(item).length > 0),
      };
    case "rich_text":
    default:
      // rich_text content allows every block type — no coercion needed
      return {
        slice_type: "rich_text",
        variation: "default",
        primary: compact({ content: rt(f.heading ? `${f.heading}${f.body ?? ""}` : f.body) }),
        items: [],
      };
  }
}
