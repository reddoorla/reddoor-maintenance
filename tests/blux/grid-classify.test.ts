import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Node } from "../../src/blux/grid/types.js";
import {
  collectMedia,
  collectText,
  topRow,
  isEmptyRaw,
} from "../../src/blux/grid/classify-band.js";
import { parseGridBands } from "../../src/blux/grid/index.js";
import { classifyBand, classifyBands } from "../../src/blux/grid/classify-band.js";
import type { Band } from "../../src/blux/grid/types.js";

const media = (kind: "image" | "video"): Node => ({ kind: "media", media: { kind, assetId: "a" } });
const heading = (level: number): Node => ({ kind: "heading", level, html: "H" });
const body = (): Node => ({ kind: "body", html: "<p>b</p>" });

describe("node-inspection helpers", () => {
  it("collectMedia gathers media across rows and stacks", () => {
    const tree: Node = {
      kind: "stack",
      children: [
        media("image"),
        { kind: "row", cells: [{ token: { cols: 1, raw: "grid-1" }, node: media("video") }] },
      ],
    };
    expect(collectMedia(tree).map((m) => m.kind)).toEqual(["image", "video"]);
  });

  it("collectText gathers heading/body/subtitle nodes", () => {
    const tree: Node = { kind: "stack", children: [heading(2), body()] };
    expect(collectText(tree).map((n) => n.kind)).toEqual(["heading", "body"]);
  });

  it("topRow returns cells when the root is a row, else null", () => {
    const row: Node = {
      kind: "row",
      cells: [{ token: { cols: 2, raw: "grid-2" }, node: media("image") }],
    };
    expect(topRow(row)?.length).toBe(1);
    expect(topRow(heading(1))).toBeNull();
  });

  it("isEmptyRaw is true only for a raw node with no text/element content", () => {
    expect(isEmptyRaw({ kind: "raw", html: '<div class="block-content"></div>' })).toBe(true);
    expect(isEmptyRaw({ kind: "raw", html: "<p>hi</p>" })).toBe(false);
    expect(isEmptyRaw(heading(1))).toBe(false);
  });
});

const FIXTURE = fileURLToPath(new URL("./fixtures/the-pointe-page-content.html", import.meta.url));
const realBands = (): Band[] => parseGridBands(readFileSync(FIXTURE, "utf-8"));
const band = (bands: Band[], index: number): Band => {
  const b = bands.find((x) => x.index === index);
  if (!b) throw new Error(`no band ${index}`);
  return b;
};

describe("classifyBand — fallback + wiring", () => {
  it("carries index and background onto every spec", () => {
    const spec = classifyBand(band(realBands(), 4)); // tall bg-only raw → Grid
    expect(spec.slice).toBe("Grid");
    expect(spec.index).toBe(4);
    expect(spec.background?.kind).toBe("image");
  });

  it("classifyBands preserves order and length", () => {
    const bands = realBands();
    const specs = classifyBands(bands);
    expect(specs).toHaveLength(bands.length);
    expect(specs.map((s) => s.index)).toEqual(bands.map((b) => b.index));
  });

  it("a deeply nested band falls back to Grid carrying its root tree", () => {
    const spec = classifyBand(band(realBands(), 3));
    expect(spec.slice).toBe("Grid");
    if (spec.slice === "Grid") expect(spec.root.kind).toBe("row");
  });
});

describe("classifyBand — text-only", () => {
  it("heading + subtitle with no media/bg → TitleBand", () => {
    const spec = classifyBand(band(realBands(), 2)); // stack[h2,subtitle]
    expect(spec.slice).toBe("TitleBand");
    if (spec.slice === "TitleBand") {
      expect(spec.heading.length).toBeGreaterThan(0);
      expect(spec.subtitle).toBeDefined();
    }
  });

  it("a bare heading → TitleBand", () => {
    const spec = classifyBand(band(realBands(), 15)); // h2
    expect(spec.slice).toBe("TitleBand");
  });

  it("only body text → RichText", () => {
    const only: Band = { index: 99, root: { kind: "body", html: "<p>hello</p>" } };
    const spec = classifyBand(only);
    expect(spec.slice).toBe("RichText");
    if (spec.slice === "RichText") expect(spec.html).toContain("hello");
  });
});

