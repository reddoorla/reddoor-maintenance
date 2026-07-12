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
    expect(
      report.findings.some((f) => f.kind === "media-dropped" && f.band === gallery.index),
    ).toBe(true);
  });

  it("keeps the co-located map when present (map-band fixture)", () => {
    const cfg = extractMapConfig(fixture("the-pointe-map-band.html"));
    expect(cfg).not.toBeNull();
    const wrapped = `<div id="page-content"><section class="blocks0" id="page-block-16"><div class="block-content">${fixture("the-pointe-map-band.html")}</div></div></section></div>`;
    const specs = classifyBands(parseGridBands(wrapped), { isMapMount: makeIsMapMount(cfg!) });
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
    const report = validateLayout(specs, buildPresentation(specs, deps));
    // No map-missing finding — the widget's map config survived.
    expect(report.findings.filter((f) => f.kind === "map-missing")).toEqual([]);
  });
});
