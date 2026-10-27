import { describe, it, expect } from "vitest";
import { parseGridBands } from "../../src/blux/grid/index.js";

describe("parseGridBands", () => {
  it("splits #page-content into indexed bands and reads band backgrounds", () => {
    const html = `<html><body><div id="page-content">
      <div class="blocks2 camediaload" id="page-block-0" data-media="bg0" data-ext="jpg">
        <div class="block-holder"><div class="block-content valignmiddleitem">
          <div class="block-subtitle text13">Eyebrow</div>
        </div></div>
      </div>
      <section class="blocks0" id="page-block-1">
        <div class="block-content"><h2 class="block-title text5">Title</h2></div>
      </section>
    </div></body></html>`;
    const bands = parseGridBands(html);
    expect(bands).toHaveLength(2);
    expect(bands[0]).toEqual({
      index: 0,
      blockClass: "blocks2",
      background: { kind: "image", assetId: "bg0", ext: "jpg" },
      root: { kind: "subtitle", role: "text13", text: "Eyebrow" },
    });
    expect(bands[1]).toEqual({
      index: 1,
      blockClass: "blocks0",
      root: { kind: "heading", role: "text5", level: 2, html: "Title" },
    });
  });

  it("returns an empty array when there is no #page-content", () => {
    expect(parseGridBands("<html><body><p>x</p></body></html>")).toEqual([]);
  });
});
