import { describe, it, expect } from "vitest";
import { bandToCatalog } from "../../../src/blux/catalog/classify.js";
import type { Band } from "../../../src/blux/grid/types.js";

describe("bandToCatalog band-visual capture", () => {
  it("captures band-level min-height/padding/max-width/alignment + heading role from the threaded styles + class defaults", () => {
    const band = {
      index: 0,
      blockClass: "blocks0",
      root: {
        kind: "stack",
        children: [{ kind: "heading", level: 2, html: "The Space", role: "text2" }],
      },
    } as unknown as Band;

    const spec = bandToCatalog(band, {
      // per-band inline styles (blockStylesByIndex → Map by band index)
      styles: new Map([
        [
          0,
          {
            "min-height": "100vh",
            "text-align": "center",
            "background-color": "#053a6c",
          },
        ],
      ]),
      // class defaults (blockClassDefaults → Map by wrapper class); the band's
      // blockClass "blocks0" resolves padding/mobilePadding/maxWidth.
      defaults: new Map([
        ["blocks0", { padding: "100px 4%", mobilePadding: "40px 4%", maxWidth: "1280px" }],
      ]),
    });

    expect(spec).toMatchObject({
      minHeight: "100vh",
      textAlign: "center",
      backgroundColor: "#053a6c",
      contentPadding: "100px 4%",
      contentPaddingMobile: "40px 4%",
      maxContentWidth: "1280px",
      headingRole: "text2",
    });
  });

  it("omits band-visual fields when no styles/defaults are threaded (graceful degradation)", () => {
    const band = {
      index: 0,
      root: {
        kind: "stack",
        children: [{ kind: "heading", level: 2, html: "Bare", role: "text2" }],
      },
    } as unknown as Band;
    const spec = bandToCatalog(band) as Record<string, unknown>;
    expect(spec.contentPadding).toBeUndefined();
    expect(spec.maxContentWidth).toBeUndefined();
    expect(spec.backgroundColor).toBeUndefined();
  });
});
