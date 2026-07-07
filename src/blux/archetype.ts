import { visibleText, type BluxBlock } from "./parse.js";

const nonEmpty = (v: unknown): boolean =>
  v != null &&
  v !== "" &&
  !(Array.isArray(v) && v.length === 0) &&
  !(typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

export type ArchetypeResult = {
  sliceType: "hero" | "media_text" | "rich_text" | "grid" | "slider" | "collection_list";
  variation: string;
  confidence: number;
};

export function archetype(b: BluxBlock): ArchetypeResult {
  const heading = visibleText(b.title, b._title) !== undefined;
  const text = visibleText(b.body, b._body) !== undefined;
  const media = nonEmpty(b.media?.media);
  const bg = nonEmpty(b.backgroundMedia?.media);
  const kids = Array.isArray(b.items) && b.items.length > 0;
  const cls = nonEmpty(b.class) ? String(b.class) : null;

  // Slides keep their grouping even under a background — exploding a
  // carousel into siblings loses more than dropping its backdrop does.
  if (kids && cls === "slides")
    return { sliceType: "slider", variation: "default", confidence: 0.85 };
  // A background image/video makes a hero even with no visible copy — Blux
  // uses text-less full-bleed banners (e.g. a hero video with a disabled label).
  if (bg)
    return { sliceType: "hero", variation: "default", confidence: heading || text ? 0.9 : 0.7 };
  if (kids)
    return { sliceType: "grid", variation: "default", confidence: cls === "grid" ? 0.9 : 0.7 };
  // Any visible copy next to media is a media_text; media alone still is,
  // just with less certainty.
  if (media && heading && text)
    return { sliceType: "media_text", variation: "imageRight", confidence: 0.9 };
  if (media && (heading || text))
    return { sliceType: "media_text", variation: "imageRight", confidence: 0.75 };
  if (media) return { sliceType: "media_text", variation: "imageRight", confidence: 0.6 };
  if (heading && text) return { sliceType: "rich_text", variation: "default", confidence: 0.85 };
  if (heading || text) return { sliceType: "rich_text", variation: "default", confidence: 0.6 };
  return { sliceType: "rich_text", variation: "default", confidence: 0.2 };
}
