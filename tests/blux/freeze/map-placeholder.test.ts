import { describe, it, expect } from "vitest";
import { mapPlaceholder } from "../../../src/blux/freeze/map-placeholder.js";

// The KML url as it appears in the Blux export (custom Google My Maps).
const EXPORT = `<a href="https://www.google.com/maps/d/u/0/kml?forcekmz=1&mid=1KwcmcAbc-9&other=x">map</a>`;

describe("mapPlaceholder", () => {
  it("turns a rendered map container into a clean placeholder with the KML mid", () => {
    const settled = `<div id="burbank_map" style="height:600px"><div class="gm-style"><img src="https://maps.googleapis.com/vt?x=1"></div></div>`;
    const out = mapPlaceholder(settled, EXPORT);
    expect(out).toContain('class="blux-frozen-map"');
    expect(out).toContain('data-kml-mid="1KwcmcAbc-9"');
    expect(out).toContain("height:600px"); // band box preserved
    expect(out).not.toContain("gm-style"); // dead DOM gone
    expect(out).not.toContain("maps.googleapis.com");
  });

  it("only converts a map container that actually rendered (has a .gm-style descendant)", () => {
    const settled = `<div id="sitemap"><a href="/s">links</a></div>`;
    const out = mapPlaceholder(settled, EXPORT);
    expect(out).toContain('<a href="/s">links</a>');
    expect(out).not.toContain("blux-frozen-map");
  });

  it("emits the placeholder with no data-kml-mid when the export has no mid", () => {
    const settled = `<div id="burbank_map" style="height:600px"><div class="gm-style">x</div></div>`;
    const out = mapPlaceholder(settled, "<html></html>");
    expect(out).toContain('class="blux-frozen-map"');
    expect(out).not.toContain("data-kml-mid");
  });
});
