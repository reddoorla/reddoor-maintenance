import type { SectionIR } from "../ir.js";

const isContainer = (s: SectionIR) => s.sliceType === "grid" || s.sliceType === "slider";
const isFlatLeaf = (s: SectionIR) =>
  (s.sliceType === "media_text" || s.sliceType === "rich_text") && !(s.children ?? []).length;

/** Depth-first flatten: Prismic slices cannot nest, so a container survives
 *  as a section_grid-with-items only when every child is representable as a
 *  flat item (childless media_text/rich_text). Anything richer — nested
 *  containers, heroes with backgrounds — explodes into sequential sibling
 *  sections; the container's heading becomes a rich_text section so the
 *  visual grouping label survives. Proven need: thePointe's depth-4 tree
 *  kept only 7/53 images under one-level flattening. */
export function flattenSections(sections: SectionIR[]): SectionIR[] {
  const out: SectionIR[] = [];
  for (const s of sections) {
    const children = s.children ?? [];
    if (isContainer(s) && children.length && !children.every(isFlatLeaf)) {
      if (s.fields.heading) {
        out.push({
          sliceType: "rich_text",
          variation: "default",
          confidence: s.confidence,
          fields: { heading: s.fields.heading },
        });
      }
      out.push(...flattenSections(children));
    } else {
      out.push(s);
    }
  }
  return out;
}
