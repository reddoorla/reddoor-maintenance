import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractMapConfig } from "../../src/blux/grid/extract-map.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/the-pointe-map-band.html", import.meta.url));
const html = readFileSync(FIXTURE, "utf-8");

describe("extractMapConfig", () => {
  it("returns null for HTML without an initMap script", () => {
    expect(extractMapConfig("<html><body><p>hi</p></body></html>")).toBeNull();
  });

  it("extracts mount, mid, layers, styles, center and zoom from the-pointe band", () => {
    const cfg = extractMapConfig(html);
    expect(cfg).not.toBeNull();
    expect(cfg?.mountId).toBe("burbank_map");
    expect(cfg?.mid).toBe("1KwcmcCf1kd-8jN7lLt36kQ9lFjLab0bz");
    expect(cfg?.layers).toHaveLength(8);
    expect(cfg?.layers.map((l) => l.name)).toEqual([
      "Hotels",
      "Food_And_Drink",
      "Retail",
      "Services",
      "Entertainment",
      "Office_Tenants",
      "Studios",
      "The_Burbank_Portfolio",
    ]);
    const portfolio = cfg?.layers.find((l) => l.name === "The_Burbank_Portfolio");
    expect(portfolio?.lid).toBe("lq--xeECBoM");
    expect(portfolio?.initiallyVisible).toBe(true);
    expect(portfolio?.preserveViewport).toBe(false);
    const hotels = cfg?.layers.find((l) => l.name === "Hotels");
    expect(hotels?.lid).toBe("8rJ0fKhImbs");
    expect(hotels?.initiallyVisible).toBe(false);
    expect(hotels?.preserveViewport).toBe(true);
    expect(Array.isArray(cfg?.styles)).toBe(true);
    expect((cfg?.styles as unknown[]).length).toBeGreaterThan(20);
    expect(cfg?.center).toEqual({ lat: -34.397, lng: 150.644 });
    expect(cfg?.zoom).toBe(8);
    // the mount div's own inline height (lives on the inner mount, not the section).
    expect(cfg?.height).toBe("600px");
  });

  it("extracts the four toggle groups pairing chip labels with clickMap layer sets", () => {
    const cfg = extractMapConfig(html);
    expect(cfg?.toggles).toEqual([
      { label: "The Burbank Portfolio", layers: ["The_Burbank_Portfolio"], panelIndex: 0 },
      { label: "Studio And Offices", layers: ["Studios", "Office_Tenants"], panelIndex: 1 },
      {
        label: "Retail And Dining",
        layers: ["Food_And_Drink", "Retail", "Entertainment"],
        panelIndex: 2,
      },
      { label: "Hotel And Services", layers: ["Hotels", "Services"], panelIndex: 3 },
    ]);
    // chip → content panel binding + the on-load active panel.
    expect(cfg?.defaultToggle).toBe(0);
  });

  it("degrades: toggles [] when clickMap script is absent; null when layers missing", () => {
    const noClick = html.replace(/<script>clickMap=[\s\S]*?<\/script>/, "");
    expect(extractMapConfig(noClick)?.toggles).toEqual([]);
    const noLayers = html.replace(/new google\.maps\.KmlLayer/g, "KML_GONE");
    expect(extractMapConfig(noLayers)).toBeNull();
  });
});
