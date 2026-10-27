import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseGridBands } from "../../../src/blux/grid/parse-grid.js";
import { extractMapConfig, makeIsMapMount } from "../../../src/blux/grid/extract-map.js";
import { bandToCatalog, catalogSpecToPlanSlice } from "../../../src/blux/catalog/index.js";
import type { Band, Node } from "../../../src/blux/grid/types.js";

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

// Round 3: EVERY real map band in the fleet (thePointe, theTower,
// mediaStudios, thePinnacle, theBurbankPortfolio) holds the mount PLUS panel
// rows, so classifyBand routes it Grid — never LocationMap. classifyBand
// rewrote its COPY of the tree into an html-less widget node; the ORIGINAL
// mount html must still lift from band.root onto the Grid/Block spec, exactly
// like the LocationMap and Collection routes already do.
describe("round-3: map mount on the Grid/Block path (mount + panel rows)", () => {
  const cfg = extractMapConfig(band)!;
  const isMapMount = makeIsMapMount(cfg);
  const mountRoot = parseGridBands(mapBandPage)[0]!.root;
  const token = { cols: 2, raw: "grid-2" };
  const panelRow: Node = {
    kind: "row",
    cells: [
      { token, node: { kind: "body", html: "<p>Panel A</p>" } },
      { token, node: { kind: "body", html: "<p>Panel B</p>" } },
    ],
  };
  const gridBand: Band = {
    index: 16,
    root: { kind: "stack", children: [mountRoot, panelRow] },
  };

  it("classifies to BluxGrid carrying the ORIGINAL mount as the widget triple", () => {
    const spec = bandToCatalog(gridBand, { isMapMount, mapConfig: cfg });
    expect(spec.slice).toBe("BluxGrid");
    if (spec.slice !== "BluxGrid") return;
    expect(spec.widgetKind).toBe("map");
    // Pristine html — the legend chips AND the behavior scripts are still in
    // there (sanitize is emit's concern).
    expect(spec.widgetHtml).toContain("The Burbank Portfolio");
    expect(spec.mapConfig?.mountId).toBe("burbank_map");
    // The panel content still rides the grid cells.
    expect(JSON.stringify(spec.cells)).toContain("Panel A");
  });

  it("emits blux_grid with widget_kind/widget_html (sanitized, config inlined) — Section-identical field names", () => {
    const spec = bandToCatalog(gridBand, { isMapMount, mapConfig: cfg });
    const slice = catalogSpecToPlanSlice(spec);
    expect(slice.slice_type).toBe("blux_grid");
    expect(slice.primary.widget_kind).toBe("map");
    const html = slice.primary.widget_html as string;
    expect(html).toContain("The Burbank Portfolio");
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('class="blux-map"');
    expect(html).toContain("data-map-config");
    expect(html).toContain("burbank_map");
  });

  it("the BluxBlock fallback (depth > 2) carries and emits the widget triple too", () => {
    const deepBand: Band = {
      index: 16,
      root: {
        kind: "stack",
        children: [
          mountRoot,
          {
            kind: "row",
            cells: [
              {
                token,
                node: {
                  kind: "row",
                  cells: [{ token, node: { kind: "body", html: "<p>Nested panel</p>" } }],
                },
              },
            ],
          },
        ],
      },
    };
    const spec = bandToCatalog(deepBand, { isMapMount, mapConfig: cfg });
    expect(spec.slice).toBe("BluxBlock");
    if (spec.slice !== "BluxBlock") return;
    expect(spec.widgetKind).toBe("map");
    expect(spec.widgetHtml).toContain("The Burbank Portfolio");
    const slice = catalogSpecToPlanSlice(spec);
    expect(slice.slice_type).toBe("blux_block");
    expect(slice.primary.widget_kind).toBe("map");
    const html = slice.primary.widget_html as string;
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('class="blux-map"');
    expect(html).toContain("data-map-config");
    // The panel content is still in the payload — the widget lift never
    // clobbers the Block path's content preservation.
    expect(slice.primary.payload as string).toContain("Nested panel");
  });

  it("predicate-less callers keep the 4a routing — no widget fields appear", () => {
    const spec = bandToCatalog(gridBand);
    expect("widgetHtml" in spec).toBe(false);
    const slice = catalogSpecToPlanSlice(spec);
    expect(slice.primary).not.toHaveProperty("widget_kind");
    expect(slice.primary).not.toHaveProperty("widget_html");
  });
});
