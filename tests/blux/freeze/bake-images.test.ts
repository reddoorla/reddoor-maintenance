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

  it("uses data-media as the filename; data-bgmedia is a flag, not a filename", () => {
    // data-bgmedia="1" marks a full-bleed layer — the file is still data-media.
    const { slots } = bakeImages(
      `<body><section><div data-base="https://cdn/f/" data-size="1920" data-media="hero.jpg" data-bgmedia="1"></div></section></body>`,
    );
    expect(slots[0]!.url).toBe("https://cdn/f/w:1920/hero.jpg");
  });

  it("defaults full-bleed size to 1600 when unsized, and omits w: for sized-less inline", () => {
    const bg = bakeImages(
      `<body><section><div data-base="https://cdn/f/" data-media="hero.jpg" data-bgmedia="1"></div></section></body>`,
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

describe("bakeImages painted boxes", () => {
  const media = (attrs: string) =>
    `<body><section><div data-base="https://cdn/f/" data-media="x.png" ${attrs}></div></section></body>`;

  it("records the box settle measured, keyed by slot", () => {
    // The render can only ask a CDN for the right size if it knows that size,
    // and the size is not derivable from the markup — Blux sets it in CSS, so
    // an element carrying width:5774px can render into an 823px box.
    const { boxes } = bakeImages(media(`data-size="5774" data-rd-box="823x548"`));
    expect(boxes).toEqual({ "s0.i0": { w: 823, h: 548, source: 5774 } });
  });

  it("keeps data-size as the ceiling, because CDNs upscale past it", () => {
    // Asking a 123px badge for 900px took it from 4.9KB to 30KB, so the widest
    // render that EXISTS has to travel with the box.
    const { boxes } = bakeImages(media(`data-size="123" data-rd-box="73x73"`));
    expect(boxes["s0.i0"]!.source).toBe(123);
  });

  it("records a null source when the export declared no size", () => {
    const { boxes } = bakeImages(media(`data-rd-box="400x300"`));
    expect(boxes["s0.i0"]).toEqual({ w: 400, h: 300, source: null });
  });

  it("leaves the template byte-identical to an unmeasured freeze", () => {
    // The attribute is settle's channel into this function and nothing else;
    // shipping it in the template would change the committed artifact for
    // every existing frozen site.
    const withBox = bakeImages(media(`data-size="475" data-rd-box="200x120"`));
    const without = bakeImages(media(`data-size="475"`));
    expect(withBox.html).toBe(without.html);
    expect(withBox.html).not.toContain("data-rd-box");
  });

  it("strips the attribute from elements that never became a slot", () => {
    const { html } = bakeImages(`<body><section><div data-rd-box="10x10"></div></section></body>`);
    expect(html).not.toContain("data-rd-box");
  });

  it("records nothing when settle could not measure the element", () => {
    // An element that never paints has no box worth recording; the render then
    // leaves its url alone rather than guessing.
    const { boxes } = bakeImages(media(`data-size="475"`));
    expect(boxes).toEqual({});
  });

  it("ignores a malformed measurement rather than recording NaN", () => {
    const { boxes } = bakeImages(media(`data-size="475" data-rd-box="wide"`));
    expect(boxes).toEqual({});
  });
});
