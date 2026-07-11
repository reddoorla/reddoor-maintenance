import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseGridBands,
  classifyBands,
  extractMapConfig,
  makeIsMapMount,
} from "../../src/blux/grid/index.js";
import {
  buildPresentation,
  type PresentationDeps,
  type RenderMedia,
} from "../../src/blux/emit/presentation.js";
import { sliceSpecToPlanSlice } from "../../src/blux/emit/grid-slice.js";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf-8");

// Deterministic offline resolver: assetId → stable fake URL (no site.json needed).
const deps: PresentationDeps = {
  resolveMedia: (m): RenderMedia => ({ kind: m.kind, url: `asset://${m.assetId}`, alt: m.assetId }),
  styleFor: () => undefined,
  map: null,
};

describe("grid convert golden — the-pointe", () => {
  it("classifies 16 bands into a stable slice-type sequence", () => {
    const bands = parseGridBands(fixture("the-pointe-page-content.html"));
    const specs = classifyBands(bands);
    expect(specs.map((s) => `${s.index} ${s.slice}`)).toMatchSnapshot();
  });

  it("builds a stable presentation manifest (structure + media placeholders)", () => {
    const bands = parseGridBands(fixture("the-pointe-page-content.html"));
    const specs = classifyBands(bands);
    const manifest = buildPresentation(specs, deps);
    expect(manifest).toMatchSnapshot();
  });

  it("builds a stable page-doc slice sequence", () => {
    const bands = parseGridBands(fixture("the-pointe-page-content.html"));
    const specs = classifyBands(bands);
    expect(specs.map(sliceSpecToPlanSlice)).toMatchSnapshot();
  });

  it("map-band fixture → a band carrying the map payload", () => {
    const band = fixture("the-pointe-map-band.html");
    const cfg = extractMapConfig(band);
    expect(cfg).not.toBeNull();
    // The raw band fragment alone has no page-content/section/block-content
    // wrapper, so parseGridBands sees no structural bands at all — wrap it
    // the same way tests/blux/grid-classify-map.test.ts does. The band
    // fixture leaves its custom-element0 div unclosed (EOF-closed standalone
    // when captured), so the wrapper supplies the balancing </div>.
    const wrapped = `<div id="page-content"><section class="blocks0" id="page-block-16"><div class="block-content">${band}</div></div></section></div>`;
    const bands = parseGridBands(wrapped);
    const specs = classifyBands(bands, { isMapMount: makeIsMapMount(cfg!) });
    const mapDeps: PresentationDeps = {
      ...deps,
      map: {
        mid: cfg!.mid,
        layers: cfg!.layers,
        toggles: cfg!.toggles,
        styles: cfg!.styles,
        ...(cfg!.center ? { center: cfg!.center } : {}),
        ...(cfg!.zoom !== undefined ? { zoom: cfg!.zoom } : {}),
      },
    };
    const manifest = buildPresentation(specs, mapDeps);
    const withMap = Object.values(manifest.bands).filter((b) => b.map);
    expect(withMap).toHaveLength(1);
    expect(withMap[0]!.map!.mid).toBe(cfg!.mid);
  });
});
