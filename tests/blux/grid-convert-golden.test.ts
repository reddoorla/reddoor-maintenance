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
import { mapRenderFromConfig } from "../../src/blux/emit/convert.js";
import { sliceSpecToPlanSlice } from "../../src/blux/emit/grid-slice.js";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf-8");

// Deterministic offline resolver: assetId → stable fake URL (no site.json needed).
// Passes through intrinsic sizing exactly as convert.ts's real resolver does, so
// the manifest snapshot exercises the parsed width/aspect/fit end-to-end.
const deps: PresentationDeps = {
  resolveMedia: (m): RenderMedia => ({
    kind: m.kind,
    url: `asset://${m.assetId}`,
    alt: m.assetId,
    ...(m.width !== undefined ? { width: m.width } : {}),
    ...(m.aspect !== undefined ? { aspect: m.aspect } : {}),
    ...(m.fit ? { fit: m.fit } : {}),
    ...(m.position ? { position: m.position } : {}),
    ...(m.playback ? { playback: m.playback } : {}),
  }),
  styleFor: () => undefined,
  map: null,
};

describe("grid convert golden — the-pointe", () => {
  it("classifies 16 bands into a stable slice-type sequence", () => {
    const bands = parseGridBands(fixture("the-pointe-page-content.html"));
    const specs = classifyBands(bands);
    expect(specs.map((s) => `${s.index} ${s.slice}`)).toMatchSnapshot();
    // Tripwire: block-style alignment (blockStylesByIndex keys by site.json items
    // array-position) is only valid when band indices are contiguous from 0. If a
    // future the-pointe re-export skips a block index, this fails loudly.
    expect(specs.map((s) => s.index)).toEqual(Array.from({ length: specs.length }, (_, i) => i));
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
    const mapDeps: PresentationDeps = { ...deps, map: mapRenderFromConfig(cfg!) };
    const manifest = buildPresentation(specs, mapDeps);
    const withMap = Object.values(manifest.bands).filter((b) => b.map);
    expect(withMap).toHaveLength(1);
    const map = withMap[0]!.map!;
    expect(map.mid).toBe(cfg!.mid);
    // the mount height + chip→panel binding survive into the render config.
    expect(map.height).toBe("600px");
    expect(map.defaultToggle).toBe(0);
    expect(map.toggles.map((t) => t.panelIndex)).toEqual([0, 1, 2, 3]);
  });
});
