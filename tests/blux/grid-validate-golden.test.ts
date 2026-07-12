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
import { validateLayout } from "../../src/blux/emit/validate-layout.js";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf-8");

// Every media resolves → a faithful conversion has zero findings.
const resolveAll: PresentationDeps = {
  resolveMedia: (m): RenderMedia => ({ kind: m.kind, url: `asset://${m.assetId}`, alt: m.assetId }),
  styleFor: () => undefined,
  map: null,
};

describe("grid validate golden — the-pointe", () => {
  it("converts the 16 bands with zero layout findings", () => {
    const specs = classifyBands(parseGridBands(fixture("the-pointe-page-content.html")));
    const report = validateLayout(specs, buildPresentation(specs, resolveAll));
    expect(report.faithful).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.bands).toBe(16);
    expect(report.gridBands).toBe(10); // 10 Grid-fallback bands checked for tree fidelity
    expect(report.rows).toMatchSnapshot();
  });

  it("reports drift when a single asset fails to resolve", () => {
    const specs = classifyBands(parseGridBands(fixture("the-pointe-page-content.html")));
    // Drop exactly the gallery band's first image → a media-dropped finding.
    const gallery = specs.find((s) => s.slice === "Gallery")!;
    const dropId = (gallery as { media: { assetId: string }[] }).media[0]!.assetId;
    const deps: PresentationDeps = {
      ...resolveAll,
      resolveMedia: (m) => (m.assetId === dropId ? null : resolveAll.resolveMedia(m)),
    };
    const report = validateLayout(specs, buildPresentation(specs, deps));
    expect(report.faithful).toBe(false);
    // Exactly one finding — the dropped gallery image, nothing spurious.
    expect(report.findings).toContainEqual({
      kind: "media-dropped",
      band: gallery.index,
      where: "gallery 2/3",
    });
    expect(report.findings).toHaveLength(1);
  });

  it("keeps a standalone map band's config (LocationMap slice) — no false map-missing", () => {
    // This exercises the STANDALONE map band, which classifies as its own
    // LocationMap slice. The co-located map-inside-a-Grid path is covered by the
    // synthetic unit test in validate-layout.test.ts ("does NOT flag a Grid band
    // whose co-located map survived"). A dedicated map fixture is needed because
    // the main fixture's band 14 has its map peeled at parse time (a known
    // parser limitation the snapshot locks in).
    const cfg = extractMapConfig(fixture("the-pointe-map-band.html"));
    expect(cfg).not.toBeNull();
    const wrapped = `<div id="page-content"><section class="blocks0" id="page-block-16"><div class="block-content">${fixture("the-pointe-map-band.html")}</div></div></section></div>`;
    const specs = classifyBands(parseGridBands(wrapped), { isMapMount: makeIsMapMount(cfg!) });
    expect(specs.some((s) => s.slice === "LocationMap")).toBe(true); // the map classified
    const deps: PresentationDeps = {
      ...resolveAll,
      map: {
        mid: cfg!.mid,
        layers: cfg!.layers,
        toggles: cfg!.toggles,
        styles: cfg!.styles,
        ...(cfg!.center ? { center: cfg!.center } : {}),
        ...(cfg!.zoom !== undefined ? { zoom: cfg!.zoom } : {}),
      },
    };
    const manifest = buildPresentation(specs, deps);
    expect(manifest.bands["16"]?.map?.mid).toBe(cfg!.mid); // the map config is carried into the manifest
    const report = validateLayout(specs, manifest);
    // …and the gate does not falsely flag it as missing.
    expect(report.findings.filter((f) => f.kind === "map-missing")).toEqual([]);
  });
});
