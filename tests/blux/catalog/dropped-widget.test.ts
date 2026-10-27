import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseGridBands } from "../../../src/blux/grid/parse-grid.js";
import { extractMapConfig, makeIsMapMount } from "../../../src/blux/grid/extract-map.js";
import {
  bandToCatalog,
  buildCatalogPlan,
  catalogSpecToPlanSlice,
  sliceSpecToCatalog,
} from "../../../src/blux/catalog/index.js";
import type { BluxBlockSpec, BluxSectionSpec } from "../../../src/blux/catalog/index.js";
import type { Band, Node } from "../../../src/blux/grid/types.js";
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
        children: [{ html: '<div data-exec="custom_0f3a_77"><script>boot()</script></div>' }],
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

// Round 3 — the Grid/Block path is never silent: classifyBand marked a mount
// (an html-less `widget` node in its rewritten tree) but nothing was
// recoverable from band.root (no predicate / predicate mismatch). Before
// round 3 this was the silent-map-loss shape: blockPayload serialized the
// widget node as an empty div and NOTHING was recorded.
describe("round-3: unrecovered Grid-path mounts + page-qualified where", () => {
  const rewritten: Node = {
    kind: "stack",
    children: [
      { kind: "widget", widget: { type: "map" } },
      {
        kind: "row",
        cells: [{ token: { cols: 1, raw: "grid-1" }, node: { kind: "body", html: "<p>P</p>" } }],
      },
    ],
  };

  it("a widget node with no recoverable mount html → dropped-widget diagnostic (never silent)", () => {
    const b: Band = { index: 4, root: rewritten };
    const diagnostics: Diagnostic[] = [];
    const spec = sliceSpecToCatalog({ slice: "Grid", index: 4, root: rewritten }, b, {
      diagnostics,
    });
    expect("widgetHtml" in spec).toBe(false);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ kind: "dropped-widget", where: "4" });
    // A predicate that no longer matches band.root reports too — page-qualified.
    const diagnostics2: Diagnostic[] = [];
    sliceSpecToCatalog({ slice: "Grid", index: 4, root: rewritten }, b, {
      isMapMount: () => false,
      diagnostics: diagnostics2,
      pageUid: "contact",
    });
    expect(diagnostics2).toHaveLength(1);
    expect(diagnostics2[0]).toMatchObject({ kind: "dropped-widget", where: "contact:4" });
  });

  it("emit-time dropped-widget diagnostics are page-qualified when the page uid is known", () => {
    const spec: BluxSectionSpec = {
      slice: "BluxSection",
      index: 3,
      cells: [{ kind: "embed", embedHtml: MOUNT }],
    };
    const diagnostics: Diagnostic[] = [];
    catalogSpecToPlanSlice(spec, diagnostics, "contact");
    expect(diagnostics).toEqual([
      {
        kind: "dropped-widget",
        where: "contact:3",
        message:
          "custom widget custom_abc is a behavior script (no visible content) — not migrated",
      },
    ]);
  });

  it("buildCatalogPlan page-qualifies every emit-time drop with the page's uid", () => {
    const spec: BluxSectionSpec = {
      slice: "BluxSection",
      index: 0,
      cells: [{ kind: "embed", embedHtml: MOUNT }],
    };
    const plan = buildCatalogPlan([{ uid: "home", title: "Home", specs: [spec] }], {
      assets: [],
      diagnostics: [],
    });
    const drops = plan.diagnostics.filter((d) => d.kind === "dropped-widget");
    expect(drops).toEqual([expect.objectContaining({ where: "home:0" })]);
  });
});
