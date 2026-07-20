import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseGridBands } from "../../../src/blux/grid/parse-grid.js";
import { extractMapConfig, makeIsMapMount } from "../../../src/blux/grid/extract-map.js";
import {
  bandToCatalog,
  buildCatalogPlan,
  catalogSpecToPlanSlice,
} from "../../../src/blux/catalog/index.js";
import type { BluxBlockSpec, BluxSectionSpec } from "../../../src/blux/catalog/index.js";
import type { Diagnostic } from "../../../src/blux/ir.js";

const MOUNT = '<div data-exec="custom_abc"></div>';

describe("dropped-widget diagnostics", () => {
  it("an embed cell that is a bare custom mount → no embed cell + 1 diagnostic", () => {
    const spec: BluxSectionSpec = {
      slice: "BluxSection",
      index: 7,
      cells: [{ kind: "embed", embedHtml: MOUNT }],
    };
    const diagnostics: Diagnostic[] = [];
    const slice = catalogSpecToPlanSlice(spec, diagnostics);
    expect(slice.primary.cells).toEqual([]);
    expect(diagnostics).toEqual([
      {
        kind: "dropped-widget",
        where: "band 7",
        message:
          "custom widget custom_abc is a behavior script (no visible content) — not migrated",
      },
    ]);
  });

  it("a non-mount script-only embed still records a drop — never silent", () => {
    const spec: BluxSectionSpec = {
      slice: "BluxSection",
      index: 1,
      cells: [{ kind: "embed", embedHtml: "<div><script>x()</script></div>" }],
    };
    const diagnostics: Diagnostic[] = [];
    const slice = catalogSpecToPlanSlice(spec, diagnostics);
    expect(slice.primary.cells).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ kind: "dropped-widget", where: "band 1" });
  });

  it("a BluxBlock payload leaf that is a script-only custom mount → 1 diagnostic", () => {
    const spec: BluxBlockSpec = {
      slice: "BluxBlock",
      index: 2,
      payload: {
        tag: "div",
        children: [
          { html: '<div data-exec="custom_0f3a_77"><script>boot()</script></div>' },
        ],
      },
      media: [],
    };
    const diagnostics: Diagnostic[] = [];
    const slice = catalogSpecToPlanSlice(spec, diagnostics);
    expect(JSON.stringify(slice)).not.toContain("<script");
    expect(diagnostics).toEqual([
      {
        kind: "dropped-widget",
        where: "band 2",
        message:
          "custom widget custom_0f3a_77 is a behavior script (no visible content) — not migrated",
      },
    ]);
  });

  it("buildCatalogPlan surfaces the drops on the plan diagnostics", () => {
    const spec: BluxSectionSpec = {
      slice: "BluxSection",
      index: 0,
      cells: [{ kind: "embed", embedHtml: MOUNT }],
    };
    const plan = buildCatalogPlan([{ uid: "home", title: "Home", specs: [spec] }], {
      assets: [],
      diagnostics: [],
    });
    expect(plan.diagnostics.filter((d) => d.kind === "dropped-widget")).toHaveLength(1);
  });

  it("the real map band (visible legend) records NO dropped-widget diagnostic", () => {
    const band = readFileSync(
      fileURLToPath(new URL("../fixtures/the-pointe-map-band.html", import.meta.url)),
      "utf-8",
    );
    const page = `<div id="page-content"><section class="blocks0" id="page-block-16"><div class="block-content">${band}</div></div></section></div>`;
    const cfg = extractMapConfig(band)!;
    const [b] = parseGridBands(page);
    const diagnostics: Diagnostic[] = [];
    catalogSpecToPlanSlice(
      bandToCatalog(b!, { isMapMount: makeIsMapMount(cfg), mapConfig: cfg }),
      diagnostics,
    );
    expect(diagnostics.filter((d) => d.kind === "dropped-widget")).toHaveLength(0);
  });
});
