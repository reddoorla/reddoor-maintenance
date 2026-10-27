import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { convertExport, mapRenderFromConfig } from "../../../src/blux/emit/convert.js";
import { minimalSite, minimalHtml } from "../fixtures/minimal-site.js";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf-8");

describe("convertExport — shared offline pipeline", () => {
  it("returns aligned bands/specs/plan/presentation for the-pointe fixture", () => {
    const html = fixture("the-pointe-page-content.html");
    const r = convertExport({ html, siteJson: minimalSite });
    expect(r.bands.length).toBe(16);
    expect(r.specs.length).toBe(16);
    // manifest key set == spec index set
    expect(Object.keys(r.presentation.bands).sort((a, b) => Number(a) - Number(b))).toEqual(
      r.specs.map((s) => String(s.index)),
    );
    // page doc carries one slice per spec
    expect((r.plan.documents[0]!.data.slices as unknown[]).length).toBe(16);
    expect(r.mapConfig).toBeNull(); // page-content fixture has no initMap
  });

  it("threads styles.blocks class defaults into the presentation's band styles", () => {
    const html = fixture("the-pointe-page-content.html");
    // minimalSite's page items carry no styles at all, so every band relies on
    // its class default — the trap case (a band with no own padding declaration).
    const siteJson = {
      ...minimalSite,
      styles: {
        ...minimalSite.styles,
        blocks: [
          {
            ".blocks0container": {
              "max-width": "1280px",
              padding: "120px 4% 120px 4%",
              __media_mobile_padding: "80px 4% 80px 4%",
            },
          },
          {},
          { ".blocks2container": { padding: "40px 0", __media_mobile_padding: "20px 0" } },
        ],
      },
    };
    const r = convertExport({ html, siteJson });
    // band 15 is a blocks0 band whose site.json styles omit _contentPadding
    expect(r.presentation.bands["15"]!.style).toEqual({
      _contentPadding: "120px 4% 120px 4%",
      _contentPaddingMobile: "80px 4% 80px 4%",
      "_max-content-width": "1280px",
    });
    // band 0 is a blocks2 spacer band — the special grid-spacer default
    expect(r.presentation.bands["0"]!.style).toEqual({
      _contentPadding: "40px 0",
      _contentPaddingMobile: "20px 0",
    });
  });

  it("is a no-op-safe pure function (no throw) on the minimal band-less html", () => {
    const r = convertExport({ html: minimalHtml, siteJson: minimalSite });
    expect(r.bands).toEqual([]);
    expect(r.presentation.bands).toEqual({});
  });

  it("mapRenderFromConfig drops the source-only mountId", () => {
    const rc = mapRenderFromConfig({
      mid: "m",
      mountId: "burbank_map",
      layers: [],
      toggles: [],
      styles: [],
      center: { lat: 1, lng: 2 },
      zoom: 12,
    } as never);
    expect(rc).toEqual({
      mid: "m",
      layers: [],
      toggles: [],
      styles: [],
      center: { lat: 1, lng: 2 },
      zoom: 12,
    });
    expect("mountId" in rc).toBe(false);
  });
});
