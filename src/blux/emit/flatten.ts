import type { SectionIR } from "../ir.js";

const isContainer = (s: SectionIR) => s.sliceType === "grid" || s.sliceType === "slider";
const isFlatLeaf = (s: SectionIR) =>
  (s.sliceType === "media_text" || s.sliceType === "rich_text") && !(s.children ?? []).length;

/** Depth-first flatten: Prismic slices cannot nest, so a container survives
 *  as a section_grid-with-items only when every child is representable as a
 *  flat item (childless media_text/rich_text). Anything richer — nested
 *  containers, heroes with backgrounds — explodes into sequential sibling
 *  sections, and the container's OWN content (heading/body/media) survives
 *  as a leading media_text or rich_text section. Proven need: thePointe's
 *  depth-4 tree kept only 7/53 images under one-level flattening. */
export function flattenSections(sections: SectionIR[]): SectionIR[] {
  const out: SectionIR[] = [];
  for (const s of sections) {
    const children = s.children ?? [];

    if (s.sliceType === "hero" && s.fields.media && s.fields.backgroundMedia) {
      // the hero slice only models the background image — surface the
      // foreground image (a logo/overlay in Blux) as a sibling media_text
      const { media, ...heroFields } = s.fields;
      const { children: _heroKids, ...heroSelf } = s;
      out.push({ ...heroSelf, fields: heroFields });
      out.push({
        sliceType: "media_text",
        variation: "imageRight",
        confidence: s.confidence,
        fields: { media },
      });
      out.push(...flattenSections(children));
      continue;
    }

    if (!children.length || (isContainer(s) && children.every(isFlatLeaf))) {
      out.push(s);
    } else if (isContainer(s)) {
      // the container's own content leads its exploded children: with media
      // it is a media_text-shaped section that merely carries a subtree,
      // otherwise its heading/body become a rich_text grouping label
      const { children: _kids, ...self } = s;
      if (self.fields.media) {
        out.push({ ...self, sliceType: "media_text" });
      } else if (self.fields.heading || self.fields.body) {
        out.push({ ...self, sliceType: "rich_text" });
      }
      out.push(...flattenSections(children));
    } else {
      // normalize attaches `children` to ANY block with items — a hero or
      // media_text can carry a subtree. Its own slice mapping ignores
      // children, so hoist them as following siblings instead of losing them.
      const { children: _hoisted, ...self } = s;
      out.push(self);
      out.push(...flattenSections(children));
    }
  }
  return out;
}
