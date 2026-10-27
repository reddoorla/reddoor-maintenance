import { describe, it, expect } from "vitest";
import { rewriteManifestUrls } from "../../../src/blux/emit/rewrite-manifest.js";
import type { Presentation } from "../../../src/blux/emit/presentation.js";

// The rewrite returns the union SitePresentation; a flat input yields a flat
// result — narrow it for the flat-shape assertions.
const flat = (p: ReturnType<typeof rewriteManifestUrls>): Presentation => p as Presentation;

const manifest: Presentation = {
  bands: {
    "0": { background: { kind: "image", url: "https://cdn/f/a.png", alt: "A" } },
    "1": {
      gallery: [
        { kind: "image", url: "https://cdn/f/a.png" },
        { kind: "image", url: "https://cdn/f/b.png" },
      ],
    },
    "2": {
      split: {
        mediaSide: "left",
        ratio: 40,
        media: { kind: "image", url: "https://cdn/f/c.png" },
        text: {
          kind: "row",
          cells: [
            {
              token: { cols: 1 },
              node: { kind: "media", media: { kind: "image", url: "https://cdn/f/b.png" } },
            },
          ],
        },
      },
    },
    "3": {
      tree: { kind: "media", media: { kind: "image", url: "https://cdn/f/a.png" } },
      media: { kind: "video", url: "https://cdn/f/v.mp4" },
    },
    "4": {
      carousel: {
        slides: [
          {
            media: { kind: "image", url: "https://cdn/f/a.png", minHeight: "80vh" },
            caption: { level: 5, role: "text5" },
          },
          { media: { kind: "image", url: "https://cdn/f/d.png" } },
        ],
        columns: 1,
      },
    },
  },
};

describe("rewriteManifestUrls", () => {
  it("swaps every RenderMedia url found in the map, deep, leaving unknowns intact", () => {
    const map = new Map([
      ["https://cdn/f/a.png", "https://images.prismic.io/repo/a"],
      ["https://cdn/f/b.png", "https://images.prismic.io/repo/b"],
      ["https://cdn/f/c.png", "https://images.prismic.io/repo/c"],
    ]);
    const out = flat(rewriteManifestUrls(manifest, map));
    expect(out.bands["0"]!.background!.url).toBe("https://images.prismic.io/repo/a");
    expect(out.bands["1"]!.gallery!.map((m) => m.url)).toEqual([
      "https://images.prismic.io/repo/a",
      "https://images.prismic.io/repo/b",
    ]);
    expect(out.bands["2"]!.split!.media.url).toBe("https://images.prismic.io/repo/c");
    const cell = (out.bands["2"]!.split!.text as { cells: { node: { media: { url: string } } }[] })
      .cells[0]!;
    expect(cell.node.media.url).toBe("https://images.prismic.io/repo/b");
    expect((out.bands["3"]!.tree as { media: { url: string } }).media.url).toBe(
      "https://images.prismic.io/repo/a",
    );
    expect(out.bands["3"]!.media!.url).toBe("https://cdn/f/v.mp4"); // unknown left intact
    const carousel = out.bands["4"]!.carousel!;
    expect(carousel.slides.map((s) => s.media.url)).toEqual([
      "https://images.prismic.io/repo/a",
      "https://cdn/f/d.png", // unknown left intact
    ]);
    // non-url slide fields survive the rewrite untouched
    expect(carousel.slides[0]!.media.minHeight).toBe("80vh");
    expect(carousel.slides[0]!.caption).toEqual({ level: 5, role: "text5" });
    expect(carousel.columns).toBe(1);
    expect(manifest.bands["0"]!.background!.url).toBe("https://cdn/f/a.png"); // input not mutated
    expect(manifest.bands["4"]!.carousel!.slides[0]!.media.url).toBe("https://cdn/f/a.png");
  });

  it("rewrites a MULTI-PAGE manifest per page (the shape `blux convert` writes)", () => {
    // convert emits { pages: { <uid>: { bands } } }; migrate MUST rewrite every
    // page's urls, not silently no-op (the flat-only rewrite threw on
    // manifest.bands === undefined and the catch swallowed it).
    const multi = {
      pages: {
        home: {
          bands: { "0": { background: { kind: "image" as const, url: "https://cdn/f/a.png" } } },
        },
        about: {
          bands: { "0": { media: { kind: "image" as const, url: "https://cdn/f/b.png" } } },
        },
      },
    };
    const map = new Map([
      ["https://cdn/f/a.png", "https://images.prismic.io/repo/a"],
      ["https://cdn/f/b.png", "https://images.prismic.io/repo/b"],
    ]);
    const out = rewriteManifestUrls(multi, map);
    if (!("pages" in out)) throw new Error("expected a multi-page result");
    expect(out.pages["home"]!.bands["0"]!.background!.url).toBe("https://images.prismic.io/repo/a");
    expect(out.pages["about"]!.bands["0"]!.media!.url).toBe("https://images.prismic.io/repo/b");
    // input not mutated
    expect(multi.pages["home"].bands["0"].background.url).toBe("https://cdn/f/a.png");
  });
});
