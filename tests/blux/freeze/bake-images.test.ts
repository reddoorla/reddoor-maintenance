import { describe, expect, it } from "vitest";
import { bakeImages } from "../../../src/blux/freeze/bake-images.js";

describe("bakeImages", () => {
  it("assembles {base}w:{size}/{media} and inlines a token", () => {
    const { html, slots } = bakeImages(
      `<body><section><div class="camediaload" data-base="https://cdn/f/" data-size="475" data-media="x.png" data-ext="png" style="width:200px"></div></section></body>`,
    );
    expect(slots).toEqual([
      { key: "s0.i0", kind: "image", url: "https://cdn/f/w:475/x.png", section: "s0" },
    ]);
    expect(html).toContain("width:200px;background-image:url(⟦i:s0.i0⟧)");
  });

  it("prefers data-bgmedia (full-bleed) over data-media", () => {
    const { slots } = bakeImages(
      `<body><section><div data-base="https://cdn/f/" data-size="1200" data-media="thumb.png" data-bgmedia="hero.jpg"></div></section></body>`,
    );
    expect(slots[0]!.url).toBe("https://cdn/f/w:1200/hero.jpg");
  });

  it("defaults full-bleed size to 1600 when unsized, and omits w: for sized-less inline", () => {
    const bg = bakeImages(
      `<body><section><div data-base="https://cdn/f/" data-bgmedia="hero.jpg"></div></section></body>`,
    );
    expect(bg.slots[0]!.url).toBe("https://cdn/f/w:1600/hero.jpg");
    const inline = bakeImages(
      `<body><section><div data-base="https://cdn/f/" data-media="a.png"></div></section></body>`,
    );
    expect(inline.slots[0]!.url).toBe("https://cdn/f/a.png");
  });

  it("keys images per section in document order", () => {
    const { slots } = bakeImages(
      `<body><section><div data-base="b/" data-media="a.png"></div><div data-base="b/" data-media="c.png"></div></section><section><div data-base="b/" data-media="d.png"></div></section></body>`,
    );
    expect(slots.map((s) => s.key)).toEqual(["s0.i0", "s0.i1", "s1.i0"]);
  });
});
