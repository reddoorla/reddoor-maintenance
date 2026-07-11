import { describe, it, expect } from "vitest";
import { rewriteManifestUrls } from "../../../src/blux/emit/rewrite-manifest.js";
import type { Presentation } from "../../../src/blux/emit/presentation.js";

const manifest: Presentation = {
  bands: {
    "0": { background: { kind: "image", url: "https://cdn/f/a.png", alt: "A" } },
    "1": { gallery: [{ kind: "image", url: "https://cdn/f/a.png" }, { kind: "image", url: "https://cdn/f/b.png" }] },
    "2": { split: { mediaSide: "left", ratio: 40, media: { kind: "image", url: "https://cdn/f/c.png" }, text: { kind: "row", cells: [{ token: { cols: 1 }, node: { kind: "media", media: { kind: "image", url: "https://cdn/f/b.png" } } }] } } },
    "3": { tree: { kind: "media", media: { kind: "image", url: "https://cdn/f/a.png" } }, media: { kind: "video", url: "https://cdn/f/v.mp4" } },
  },
};

describe("rewriteManifestUrls", () => {
  it("swaps every RenderMedia url found in the map, deep, leaving unknowns intact", () => {
    const map = new Map([
      ["https://cdn/f/a.png", "https://images.prismic.io/repo/a"],
      ["https://cdn/f/b.png", "https://images.prismic.io/repo/b"],
      ["https://cdn/f/c.png", "https://images.prismic.io/repo/c"],
    ]);
    const out = rewriteManifestUrls(manifest, map);
    expect(out.bands["0"]!.background!.url).toBe("https://images.prismic.io/repo/a");
    expect(out.bands["1"]!.gallery!.map((m) => m.url)).toEqual(["https://images.prismic.io/repo/a", "https://images.prismic.io/repo/b"]);
    expect(out.bands["2"]!.split!.media.url).toBe("https://images.prismic.io/repo/c");
    const cell = (out.bands["2"]!.split!.text as { cells: { node: { media: { url: string } } }[] }).cells[0]!;
    expect(cell.node.media.url).toBe("https://images.prismic.io/repo/b");
    expect((out.bands["3"]!.tree as { media: { url: string } }).media.url).toBe("https://images.prismic.io/repo/a");
    expect(out.bands["3"]!.media!.url).toBe("https://cdn/f/v.mp4"); // unknown left intact
    expect(manifest.bands["0"]!.background!.url).toBe("https://cdn/f/a.png"); // input not mutated
  });
});
