import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseGridBands } from "../../../src/blux/grid/parse-grid.js";
import { extractMapConfig, makeIsMapMount } from "../../../src/blux/grid/extract-map.js";
import { bandToCatalog, catalogSpecToPlanSlice } from "../../../src/blux/catalog/index.js";

const band = readFileSync(
  fileURLToPath(new URL("../fixtures/the-pointe-map-band.html", import.meta.url)),
  "utf-8",
);

// Same wrapper as grid-classify-map.test.ts: the committed fixture is a
// standalone (EOF-closed) mount, so the wrapper adds the balancing </div> and
// gives the parser a real band envelope.
const mapBandPage = `<div id="page-content"><section class="blocks0" id="page-block-16"><div class="block-content">${band}</div></div></section></div>`;

describe("decision-B map widget routing (real map band)", () => {
  const cfg = extractMapConfig(band);
  const bands = parseGridBands(mapBandPage);

  it("routes the map band to a BluxSection carrying the mount as a widget", () => {
    expect(cfg).not.toBeNull();
    expect(bands).toHaveLength(1);
    const spec = bandToCatalog(bands[0]!, {
      isMapMount: makeIsMapMount(cfg!),
      mapConfig: cfg!,
    });
    expect(spec.slice).toBe("BluxSection");
    if (spec.slice !== "BluxSection") return;
    expect(spec.widgetKind).toBe("map");
    // The ORIGINAL mount html rides the spec — scripts and all (sanitize is
    // emit's concern); the legend chips are in there.
    expect(spec.widgetHtml).toContain("The Burbank Portfolio");
    expect(spec.mapConfig?.mountId).toBe("burbank_map");
  });

  it("emits widget_kind/widget_html with the config inlined and the scripts gone", () => {
    const spec = bandToCatalog(bands[0]!, {
      isMapMount: makeIsMapMount(cfg!),
      mapConfig: cfg!,
    });
    const slice = catalogSpecToPlanSlice(spec);
    expect(slice.slice_type).toBe("blux_section");
    expect(slice.primary.widget_kind).toBe("map");
    const html = slice.primary.widget_html as string;
    // Visible legend survives; the behavior scripts do not.
    expect(html).toContain("The Burbank Portfolio");
    expect(html).not.toMatch(/<script/i);
    // The extracted MapConfig rides the document as a data attribute the
    // starter design layer hydrates from.
    expect(html).toContain('class="blux-map"');
    expect(html).toContain("data-map-config");
    expect(html).toContain("burbank_map");
  });

  it("keeps the 4a routing when no mount predicate is injected", () => {
    // Predicate-less callers never see LocationMap: the mount raw is
    // significant text, so the band takes the Grid fallback — no widget.
    const spec = bandToCatalog(bands[0]!);
    expect(spec.slice).toBe("BluxGrid");
  });
});
