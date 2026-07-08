import { describe, expect, it } from "vitest";
import type { Node } from "../../src/blux/grid/types.js";
import {
  collectMedia,
  collectText,
  topRow,
  isEmptyRaw,
} from "../../src/blux/grid/classify-band.js";

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
