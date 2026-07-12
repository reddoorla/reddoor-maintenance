# Blux Grid Plan 6 — Layout-Signature Validation (offline fidelity gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an offline, deterministic fidelity gate that diffs a Blux export's source structure (the "answer key") against the emitted presentation manifest, naming every band whose layout drifted, media dropped, or map went missing — so an operator sees exactly what will render wrong _before_ a live migrate + deploy, without spending a token eyeballing pages.

**Architecture:** One new pure module `src/blux/emit/validate-layout.ts` compares the classified `SliceSpec[]` (source truth, already gated band→spec by the classify golden) against the `Presentation` manifest (from plan 5's `buildPresentation`). It computes a compact structural **signature** for the render-faithful `Grid` bands on both sides — a source `Node` and its serialized `RenderNode` twin share kinds and fields, so a single `sigOf` walks both — and asserts they match exactly; any divergence (a dropped cell, an unresolved-media collapse, a missing tree) is a finding. Smart slices (Hero/TitleBand/Gallery/Split/…) are checked for payload completeness (gallery count, split/media present, background/map present), since they intentionally reshape structure. A shared `convertExport()` helper (extracted from the `convert` CLI action) feeds both `blux convert` (which now appends a fidelity summary + writes `layout-report.json`) and a reworked offline `blux validate <dir>` (which exits non-zero on findings; `--against` still layers on the existing content-coverage check).

**Tech Stack:** TypeScript (strict: `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — conditional spreads, never `field: undefined`), `tsx`, Vitest (unit + snapshot goldens). No new runtime deps. No network, no writes in the core; the CLI does the I/O.

---

## Context the executor must load first

Read these before Task 1 — they define the contracts this plan joins. **This plan runs in the worktree `~/Documents/GitHub/rm-plan6` on branch `feat/blux-grid-plan6-validate` (off `origin/main` @ 5e38cf9 = plan 5). Never commit from the main checkout.**

- **Design spec:** `docs/superpowers/specs/2026-07-08-blux-faithful-grid-slices-design.md` — this is spec step "[4] validate: content coverage + layout-signature check vs the answer key" (roadmap item 6 in `docs/superpowers/plans/2026-07-08-blux-grid-tree-parser.md`). **Scope decision for this plan (operator-confirmed 2026-07-11):** the layout-signature check runs **offline against the emitted manifest**, not against a browser-rendered DOM. The spec's literal "parse the rendered converted page" (a Playwright DOM reader) is deferred to **plan 7's** render-verify — plan 7 already ships a Playwright screenshot harness for visual sign-off. Rationale: plan 5 now emits `blux-presentation.json`, a faithful structural proxy of what the-pointe renders (`Grid.svelte` walks `bands[i].tree` verbatim), so the check is fully deterministic and CI-gateable with zero browser.

- **Source IR (input to the check):**
  - `src/blux/grid/slice-spec.ts` — the `SliceSpec` union. Per-variant fields: `Grid{root:Node}`, `SplitFeature{ratio,mediaSide,media,text:Node}`, `Gallery{media:Media[]}`, `MediaFull{media}`, `VideoFeature{media}`, `Hero{heading?,subtitle?,body?}`, `TitleBand{heading,subtitle?}`, `RichText{html}`, `LocationMap{}`. Every spec has `SpecBase{index:number; background?:Media}`.
  - `src/blux/grid/types.ts` — `Node` union (`row{cells:Cell[]}`, `stack{children:Node[]}`, `heading{level,html,role?}`, `body{html,role?}`, `subtitle{text,role?}`, `media{media:Media}`, `widget{widget:{type:"map"}}`, `raw{html}`), `Cell{token:GridToken; node:Node}`, `GridToken{cols:number|"any"; ratio?; sized?; raw:string}`, `Media{kind:"image"|"video"; assetId; ext?; base?}`.
  - `src/blux/grid/signature.ts` — the EXISTING `gridSignature(bands)`/`sig(node)`. **Do not modify it** — it feeds the `grid-golden`/`grid-convert-golden` snapshots and uses `token.raw` for human readability. Plan 6 writes its own token-canonical `sigOf` (below) so a source token and its `raw`-less render twin compare equal. Mirror its exhaustive `switch (node.kind)` style so a new node kind is a compile error, not a silent drop.
  - `src/blux/grid/index.ts` re-exports `Cell`, `Node`, `Media`, `SliceSpec`, `collectMedia`, `parseGridBands`, `classifyBands`, `extractMapConfig`, `makeIsMapMount`, `MapConfig`.

- **Converted artifact (the thing checked) — plan 5's manifest builder:** `src/blux/emit/presentation.ts`:
  - `Presentation = { bands: Record<string, BandPresentation> }` (key = `String(spec.index)`).
  - `BandPresentation = { style?; background?:RenderMedia; tree?:RenderNode; split?:{mediaSide,ratio,media,text:RenderNode}; gallery?:RenderMedia[]; media?:RenderMedia; map?:MapRenderConfig }`.
  - `RenderNode` mirrors `Node` (same `kind`s; `heading/body/subtitle` keep `role?`; media is `RenderMedia{kind,url,alt?}`; token is `RenderToken{cols,ratio?,sized?}` — **NO `raw`**). `RenderCell{token:RenderToken; node:RenderNode}`.
  - `buildPresentation` per-variant behavior (READ it): Hero/TitleBand/RichText carry **no** tree/media (text lives in the page doc) — only `style`/`background`. Gallery→`gallery[]` (unresolved media dropped). MediaFull/Video→`media` (dropped if unresolved). SplitFeature→`split` (only set if BOTH media and text resolve). Grid→`tree` (`renderNode(spec.root)`, which **drops unresolved media nodes** — a dropped node's parent row/stack skips it entirely). Grid with a co-located `widget:map` in its tree also gets `map`. `hasMapWidget(node)` (currently **private** — Task 1 exports it) detects a map widget anywhere in a tree.

- **CLI + reused plumbing:** `src/cli/commands/blux.ts` — the `convert` action (parse→classify→assembleIR→build deps→`buildGridPlan`+`buildPresentation`→write files) whose core Task 3 extracts into `convertExport`; the `validate` action (currently content-coverage only, requires `--against`) which Task 5 reworks; the local `mapRenderFromConfig` helper (Task 3 moves it into `convert.ts`). `src/blux/emit/grid-plan.ts` — `buildGridPlan`, `mediaUrl(m, sourceUrlById)` (CDN base ?? IR sourceUrl). `src/blux/emit/block-styles.ts` — `blockStylesByIndex(siteJson)`. `src/blux/validate.ts` — the existing `validateCoverage`/`extractTextRuns` (content coverage; unchanged, reused by Task 5's `--against` layer). `src/blux/assemble.ts` — `assembleIR({siteJson, htmls})`.

- **Test fixtures/patterns:** `tests/blux/fixtures/the-pointe-page-content.html` (16 bands, indices 0–15 contiguous; slice sequence in `tests/blux/__snapshots__/grid-classify-golden.test.ts.snap`: `0 Grid, 1 SplitFeature(right r40), 2 TitleBand, 3–6 Grid, 7 Hero, 8 Gallery(n=3), 9–12 Grid, 13 TitleBand, 14 Grid, 15 TitleBand` — **no map** in this fixture). `tests/blux/fixtures/the-pointe-map-band.html` + the wrapping trick in `tests/blux/grid-convert-golden.test.ts`'s 4th test (`<div id="page-content">…page-block-16…</div>`) for a map band. `tests/blux/fixtures/minimal-site.ts` exports `minimalSite` (a valid site.json object) + `minimalHtml` (a plain `<img>` page with **no grid bands** → `parseGridBands` returns `[]` → vacuously faithful). Golden style: `tests/blux/grid-convert-golden.test.ts` (deterministic `asset://` resolver, `toMatchSnapshot`).

### The comparison, precisely (why it is not tautological)

The full fidelity chain is `band.root` (parsed source) → `spec.root` (classified: `band.root` with map `raw`→`widget:map`, the only rewrite) → `manifest.tree` (`renderNode(spec.root)`, which drops unresolved media). The **classify golden** (`grid-classify-golden`) already gates `band → spec`. Plan 6 gates `spec → manifest`:

- The source side uses **`spec.root`** (post-classify), so the deliberate map upgrade is **not** flagged as drift (both sides carry `widget:map`).
- `sigOf(spec.root)` includes a `media:image` atom for **every** source media; `sigOf(manifest.tree)` omits any media the resolver couldn't turn into a URL (those nodes were dropped). **So the two signatures diverge exactly when a media was dropped or a `renderNode` bug reshaped the tree** — a genuine regression signal, not a same-value round-trip.
- Combined: classify golden (band→spec) + plan 6 (spec→manifest) gate the whole `band → manifest` chain that the-pointe renders.

Plan 6 validates the **manifest** (layout/media/map). Hero/TitleBand/RichText **text** fidelity is the page-doc's job, already gated by `tests/blux/emit/grid-slice.test.ts` — plan 6 does not re-check it (those bands carry no manifest tree to lose).

---

## File Structure

**Create:**

- `src/blux/emit/validate-layout.ts` — `sigOf`, `validateLayout(specs, presentation): LayoutReport`, `formatLayoutReport(report): string`, and the `LayoutFinding`/`LayoutRow`/`LayoutReport` types. Pure, offline, no I/O.
- `src/blux/emit/convert.ts` — `convertExport({html, siteJson}): ConvertResult` (shared offline pipeline) + `mapRenderFromConfig` (moved from `blux.ts`). Pure, offline, no I/O.
- `tests/blux/emit/validate-layout.test.ts` — synthetic unit tests (one per finding kind + a faithful case + the formatter).
- `tests/blux/emit/convert.test.ts` — `convertExport` returns aligned artifacts; parity with the old inline pipeline.
- `tests/blux/grid-validate-golden.test.ts` — the-pointe fixture → `faithful:true, findings:[]` + rows snapshot; map-band fixture → faithful with the map surviving; a null-resolver negative.

**Modify:**

- `src/blux/emit/presentation.ts` — export `hasMapWidget` (one word: `function` → `export function`).
- `src/cli/commands/blux.ts` — `convert` action calls `convertExport`, appends `formatLayoutReport` + writes `layout-report.json`; `validate` action reworked to the offline layout gate (+ `--against` coverage layer); imports trimmed; local `mapRenderFromConfig` removed.
- `tests/cli/blux-command.test.ts` — update the `blux validate` describe block (new offline-default behavior) and extend the `blux convert` describe block (layout-report assertions).

---

## Task 1: `validateLayout` core — the signature diff + findings

**Files:**

- Create: `src/blux/emit/validate-layout.ts`
- Modify: `src/blux/emit/presentation.ts` (export `hasMapWidget`)
- Test: `tests/blux/emit/validate-layout.test.ts`

- [ ] **Step 1: Export `hasMapWidget` from `presentation.ts`**

In `src/blux/emit/presentation.ts`, change the one line:

```ts
/** Does a (source) node tree contain a map widget anywhere? */
export function hasMapWidget(node: Node): boolean {
```

(only `function` → `export function`; body unchanged). This is import-only — the convert golden still passes.

- [ ] **Step 2: Write the failing test**

Create `tests/blux/emit/validate-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Node, SliceSpec } from "../../../src/blux/grid/index.js";
import type { Presentation, RenderNode } from "../../../src/blux/emit/presentation.js";
import { sigOf, validateLayout } from "../../../src/blux/emit/validate-layout.js";

// --- helpers: minimal source + render nodes ---------------------------------
const img = (id: string): Extract<Node, { kind: "media" }> => ({
  kind: "media",
  media: { kind: "image", assetId: id },
});
const rImg = (): Extract<RenderNode, { kind: "media" }> => ({
  kind: "media",
  media: { kind: "image", url: "asset://x" },
});
// a source row of two cells: [6: heading, 6: image]
const srcRow: Node = {
  kind: "row",
  cells: [
    { token: { cols: 6, raw: "grid-2" }, node: { kind: "heading", level: 2, html: "<h2>x</h2>" } },
    { token: { cols: 6, raw: "grid-2" }, node: img("a1") },
  ],
};
// its faithful render twin
const renRow: RenderNode = {
  kind: "row",
  cells: [
    { token: { cols: 6 }, node: { kind: "heading", level: 2, html: "<h2>x</h2>" } },
    { token: { cols: 6 }, node: rImg() },
  ],
};
const gridSpec = (index: number, root: Node): SliceSpec => ({ slice: "Grid", index, root });

describe("sigOf — source Node and RenderNode twins share one signature", () => {
  it("gives a source token and its raw-less render twin the same string", () => {
    expect(sigOf(srcRow)).toBe("row[6:h2,6:media:image]");
    expect(sigOf(renRow)).toBe("row[6:h2,6:media:image]");
    expect(sigOf(srcRow)).toBe(sigOf(renRow));
  });
  it("encodes ratio/sized tokens without the source-only raw", () => {
    const n: Node = {
      kind: "row",
      cells: [{ token: { cols: 2, ratio: 40, raw: "grid-2-r40" }, node: img("a") }],
    };
    expect(sigOf(n)).toBe("row[2r40:media:image]");
  });
});

describe("validateLayout — faithful conversions", () => {
  it("passes when every Grid tree round-trips and no media dropped", () => {
    const specs = [gridSpec(0, srcRow)];
    const pres: Presentation = { bands: { "0": { tree: renRow } } };
    const r = validateLayout(specs, pres);
    expect(r.faithful).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.bands).toBe(1);
    expect(r.gridBands).toBe(1);
    expect(r.rows[0]).toMatchObject({ band: 0, slice: "Grid", ok: true });
  });

  it("is vacuously faithful for zero bands", () => {
    const r = validateLayout([], { bands: {} });
    expect(r.faithful).toBe(true);
    expect(r.rows).toEqual([]);
  });
});

describe("validateLayout — findings", () => {
  it("flags tree drift when the manifest dropped a media cell", () => {
    // render twin lost the image cell (unresolved media → renderNode dropped it)
    const droppedRow: RenderNode = { kind: "row", cells: [renRow.cells[0]!] };
    const r = validateLayout([gridSpec(0, srcRow)], { bands: { "0": { tree: droppedRow } } });
    expect(r.faithful).toBe(false);
    expect(r.findings).toContainEqual({
      kind: "tree-drift",
      band: 0,
      expected: "row[6:h2,6:media:image]",
      actual: "row[6:h2]",
    });
    expect(r.rows[0]!.ok).toBe(false);
  });

  it("flags a Grid band with no manifest tree", () => {
    const r = validateLayout([gridSpec(3, srcRow)], { bands: { "3": {} } });
    expect(r.findings).toContainEqual({
      kind: "tree-drift",
      band: 3,
      expected: "row[6:h2,6:media:image]",
      actual: "∅",
    });
  });

  it("flags a band missing from the manifest entirely", () => {
    const r = validateLayout([gridSpec(0, srcRow)], { bands: {} });
    expect(r.findings).toContainEqual({ kind: "band-missing", band: 0 });
    expect(r.findings).toContainEqual({ kind: "band-count", specs: 1, manifest: 0 });
  });

  it("flags a short gallery (an image dropped)", () => {
    const specs: SliceSpec[] = [
      {
        slice: "Gallery",
        index: 8,
        media: [
          { kind: "image", assetId: "a" },
          { kind: "image", assetId: "b" },
          { kind: "image", assetId: "c" },
        ],
      },
    ];
    const pres: Presentation = {
      bands: { "8": { gallery: [{ kind: "image", url: "asset://a" }] } },
    };
    const r = validateLayout(specs, pres);
    expect(r.findings).toContainEqual({ kind: "media-dropped", band: 8, where: "gallery 1/3" });
    expect(r.rows[0]).toMatchObject({ source: "gallery(3)", converted: "gallery(1)", ok: false });
  });

  it("flags a split_feature whose media/text failed to resolve", () => {
    const specs: SliceSpec[] = [
      {
        slice: "SplitFeature",
        index: 1,
        ratio: 40,
        mediaSide: "right",
        media: { kind: "image", assetId: "m" },
        text: { kind: "body", html: "<p>t</p>" },
      },
    ];
    const r = validateLayout(specs, { bands: { "1": {} } });
    expect(r.findings).toContainEqual({ kind: "media-dropped", band: 1, where: "split" });
  });

  it("flags a media_full band whose media dropped", () => {
    const specs: SliceSpec[] = [
      { slice: "MediaFull", index: 5, media: { kind: "image", assetId: "m" } },
    ];
    const r = validateLayout(specs, { bands: { "5": {} } });
    expect(r.findings).toContainEqual({ kind: "media-dropped", band: 5, where: "media" });
  });

  it("flags a dropped band background", () => {
    const specs = [gridSpec(0, srcRow)].map((s) => ({
      ...s,
      background: { kind: "image" as const, assetId: "bg" },
    }));
    const r = validateLayout(specs, { bands: { "0": { tree: renRow } } });
    expect(r.findings).toContainEqual({ kind: "media-dropped", band: 0, where: "background" });
  });

  it("flags a LocationMap band with no map config", () => {
    const specs: SliceSpec[] = [{ slice: "LocationMap", index: 13 }];
    const r = validateLayout(specs, { bands: { "13": {} } });
    expect(r.findings).toContainEqual({ kind: "map-missing", band: 13 });
  });

  it("flags a Grid band with a co-located map widget but no manifest map", () => {
    const root: Node = { kind: "widget", widget: { type: "map" } };
    const pres: Presentation = {
      bands: { "14": { tree: { kind: "widget", widget: { type: "map" } } } },
    };
    const r = validateLayout([gridSpec(14, root)], pres);
    expect(r.findings).toContainEqual({ kind: "map-missing", band: 14 });
  });

  it("does NOT flag a Grid band whose co-located map survived", () => {
    const root: Node = { kind: "widget", widget: { type: "map" } };
    const pres: Presentation = {
      bands: {
        "14": {
          tree: { kind: "widget", widget: { type: "map" } },
          map: { mid: "m", layers: [], toggles: [], styles: [] },
        },
      },
    };
    const r = validateLayout([gridSpec(14, root)], pres);
    expect(r.faithful).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd ~/Documents/GitHub/rm-plan6 && pnpm vitest run tests/blux/emit/validate-layout.test.ts`
Expected: FAIL — `sigOf`/`validateLayout` not exported from a non-existent module.

- [ ] **Step 4: Implement `validate-layout.ts`**

Create `src/blux/emit/validate-layout.ts`:

```ts
// Offline layout-fidelity gate (plan 6). Diffs the classified source
// (`SliceSpec[]`, already gated band→spec by grid-classify-golden) against the
// emitted presentation manifest (plan 5), naming every band whose layout,
// media, or map drifted. Pure + offline — the render side (Playwright DOM
// signature) is plan 7's verify. See the plan's "The comparison, precisely".
import type { Cell, Node, SliceSpec } from "../grid/index.js";
import {
  hasMapWidget,
  type Presentation,
  type RenderCell,
  type RenderNode,
} from "./presentation.js";

/** Canonical grid-token key — cols + optional ratio/sized, WITHOUT the
 * source-only `raw` string, so a source token and its render-side twin (which
 * never carries `raw`) compare equal. */
function tokKey(t: { cols: number | "any"; ratio?: number; sized?: number }): string {
  return `${t.cols}${t.ratio !== undefined ? `r${t.ratio}` : ""}${t.sized !== undefined ? `s${t.sized}` : ""}`;
}

/** Compact structural signature of a node tree, computed identically for a
 * source `Node` and its serialized `RenderNode` twin (they share `kind`s and
 * aligned fields). Prose is excluded; only kinds + grid tokens + media/widget
 * kinds appear — so it snapshots LAYOUT, not content. A source media node the
 * manifest dropped (unresolved url) makes the two signatures diverge, which is
 * exactly the fidelity signal we want. Mirrors `grid/signature.ts`'s exhaustive
 * switch so a new node kind is a compile error, not a silent drop. */
export function sigOf(node: Node | RenderNode): string {
  switch (node.kind) {
    case "row":
      return `row[${node.cells
        .map((c: Cell | RenderCell) => `${tokKey(c.token)}:${sigOf(c.node)}`)
        .join(",")}]`;
    case "stack":
      return `stack[${node.children.map(sigOf).join(",")}]`;
    case "heading":
      return `h${node.level}`;
    case "body":
      return "body";
    case "subtitle":
      return "subtitle";
    case "media":
      return `media:${node.media.kind}`;
    case "widget":
      return `widget:${node.widget.type}`;
    case "raw":
      return "raw";
  }
}

export type LayoutFinding =
  | { kind: "band-count"; specs: number; manifest: number }
  | { kind: "band-missing"; band: number }
  | { kind: "tree-drift"; band: number; expected: string; actual: string }
  | { kind: "media-dropped"; band: number; where: string }
  | { kind: "map-missing"; band: number };

export type LayoutRow = {
  band: number;
  slice: SliceSpec["slice"];
  source: string;
  converted: string;
  ok: boolean;
};

export type LayoutReport = {
  /** number of source bands (== specs.length) */
  bands: number;
  /** Grid-fallback bands whose tree fidelity was signature-checked */
  gridBands: number;
  faithful: boolean;
  findings: LayoutFinding[];
  rows: LayoutRow[];
};

/** A short source-side label per slice, used for the report row's `source`
 * column and the missing-band row. Grid uses the full structural signature. */
function sourceLabel(spec: SliceSpec): string {
  switch (spec.slice) {
    case "Grid":
      return sigOf(spec.root);
    case "Gallery":
      return `gallery(${spec.media.length})`;
    case "MediaFull":
      return "media_full";
    case "VideoFeature":
      return "video";
    case "SplitFeature":
      return `split(${spec.mediaSide},${spec.ratio})`;
    case "LocationMap":
      return "location_map";
    case "Hero":
      return "hero";
    case "TitleBand":
      return "title_band";
    case "RichText":
      return "rich_text";
  }
}

/** Diff the classified source against the emitted manifest. Grid bands must
 * round-trip their structural signature exactly (spec.root vs the serialized
 * tree); smart slices are checked for payload completeness (gallery count,
 * split/media present, background/map present). Returns a structured report;
 * `faithful` is true iff `findings` is empty. */
export function validateLayout(specs: SliceSpec[], presentation: Presentation): LayoutReport {
  const findings: LayoutFinding[] = [];
  const rows: LayoutRow[] = [];
  const manifestKeys = Object.keys(presentation.bands);
  let gridBands = 0;

  if (specs.length !== manifestKeys.length) {
    findings.push({ kind: "band-count", specs: specs.length, manifest: manifestKeys.length });
  }

  for (const spec of specs) {
    const source = sourceLabel(spec);
    const bp = presentation.bands[String(spec.index)];
    if (!bp) {
      findings.push({ kind: "band-missing", band: spec.index });
      rows.push({ band: spec.index, slice: spec.slice, source, converted: "∅", ok: false });
      continue;
    }
    const before = findings.length;
    let converted = source;

    // Band background (any slice) must survive if the source declared one.
    if (spec.background && !bp.background) {
      findings.push({ kind: "media-dropped", band: spec.index, where: "background" });
    }

    switch (spec.slice) {
      case "Grid": {
        gridBands++;
        converted = bp.tree ? sigOf(bp.tree) : "∅";
        if (source !== converted) {
          findings.push({
            kind: "tree-drift",
            band: spec.index,
            expected: source,
            actual: converted,
          });
        }
        if (hasMapWidget(spec.root) && !bp.map) {
          findings.push({ kind: "map-missing", band: spec.index });
        }
        break;
      }
      case "Gallery": {
        const got = bp.gallery?.length ?? 0;
        converted = `gallery(${got})`;
        if (got < spec.media.length) {
          findings.push({
            kind: "media-dropped",
            band: spec.index,
            where: `gallery ${got}/${spec.media.length}`,
          });
        }
        break;
      }
      case "MediaFull":
      case "VideoFeature": {
        if (!bp.media) {
          converted = "∅";
          findings.push({ kind: "media-dropped", band: spec.index, where: "media" });
        }
        break;
      }
      case "SplitFeature": {
        if (!bp.split) {
          converted = "∅";
          findings.push({ kind: "media-dropped", band: spec.index, where: "split" });
        }
        break;
      }
      case "LocationMap": {
        if (!bp.map) {
          converted = "∅";
          findings.push({ kind: "map-missing", band: spec.index });
        }
        break;
      }
      case "Hero":
      case "TitleBand":
      case "RichText":
        break; // text lives in the page doc (gated by grid-slice.test.ts); nothing manifest-carried to lose beyond background
    }

    rows.push({
      band: spec.index,
      slice: spec.slice,
      source,
      converted,
      ok: findings.length === before,
    });
  }

  return { bands: specs.length, gridBands, faithful: findings.length === 0, findings, rows };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/blux/emit/validate-layout.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors. If `sigOf`'s `node.cells.map(...)` complains about the union-array callback, the explicit `(c: Cell | RenderCell)` annotation (already in the code above) resolves it.

- [ ] **Step 7: Commit**

```bash
git add src/blux/emit/validate-layout.ts src/blux/emit/presentation.ts tests/blux/emit/validate-layout.test.ts
git commit -m "feat(blux): validateLayout — offline layout-signature fidelity gate (plan 6)"
```

---

## Task 2: `formatLayoutReport` — human-readable summary

**Files:**

- Modify: `src/blux/emit/validate-layout.ts`
- Test: `tests/blux/emit/validate-layout.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/blux/emit/validate-layout.test.ts`:

```ts
import { formatLayoutReport } from "../../../src/blux/emit/validate-layout.js";

describe("formatLayoutReport", () => {
  it("summarizes a faithful report as one FAITHFUL line + a per-band table", () => {
    const specs = [gridSpec(0, srcRow)];
    const out = formatLayoutReport(validateLayout(specs, { bands: { "0": { tree: renRow } } }));
    expect(out).toContain("layout fidelity: FAITHFUL");
    expect(out).toContain("1 bands");
    expect(out).toContain("1 grid-tree checked");
    expect(out).toMatch(/band\s+0\s+Grid\s+ok/);
    expect(out).not.toContain("findings:");
  });

  it("lists each finding with the expected/actual signatures", () => {
    const droppedRow: RenderNode = { kind: "row", cells: [renRow.cells[0]!] };
    const out = formatLayoutReport(
      validateLayout([gridSpec(0, srcRow)], { bands: { "0": { tree: droppedRow } } }),
    );
    expect(out).toContain("1 finding(s)");
    expect(out).toContain("findings:");
    expect(out).toContain("band 0: grid tree drift");
    expect(out).toContain("row[6:h2,6:media:image]");
    expect(out).toContain("row[6:h2]");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/blux/emit/validate-layout.test.ts -t formatLayoutReport`
Expected: FAIL — `formatLayoutReport` not exported.

- [ ] **Step 3: Implement `formatLayoutReport`**

Append to `src/blux/emit/validate-layout.ts`:

```ts
function fmtFinding(f: LayoutFinding): string {
  switch (f.kind) {
    case "band-count":
      return `  band count mismatch: ${f.specs} source bands vs ${f.manifest} manifest bands`;
    case "band-missing":
      return `  band ${f.band}: no manifest entry`;
    case "tree-drift":
      return `  band ${f.band}: grid tree drift\n      expected ${f.expected}\n      actual   ${f.actual}`;
    case "media-dropped":
      return `  band ${f.band}: media dropped (${f.where})`;
    case "map-missing":
      return `  band ${f.band}: map config missing`;
  }
}

/** Render a LayoutReport as a terminal summary: a headline verdict, a per-band
 * signature table (`ok` / `!!` per band), then the findings detail. */
export function formatLayoutReport(r: LayoutReport): string {
  const headline = `layout fidelity: ${
    r.faithful ? "FAITHFUL" : `${r.findings.length} finding(s)`
  } — ${r.bands} bands (${r.gridBands} grid-tree checked)`;
  const table = r.rows.map((x) => {
    const tag = x.ok ? "ok" : "!!";
    const sig = x.ok ? x.source : `${x.source} -> ${x.converted}`;
    return `  band ${String(x.band).padStart(2)} ${x.slice.padEnd(13)} ${tag}  ${sig}`;
  });
  const detail = r.findings.length ? ["findings:", ...r.findings.map(fmtFinding)] : [];
  return [headline, ...table, ...detail].join("\n");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/blux/emit/validate-layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blux/emit/validate-layout.ts tests/blux/emit/validate-layout.test.ts
git commit -m "feat(blux): formatLayoutReport — terminal fidelity summary"
```

---

## Task 3: Shared `convertExport` core (DRY: convert + validate)

**Files:**

- Create: `src/blux/emit/convert.ts`
- Modify: `src/cli/commands/blux.ts` (convert action uses `convertExport`; remove local `mapRenderFromConfig`; trim imports)
- Test: `tests/blux/emit/convert.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/blux/emit/convert.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/blux/emit/convert.test.ts`
Expected: FAIL — `../../../src/blux/emit/convert.js` does not exist.

- [ ] **Step 3: Implement `convert.ts`** (lift the pipeline verbatim from `blux.ts`'s convert action)

Create `src/blux/emit/convert.ts`:

```ts
import {
  parseGridBands,
  extractMapConfig,
  classifyBands,
  makeIsMapMount,
  type Band,
  type MapConfig,
  type SliceSpec,
} from "../grid/index.js";
import { assembleIR } from "../assemble.js";
import type { SiteIR } from "../ir.js";
import { blockStylesByIndex } from "./block-styles.js";
import { buildGridPlan, mediaUrl } from "./grid-plan.js";
import type { MigrationPlan } from "./plan.js";
import {
  buildPresentation,
  type MapRenderConfig,
  type Presentation,
  type PresentationDeps,
  type RenderMedia,
} from "./presentation.js";

export type ConvertResult = {
  bands: Band[];
  specs: SliceSpec[];
  ir: SiteIR;
  mapConfig: MapConfig | null;
  plan: MigrationPlan;
  presentation: Presentation;
};

/** Drop the source-only `mountId` from an extracted MapConfig → the render-side
 * MapRenderConfig the presentation manifest carries. */
export function mapRenderFromConfig(c: MapConfig): MapRenderConfig {
  return {
    mid: c.mid,
    layers: c.layers,
    toggles: c.toggles,
    styles: c.styles,
    ...(c.center ? { center: c.center } : {}),
    ...(c.zoom !== undefined ? { zoom: c.zoom } : {}),
  };
}

/** The offline convert pipeline shared by `blux convert` (writes files) and
 * `blux validate` (checks fidelity): parse + classify index.html, assemble the
 * IR from site.json, and build both emit artifacts through a single media
 * resolver (CDN base ?? IR sourceUrl) so plan, manifest, and validation all
 * agree on which media resolve. Pure + offline — no writes, no network. */
export function convertExport({
  html,
  siteJson,
}: {
  html: string;
  siteJson: unknown;
}): ConvertResult {
  const bands = parseGridBands(html);
  const mapConfig = extractMapConfig(html);
  const specs = classifyBands(bands, mapConfig ? { isMapMount: makeIsMapMount(mapConfig) } : {});
  const ir = assembleIR({ siteJson, htmls: [html] });

  const assetsById = new Map(ir.assets.map((a) => [a.id, a] as const));
  const sourceUrlById = new Map(ir.assets.map((a) => [a.id, a.sourceUrl] as const));
  const styles = blockStylesByIndex(siteJson);
  const deps: PresentationDeps = {
    resolveMedia: (m) => {
      const url = mediaUrl(m, sourceUrlById);
      if (!url) return null;
      const alt = assetsById.get(m.assetId)?.alt;
      const rm: RenderMedia = { kind: m.kind, url, ...(alt ? { alt } : {}) };
      return rm;
    },
    styleFor: (i) => styles.get(i),
    map: mapConfig ? mapRenderFromConfig(mapConfig) : null,
  };

  const plan = buildGridPlan(specs, ir);
  const presentation = buildPresentation(specs, deps);
  return { bands, specs, ir, mapConfig, plan, presentation };
}
```

> `Band` and `MapConfig` are already re-exported from `src/blux/grid/index.ts`. If `pnpm typecheck` reports `Band`/`MapConfig` are not exported there, add them to the `export type { … }` line in `src/blux/grid/index.ts` — but they are present as of plan 5.

- [ ] **Step 4: Refactor `blux.ts`'s `convert` action to call `convertExport`**

In `src/cli/commands/blux.ts`, replace the body of `if (action === "convert")` (from `const bands = parseGridBands(html);` through `const presentation = buildPresentation(specs, deps);`) with:

```ts
const { bands, mapConfig, plan, presentation, ir } = convertExport({ html, siteJson });
```

Keep the file-writing block that follows (`outDir`, `mkdir`, `writeFile` of `migration-plan.json`, `blux-presentation.json`, `theme.css`, `map-config.json`, and the summary) **unchanged** — it already reads `plan`, `presentation`, `ir`, `mapConfig`, `bands`. Then **delete** the standalone `function mapRenderFromConfig(c: MapConfig)` at the bottom of the file (now in `convert.ts`).

- [ ] **Step 5: Trim now-unused imports in `blux.ts`**

The `convert`-only imports move into `convert.ts`. Update the top of `src/cli/commands/blux.ts` so its blux-grid imports are exactly:

```ts
import { parseGridBands, extractMapConfig } from "../../blux/grid/index.js";
import { convertExport } from "../../blux/emit/convert.js";
import { rewriteManifestUrls } from "../../blux/emit/rewrite-manifest.js";
import type { Presentation } from "../../blux/emit/presentation.js";
import type { MigrationPlan } from "../../blux/emit/plan.js";
```

Remove the now-unused imports: `classifyBands`, `makeIsMapMount`, `MapConfig`, `buildGridPlan`, `mediaUrl`, `buildPresentation`, `PresentationDeps`, `RenderMedia`, `MapRenderConfig`, `blockStylesByIndex`. Keep everything else (`buildMigrationPlan`, `emitThemeCss`/`emitRolesCss`, `buildReviewManifest`, `validateCoverage`, `assembleIR`, node/glob imports). `parseGridBands`+`extractMapConfig` stay — the `grid` action still uses them. `Presentation` type stays — the `migrate` action's `rewriteManifestUrls` uses it.

- [ ] **Step 6: Run the convert test + the full convert golden + typecheck**

Run: `pnpm vitest run tests/blux/emit/convert.test.ts tests/blux/grid-convert-golden.test.ts tests/cli/blux-command.test.ts -t convert && pnpm typecheck`
Expected: PASS — the golden snapshots are unchanged (behavior-preserving refactor), typecheck 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/blux/emit/convert.ts src/cli/commands/blux.ts tests/blux/emit/convert.test.ts
git commit -m "refactor(blux): extract convertExport — shared offline pipeline for convert + validate"
```

---

## Task 4: Wire the fidelity report into `blux convert`

**Files:**

- Modify: `src/cli/commands/blux.ts` (convert action)
- Test: `tests/cli/blux-command.test.ts` (extend the `blux convert` describe block)

- [ ] **Step 1: Write the failing test**

In `tests/cli/blux-command.test.ts`, inside `describe("blux convert", …)`, add:

```ts
// GROUND TRUTH (verified against the real ~/Desktop/thePointe export): the
// real site.json declares the-pointe's video asset, so production converts
// FAITHFUL. But `minimalSite` is a STUB that omits that video (band 10). A
// <video> parses with an assetId+ext but NO CDN `base` (its url is on
// `<video src>`), so it resolves only via the IR asset's sourceUrl — which
// minimalSite can't supply → band 10's video drops → exactly one tree-drift.
// (Images resolve offline via their own data-base, independent of site.json.)
// The fully-resolved faithful path is proven at the module level by Task 6's
// grid-validate golden. This CLI test asserts convert REPORTS the gap yet
// still exits 0 — a generator never gates (Decision #6).
it("appends a layout-fidelity summary and writes layout-report.json (non-gating)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blux-convert-"));
  await writeFile(join(dir, "site.json"), JSON.stringify(minimalSite));
  await copyFile(
    fileURLToPath(new URL("../blux/fixtures/the-pointe-page-content.html", import.meta.url)),
    join(dir, "index.html"),
  );
  const res = await runBluxCommand("convert", dir, { cwd: dir });
  expect(res.code).toBe(0); // convert reports but never gates
  expect(res.output).toContain("layout fidelity:");
  const report = JSON.parse(await readFile(join(dir, "blux-out", "layout-report.json"), "utf-8"));
  expect(report.bands).toBe(16);
  expect(report.faithful).toBe(false);
  expect(report.findings.some((f) => f.kind === "tree-drift" && f.band === 10)).toBe(true);
});
```

> Ensure the test file imports what it needs at the top: `copyFile`, `readFile`, `writeFile` from `node:fs/promises`; `fileURLToPath` from `node:url`; `minimalSite` from `../blux/fixtures/minimal-site.js`. Most are already imported by neighboring tests — add only the missing ones.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/cli/blux-command.test.ts -t "layout-fidelity summary"`
Expected: FAIL — no `layout-report.json`, no "layout fidelity" in output.

- [ ] **Step 3: Wire it in**

In `src/cli/commands/blux.ts`, inside the `convert` action, add the import usage. At the top imports add:

```ts
import { validateLayout, formatLayoutReport } from "../../blux/emit/validate-layout.js";
```

Then, in the convert action, **after** the existing `writeFile(join(outDir, "blux-presentation.json"), …)` (and the map-config write), before building the return `output`, add:

```ts
const layout = validateLayout(specs, presentation);
await writeFile(join(outDir, "layout-report.json"), JSON.stringify(layout, null, 2) + "\n");
```

`specs` is available from the `convertExport` destructure — add `specs` to it: `const { bands, mapConfig, plan, presentation, ir, specs } = convertExport({ html, siteJson });`.

Change the return to append the fidelity summary:

```ts
const sliceCount = (plan.documents[0]?.data.slices as unknown[] | undefined)?.length ?? 0;
return {
  output:
    `Converted ${bands.length} bands → ${outDir} ` +
    `(${Object.keys(presentation.bands).length} manifest bands, ${sliceCount} slices` +
    (mapConfig ? ", map config extracted" : "") +
    ")\n" +
    formatLayoutReport(layout),
  code: 0,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/cli/blux-command.test.ts -t convert`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/blux.ts tests/cli/blux-command.test.ts
git commit -m "feat(blux): convert appends layout-fidelity summary + writes layout-report.json"
```

---

## Task 5: Rework `blux validate` — offline layout gate (+ `--against` coverage layer)

**Files:**

- Modify: `src/cli/commands/blux.ts` (validate action)
- Test: `tests/cli/blux-command.test.ts` (rewrite the `blux validate` describe block)

**Behavior:** `blux validate <dir>` now runs the **offline layout gate** by default (reads `index.html` + `site.json`, runs `convertExport` → `validateLayout`), exiting **1** on findings, **0** when faithful. `--against <render>` **additionally** runs the existing content-coverage check and appends it (coverage stays informational — it never flips a faithful layout to a non-zero exit, preserving the old code-0 coverage behavior). Error ordering (so the existing `--against` error tests keep their `code:1` + `"against"` assertions): (1) read `index.html`; (2) if `--against`, resolve the render (fetch/read) and hard-fail `code:1` on error; (3) read `site.json`; (4) `convertExport` + `validateLayout`; (5) if a render was resolved, append coverage; (6) `code = layout.faithful ? 0 : 1`.

- [ ] **Step 1: Rewrite the `blux validate` tests**

Replace the entire `describe("blux validate", …)` block in `tests/cli/blux-command.test.ts` with:

```ts
describe("blux validate", () => {
  const writeMinimalExport = async (dir: string) => {
    await writeFile(join(dir, "site.json"), JSON.stringify(minimalSite));
    await writeFile(join(dir, "index.html"), minimalHtml);
  };
  const writePointeExport = async (dir: string) => {
    await writeFile(join(dir, "site.json"), JSON.stringify(minimalSite));
    await copyFile(
      fileURLToPath(new URL("../blux/fixtures/the-pointe-page-content.html", import.meta.url)),
      join(dir, "index.html"),
    );
  };

  it("exits 0 on a vacuously-faithful export (no bands, no --against)", async () => {
    // minimalHtml has no grid bands → 0 specs → vacuously faithful. Proves the
    // faithful exit-0 path + that the gate runs offline with no --against.
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    await writeMinimalExport(dir);
    const r = await runBluxCommand("validate", dir, {});
    expect(r.code).toBe(0);
    expect(r.output).toContain("layout fidelity: FAITHFUL");
  });

  it("exits 1 and names the unresolvable band when the gate finds drift", async () => {
    // the-pointe page + the `minimalSite` STUB (which omits the-pointe's video
    // asset) → band 10's <video> can't resolve (no CDN base, no IR sourceUrl)
    // → exactly one tree-drift finding → the gate exits 1 (see the convert
    // test's GROUND TRUTH note). A realistic "one asset missing" drift case.
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    await writePointeExport(dir);
    const r = await runBluxCommand("validate", dir, {});
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/finding\(s\)/);
    expect(r.output).toContain("band 10");
  });

  it("layers content coverage on top when --against is given", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    await writeMinimalExport(dir);
    const renderedPath = join(dir, "rendered.html");
    await writeFile(renderedPath, "<html><body><p>Intro copy. About us.</p></body></html>");
    const r = await runBluxCommand("validate", dir, { against: renderedPath });
    expect(r.code).toBe(0);
    expect(r.output).toContain("layout fidelity");
    expect(r.output).toContain("content coverage");
  });

  it("fails cleanly when index.html is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    const r = await runBluxCommand("validate", dir, {});
    expect(r.code).toBe(1);
    expect(r.output).toContain("index.html");
  });

  it("fails cleanly when the --against file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    await writeMinimalExport(dir);
    const r = await runBluxCommand("validate", dir, { against: join(dir, "does-not-exist.html") });
    expect(r.code).toBe(1);
    expect(r.output).toContain("against");
  });

  it("fails cleanly when the --against URL returns a non-OK status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-validate-"));
    await writeMinimalExport(dir);
    const r = await runBluxCommand("validate", dir, {
      against: "https://example.com/typo",
      fetchImpl: (async () => new Response("nope", { status: 404 })) as typeof fetch,
    });
    expect(r.code).toBe(1);
    expect(r.output).toContain("against");
  });
});
```

> Add `minimalHtml` to the existing `minimal-site` import at the top of the file if not already imported.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/cli/blux-command.test.ts -t validate`
Expected: FAIL — the current validate action requires `--against` and never runs a layout gate.

- [ ] **Step 3: Rewrite the `validate` action**

In `src/cli/commands/blux.ts`, replace the entire `if (action === "validate") { … }` block with:

```ts
if (action === "validate") {
  if (!dir) return { output: "blux validate needs a Blux export directory.", code: 1 };
  let exportHtml: string;
  try {
    exportHtml = await readFile(join(dir, "index.html"), "utf-8");
  } catch (err) {
    return { output: `could not read index.html in ${dir}: ${(err as Error).message}`, code: 1 };
  }

  // Resolve the optional --against render FIRST so a bad target hard-fails
  // before we spend the convert pipeline (and so its error message wins).
  let rendered: string | null = null;
  if (opts.against) {
    try {
      if (/^https?:\/\//.test(opts.against)) {
        const res = await (opts.fetchImpl ?? fetch)(opts.against);
        if (!res.ok) {
          return {
            output: `could not fetch --against ${opts.against}: HTTP ${res.status}`,
            code: 1,
          };
        }
        rendered = await res.text();
      } else {
        rendered = await readFile(opts.against, "utf-8");
      }
    } catch (err) {
      return {
        output: `could not read --against ${opts.against}: ${(err as Error).message}`,
        code: 1,
      };
    }
  }

  let siteJson: unknown;
  try {
    siteJson = JSON.parse(await readFile(join(dir, "site.json"), "utf-8"));
  } catch (err) {
    return { output: `could not read site.json in ${dir}: ${(err as Error).message}`, code: 1 };
  }

  const { specs, presentation } = convertExport({ html: exportHtml, siteJson });
  const layout = validateLayout(specs, presentation);
  const lines = [formatLayoutReport(layout)];

  if (rendered !== null) {
    const report = validateCoverage(exportHtml, rendered);
    lines.push(
      "",
      `content coverage: ${report.covered}/${report.total} runs (${report.coveragePct}%)`,
      ...(report.missing.length
        ? [
            "missing runs — export text absent from the render:",
            ...report.missing.map((m) => `  - ${m}`),
          ]
        : ["all export text runs present in the render"]),
    );
  }

  return { output: lines.join("\n"), code: layout.faithful ? 0 : 1 };
}
```

Update the `runBluxCommand` doc comment's `validate:` line to: `validate: offline layout-fidelity gate (parse+classify index.html, diff the emitted manifest vs the source answer key) — exits non-zero on drift. --against <file|url> additionally runs content coverage of a rendered page.`

- [ ] **Step 4: Run the validate tests + full CLI suite + typecheck**

Run: `pnpm vitest run tests/cli/blux-command.test.ts && pnpm typecheck`
Expected: PASS — all validate + convert + emit cases; typecheck 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/blux.ts tests/cli/blux-command.test.ts
git commit -m "feat(blux): validate runs the offline layout gate by default (--against adds coverage)"
```

---

## Task 6: Fidelity golden — the-pointe converts with zero findings

**Files:**

- Create: `tests/blux/grid-validate-golden.test.ts`

- [ ] **Step 1: Write the golden test**

Create `tests/blux/grid-validate-golden.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to generate + verify the snapshot**

Run: `pnpm vitest run tests/blux/grid-validate-golden.test.ts`
Expected: PASS — first run writes the `rows` snapshot. **Inspect the written `tests/blux/__snapshots__/grid-validate-golden.test.ts.snap`**: it must show 16 rows, all `"ok": true`, with the 10 Grid rows carrying full `row[...]`/`stack[...]` signatures and the smart-slice rows showing `hero`/`title_band`/`gallery(3)`/`split(right,40)`. If any row is `ok:false`, that is a real fidelity bug in the emit chain — stop and investigate, do not accept the snapshot.

- [ ] **Step 3: Commit**

```bash
git add tests/blux/grid-validate-golden.test.ts tests/blux/__snapshots__/grid-validate-golden.test.ts.snap
git commit -m "test(blux): grid-validate golden — the-pointe converts with zero layout findings"
```

---

## Task 7: Full gate + final review

**Files:** none (verification only)

- [ ] **Step 1: Run the full local gate**

Run: `pnpm lint && pnpm typecheck && pnpm test:dist 2>/dev/null; pnpm vitest run tests/blux tests/cli && pnpm build`
Expected: lint clean, typecheck 0 errors, all blux + CLI tests green, build succeeds. (If `pnpm lint` flags this markdown plan's fenced code, run `pnpm exec prettier --write docs/superpowers/plans/2026-07-11-blux-grid-plan6-validate.md --plugin prettier-plugin-svelte`.)

- [ ] **Step 2: Real-run check against the actual the-pointe export (if present locally)**

If `~/Desktop/thePointe` exists, run: `pnpm blux validate ~/Desktop/thePointe` (or `pnpm tsx src/cli/index.ts blux validate ~/Desktop/thePointe`). Expected: a `layout fidelity:` summary. The real export **has a map** (band ~14) and real CDN `data-base` on media, so it should read `FAITHFUL` (exit 0) with the map row present. Note any findings — they are genuine gaps to report at operator sign-off, not test failures.

> Running the CLI via `tsx` needs `dangerouslyDisableSandbox: true` (tsx opens a unix IPC socket the sandbox blocks). No network is used — `convert`/`validate` are fully offline.

- [ ] **Step 3: Dispatch the final whole-branch code review** (subagent-driven-development's final step) covering: `sigOf` exhaustiveness vs `grid/signature.ts`; the non-tautology argument (spec.root vs manifest.tree); no behavior drift in the `convertExport` refactor (convert golden unchanged); validate error-ordering correctness; strict-mode conditional spreads.

---

## Decisions (rationale — read before executing)

1. **Offline manifest diff, not a rendered-DOM diff** (operator-confirmed 2026-07-11). The spec's literal "rendered converted page" (Playwright DOM → signature) is deferred to plan 7's render-verify, which already has a screenshot harness. Plan 5's manifest is a faithful structural proxy of the render (`Grid.svelte` walks `tree` verbatim), so the check is deterministic, browserless, and CI-gateable. This is the reddoor-maintenance half of the roadmap's "6) validate / 7) migrate + verify" split.

2. **Source side is `spec.root` (post-classify), not `band.root` (raw parse).** classify's only rewrite is map `raw`→`widget:map`; using the classified root means the deliberate map upgrade is not flagged as drift. Band→spec is already gated by `grid-classify-golden`; plan 6 gates spec→manifest; together they cover the whole band→manifest chain the-pointe renders. This is why the check is not a same-value round-trip: `renderNode` drops unresolved media, so `sigOf(spec.root) !== sigOf(manifest.tree)` exactly when media dropped or a serializer bug reshaped the tree.

3. **Grid bands get a structural signature diff; smart slices get a payload-completeness check.** Hero/TitleBand/RichText intentionally carry no manifest tree (text is in the page doc, gated by `grid-slice.test.ts`), so re-checking their structure would false-positive. Gallery/Split/MediaFull/Video/background/map are checked for presence/count — the only fidelity they can lose in the manifest.

4. **A new `sigOf`, not a reuse of `gridSignature`.** `gridSignature`/`sig` use `token.raw` (human-readable, feeds existing snapshots) — a source token and its `raw`-less render twin would never match. `sigOf` canonicalizes tokens (`tokKey`, no `raw`) so both sides compare equal, and takes `Node | RenderNode` (their kinds/fields align) so one function walks both. `grid/signature.ts` is left untouched.

5. **`convertExport` extraction (Task 3) is a prerequisite, not scope creep.** `validate` must build the same manifest `convert` writes, from the same single media resolver, or the gate would disagree with the deploy. Extracting the pipeline once removes that drift risk and is behavior-preserving (convert golden unchanged).

6. **`convert` reports but does not gate (exit 0); `validate` gates (exit 1 on findings).** `convert` is a generator — it always writes its artifacts and shows the fidelity summary as guidance. `blux validate` is the gate an operator (or CI) runs to get a non-zero exit on drift. Content coverage (`--against`) stays informational (never flips exit), preserving its prior code-0 behavior.

## Self-review

- **Spec coverage:** spec step "[4] validate: … layout-signature check vs the answer key" → Tasks 1/2/5/6. Content coverage retained as the `--against` layer (Task 5). ✓
- **Placeholder scan:** every code + test step shows full content; every run step has an exact command + expected result. ✓
- **Type consistency:** `LayoutReport{bands,gridBands,faithful,findings,rows}`, `LayoutFinding` (5 kinds), `sigOf(Node|RenderNode)`, `validateLayout(specs,presentation)`, `formatLayoutReport(report)`, `convertExport({html,siteJson})→ConvertResult{bands,specs,ir,mapConfig,plan,presentation}`, `mapRenderFromConfig` — names used identically across tasks. `hasMapWidget` exported in Task 1, consumed in Task 1's `validateLayout`. ✓
