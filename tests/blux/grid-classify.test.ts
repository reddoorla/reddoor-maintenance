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
