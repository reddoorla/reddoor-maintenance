import { describe, it, expect } from "vitest";
import { flattenSections } from "../../../src/blux/emit/flatten.js";
import type { SectionIR } from "../../../src/blux/ir.js";

const leaf = (over: Partial<SectionIR> = {}): SectionIR => ({
  sliceType: "media_text",
  variation: "imageRight",
  confidence: 1,
  fields: { body: "<p>x</p>" },
  ...over,
});

describe("flattenSections", () => {
  it("keeps a pure-leaf grid intact", () => {
    const grid: SectionIR = {
      sliceType: "grid",
      variation: "default",
      confidence: 1,
      fields: {},
      children: [leaf(), leaf()],
    };
    expect(flattenSections([grid])).toEqual([grid]);
  });

  it("explodes a grid containing a nested container, hoisting grandchildren", () => {
    const inner: SectionIR = {
      sliceType: "grid",
      variation: "default",
      confidence: 1,
      fields: {},
      children: [leaf(), leaf()],
    };
    const outer: SectionIR = {
      sliceType: "grid",
      variation: "default",
      confidence: 1,
      fields: { heading: "<h2>Section</h2>" },
      children: [leaf(), inner],
    };
    const out = flattenSections([outer]);
    expect(out.map((s) => s.sliceType)).toEqual(["rich_text", "media_text", "grid"]);
    expect(out[0]!.fields.heading).toBe("<h2>Section</h2>");
    expect(out[2]!.children).toHaveLength(2);
  });

  it("hoists children of non-container sections so their subtrees survive", () => {
    const heroWithKids: SectionIR = {
      sliceType: "hero",
      variation: "default",
      confidence: 1,
      fields: { backgroundMedia: "img-1" },
      children: [leaf({ fields: { body: "<p>x</p>", media: "img-9" } })],
    };
    const out = flattenSections([heroWithKids]);
    expect(out.map((s) => s.sliceType)).toEqual(["hero", "media_text"]);
    expect(out[0]!.children).toBeUndefined();
    expect(out[1]!.fields.media).toBe("img-9");
  });

  it("keeps an exploded container's own media/body as a leading media_text", () => {
    const container: SectionIR = {
      sliceType: "grid",
      variation: "default",
      confidence: 1,
      fields: { heading: "<h2>Story</h2>", body: "<p>Copy.</p>", media: "img-7" },
      children: [
        {
          sliceType: "grid",
          variation: "default",
          confidence: 1,
          fields: {},
          children: [leaf()],
        },
      ],
    };
    const out = flattenSections([container]);
    expect(out[0]!.sliceType).toBe("media_text");
    expect(out[0]!.fields).toEqual({
      heading: "<h2>Story</h2>",
      body: "<p>Copy.</p>",
      media: "img-7",
    });
  });

  it("surfaces a hero's foreground image as a sibling when it also has a background", () => {
    const hero: SectionIR = {
      sliceType: "hero",
      variation: "default",
      confidence: 1,
      fields: { heading: "<h1>Hi</h1>", media: "logo-1", backgroundMedia: "bg-1" },
    };
    const out = flattenSections([hero]);
    expect(out.map((s) => s.sliceType)).toEqual(["hero", "media_text"]);
    expect(out[0]!.fields.media).toBeUndefined();
    expect(out[0]!.fields.backgroundMedia).toBe("bg-1");
    expect(out[1]!.fields.media).toBe("logo-1");
  });

  it("explodes a grid containing a hero so the hero keeps its background", () => {
    const hero = leaf({ sliceType: "hero", fields: { backgroundMedia: "img-1" } });
    const grid: SectionIR = {
      sliceType: "grid",
      variation: "default",
      confidence: 1,
      fields: {},
      children: [hero, leaf()],
    };
    expect(flattenSections([grid]).map((s) => s.sliceType)).toEqual(["hero", "media_text"]);
  });
});
