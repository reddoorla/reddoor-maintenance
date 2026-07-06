import type { BluxBlock } from "./parse.js";

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
  const heading = nonEmpty(b.title) || nonEmpty(b._title);
  const text = nonEmpty(b.body) || nonEmpty(b._body);
  const media = nonEmpty(b.media?.media);
  const bg = nonEmpty(b.backgroundMedia?.media);
  const kids = Array.isArray(b.items) && b.items.length > 0;
  const cls = nonEmpty(b.class) ? String(b.class) : null;

  if (bg && (heading || text)) return { sliceType: "hero", variation: "default", confidence: 0.9 };
  if (kids && cls === "slides")
    return { sliceType: "slider", variation: "default", confidence: 0.85 };
  if (kids)
    return { sliceType: "grid", variation: "default", confidence: cls === "grid" ? 0.9 : 0.7 };
  if (heading && text && media)
    return { sliceType: "media_text", variation: "imageRight", confidence: 0.9 };
  if (heading && text) return { sliceType: "rich_text", variation: "default", confidence: 0.85 };
  if (media && !heading && !text)
    return { sliceType: "media_text", variation: "imageRight", confidence: 0.6 };
  if (text) return { sliceType: "rich_text", variation: "default", confidence: 0.6 };
  return { sliceType: "rich_text", variation: "default", confidence: 0.2 };
}
