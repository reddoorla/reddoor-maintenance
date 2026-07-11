import { describe, it, expect } from "vitest";
import { sliceSpecToPlanSlice } from "../../../src/blux/emit/grid-slice.js";
import type { SliceSpec } from "../../../src/blux/grid/index.js";

const base = { index: 3 };

describe("sliceSpecToPlanSlice", () => {
  it("maps Hero to hero/band with Text heading+subtitle+body (tags stripped)", () => {
    const spec: SliceSpec = { ...base, slice: "Hero", heading: "THE OUTDOORS", subtitle: "eyebrow", body: "<p>Green <em>space</em>.</p>" };
    expect(sliceSpecToPlanSlice(spec)).toEqual({
      slice_type: "hero", variation: "band", items: [],
      primary: { band: 3, heading: "THE OUTDOORS", subtitle: "eyebrow", body: "Green space." },
    });
  });

  it("maps TitleBand to title_band/default", () => {
    const spec: SliceSpec = { ...base, slice: "TitleBand", heading: "THE SPACE" };
    expect(sliceSpecToPlanSlice(spec)).toEqual({
      slice_type: "title_band", variation: "default", items: [], primary: { band: 3, heading: "THE SPACE" },
    });
  });

  it("maps RichText to rich_text/default with a richtext marker", () => {
    const spec: SliceSpec = { ...base, slice: "RichText", html: "<p>Body copy.</p>" };
    expect(sliceSpecToPlanSlice(spec)).toEqual({
      slice_type: "rich_text", variation: "default", items: [],
      primary: { content: { __richtext_html: "<p>Body copy.</p>" }, band: 3 },
    });
  });

  it("maps VideoFeature onto media_full (band only)", () => {
    const spec: SliceSpec = { ...base, slice: "VideoFeature", media: { kind: "video", assetId: "u" } };
    expect(sliceSpecToPlanSlice(spec)).toEqual({ slice_type: "media_full", variation: "default", items: [], primary: { band: 3 } });
  });

  it.each([
    ["SplitFeature", "split_feature"], ["Gallery", "gallery"], ["MediaFull", "media_full"],
    ["LocationMap", "location_map"], ["Grid", "grid_band"],
  ] as const)("maps %s to %s/default with band only", (slice, slice_type) => {
    const spec = { ...base, slice, ratio: 40, mediaSide: "right", media: { kind: "image", assetId: "u" }, text: { kind: "body", html: "x" }, root: { kind: "row", cells: [] } } as unknown as SliceSpec;
    const out = sliceSpecToPlanSlice({ ...spec, slice } as SliceSpec);
    expect(out.slice_type).toBe(slice_type);
    expect(out.variation).toBe("default");
    expect(out.primary).toEqual({ band: 3 });
    expect(out.items).toEqual([]);
  });
});