describe("classifyBand — Hero", () => {
  it("background + overlay heading, no foreground media → Hero", () => {
    const spec = classifyBand(band(realBands(), 7)); // (bg) stack[h2,subtitle]
    expect(spec.slice).toBe("Hero");
    if (spec.slice === "Hero") {
      expect(spec.background?.kind).toBe("image");
      expect(spec.heading).toBeDefined();
      expect(spec.subtitle).toBeDefined();
    }
  });

  it("background but no heading (bg-only) stays Grid", () => {
    const spec = classifyBand(band(realBands(), 4)); // (bg) raw
    expect(spec.slice).toBe("Grid");
  });
});

describe("classifyBand — media", () => {
  it("a row of media cells → Gallery", () => {
    const spec = classifyBand(band(realBands(), 8)); // row[grid-1:media ×3]
    expect(spec.slice).toBe("Gallery");
    if (spec.slice === "Gallery") expect(spec.media).toHaveLength(3);
  });

  it("a single lone media → MediaFull", () => {
    const only: Band = {
      index: 98,
      root: { kind: "media", media: { kind: "image", assetId: "x" } },
    };
    const spec = classifyBand(only);
    expect(spec.slice).toBe("MediaFull");
    if (spec.slice === "MediaFull") expect(spec.media.assetId).toBe("x");
  });
});

describe("classifyBand — SplitFeature", () => {
  it("2-cell row [text-stack | media] → SplitFeature, mediaSide=right", () => {
    const spec = classifyBand(band(realBands(), 1)); // r60 text+media stack | r40 media
    expect(spec.slice).toBe("SplitFeature");
    if (spec.slice === "SplitFeature") {
      expect(spec.mediaSide).toBe("right");
      expect(spec.ratio).toBe(40); // the media cell is grid-2-r40
      expect(spec.media.kind).toBe("image");
      expect(spec.text.kind).toBe("stack");
    }
  });

  it("synthetic [media | text] → mediaSide=left", () => {
    const b: Band = {
      index: 97,
      root: {
        kind: "row",
        cells: [
          {
            token: { cols: 2, ratio: 60, raw: "grid-2-r60" },
            node: { kind: "media", media: { kind: "image", assetId: "m" } },
          },
          {
            token: { cols: 2, ratio: 40, raw: "grid-2-r40" },
            node: { kind: "body", html: "<p>t</p>" },
          },
        ],
      },
    };
    const spec = classifyBand(b);
    expect(spec.slice).toBe("SplitFeature");
    if (spec.slice === "SplitFeature") {
      expect(spec.mediaSide).toBe("left");
      expect(spec.ratio).toBe(60);
    }
  });

  it("an s-token media cell (grid-any-s20) yields its sized share as the ratio", () => {
    const b: Band = {
      index: 94,
      root: {
        kind: "row",
        cells: [
          {
            token: { cols: "any", sized: 20, raw: "grid-any-s20" },
            node: { kind: "media", media: { kind: "image", assetId: "m" } },
          },
          { token: { cols: "any", raw: "grid-any" }, node: { kind: "body", html: "<p>t</p>" } },
        ],
      },
    };
    const spec = classifyBand(b);
    expect(spec.slice).toBe("SplitFeature");
    if (spec.slice === "SplitFeature") {
      expect(spec.mediaSide).toBe("left");
      expect(spec.ratio).toBe(20);
    }
  });

  it("near-miss: 2-cell row [pure media | empty raw] (no text) stays Grid", () => {
    const b: Band = {
      index: 93,
      root: {
        kind: "row",
        cells: [
          {
            token: { cols: 2, raw: "grid-2" },
            node: { kind: "media", media: { kind: "image", assetId: "m" } },
          },
          {
            token: { cols: 2, raw: "grid-2" },
            node: { kind: "raw", html: '<div class="block-content"></div>' },
          },
        ],
      },
    };
    expect(classifyBand(b).slice).toBe("Grid");
  });
});
