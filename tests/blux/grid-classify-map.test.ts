import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseGridBands } from "../../src/blux/grid/parse-grid.js";
import { classifyBands } from "../../src/blux/grid/classify-band.js";
import { extractMapConfig, makeIsMapMount } from "../../src/blux/grid/extract-map.js";

const page = readFileSync(
  fileURLToPath(new URL("./fixtures/the-pointe-page-content.html", import.meta.url)),
  "utf-8",
);
const band = readFileSync(
  fileURLToPath(new URL("./fixtures/the-pointe-map-band.html", import.meta.url)),
  "utf-8",
);

// DEVIATION from the plan's band-14 assertion: in the real page fixture the
// mount is co-located with the address/logo grids inside page-block-14, and
// the parser peels the non-structural custom-element0 subtree away entirely —
// nothing in band 14's parsed tree carries `burbank_map` (see the grid-golden
// signature). A mount-ONLY band is the shape that parses to a raw mount node
// (types.ts "map mounts parse to raw"), so we append the committed map-band
// fixture as its own band 16; the real 16-band page still pins "everything
// else classifies unchanged".
// The band fixture leaves custom-element0 unclosed (EOF-closed standalone),
// so the wrapper adds the balancing </div>.
const mapBandPage = `<div id="page-content"><section class="blocks0" id="page-block-16"><div class="block-content">${band}</div></div></section></div>`;

describe("makeIsMapMount + classifier", () => {
  it("turns exactly the map band into LocationMap, leaving the rest unchanged", () => {
    const cfg = extractMapConfig(band);
    expect(cfg).not.toBeNull();
    const bands = [...parseGridBands(page), ...parseGridBands(mapBandPage)];
    const without = classifyBands(bands);
    const withMap = classifyBands(bands, { isMapMount: makeIsMapMount(cfg!) });
    const mapSlices = withMap.filter((s) => s.slice === "LocationMap");
    expect(mapSlices).toHaveLength(1);
    expect(mapSlices[0]?.index).toBe(16);
    // every other band (all 16 real the-pointe bands) classifies identically
    const others = (a: typeof withMap) => a.filter((s) => s.index !== 16).map((s) => s.slice);
    expect(others(withMap)).toEqual(others(without));
  });
});
