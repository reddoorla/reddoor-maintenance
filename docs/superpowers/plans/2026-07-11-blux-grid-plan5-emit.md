# Blux Grid Plan 5 — Emit Paths (Prismic page doc + presentation manifest + map) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the classified grid IR (`SliceSpec[]` from plan 2) into the two deploy artifacts the-pointe's render side already expects — a Prismic **page document** (CMS-editable text, keyed by band index) and a **presentation manifest** (`blux-presentation.json`: layout tree + media + map + block styles, keyed by band index) — behind a new offline, deterministic `blux convert` action, and fix the parser so the co-located map mount survives.

**Architecture:** `blux convert <export>` reads `index.html` (structure) + `site.json` (assets/theme/block-styles). It parses bands (`parseGridBands`), extracts the map config (`extractMapConfig`), classifies (`classifyBands` with `makeIsMapMount`), then runs two pure builders: `buildGridPlan` → `MigrationPlan` (page doc with per-band text slices, reusing the existing `plan.ts` markers so the **unchanged** `run-migration.ts` pushes it) and `buildPresentation` → `Presentation` (the manifest, media resolved to absolute URLs via an injected resolver). The render side (`presentation.ts`, plans 3–4) is the **fixed target**: emit conforms to it, never the reverse. A one-line parser fix makes Blux custom-code embeds (`[data-exec]`, the map mount) survive as `raw` leaves instead of being peeled to nothing.

**Tech Stack:** TypeScript (strict: `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), `tsx`, `node-html-parser`, Vitest (snapshot goldens), the existing `src/blux/emit/` markers + `run-migration.ts`. No new runtime deps. No network at emit time.

---

## Context the executor must load first

Read these before Task 1 — they define the contracts this plan joins:

- **Design spec:** `docs/superpowers/specs/2026-07-08-blux-faithful-grid-slices-design.md` (the multi-plan sequence; this is spec step 4's "three emit paths").
- **Source IR (input):** `src/blux/grid/types.ts` (`Band`, `Node`, `Cell`, `GridToken` — note `GridToken` has a `raw: string` field; `Media = {kind, assetId, ext?}`), `src/blux/grid/slice-spec.ts` (the `SliceSpec` union), `src/blux/grid/classify-band.ts` (`classifyBands(bands, {isMapMount})`; exported helpers `collectMedia`, `collectText`, `topRow`, `isEmptyRaw`), `src/blux/grid/extract-map.ts` (`extractMapConfig(html) → MapConfig|null`, `makeIsMapMount(cfg)`, `MapConfig`).
- **Reused emit plumbing:** `src/blux/emit/plan.ts` (`MigrationPlan`, `PlanSlice`, `PlanDocument`, `PlanCustomType`, `PlanAsset`, `richText()`, `assetRef()` markers), `src/blux/emit/run-migration.ts` (unchanged — driven purely by `MigrationPlan`), `src/blux/emit/theme.ts` (`emitThemeCss`, `emitRolesCss`), `src/blux/emit/coerce-html.ts` (`coerceHeadingHtml`, `demoteHeadingsHtml`), `src/blux/assemble.ts` (`assembleIR({siteJson, htmls}) → SiteIR`; gives `ir.assets`, `ir.theme`, `ir.pages`), `src/blux/normalize.ts` (`cleanCssValue` — reuse for block styles).
- **Render target (the fixed contract, in a DIFFERENT repo):** `~/Documents/GitHub/the-pointe` `origin/main` `src/lib/blux/presentation.ts` — `BandPresentation`, `RenderMedia`, `RenderNode`, `RenderCell`, `GridToken` (NO `raw`), `MapRenderConfig`, `Presentation = {bands: Record<string, BandPresentation>}`. Read it via `git -C ~/Documents/GitHub/the-pointe show origin/main:src/lib/blux/presentation.ts`. **Do not edit the-pointe in this plan** — that is plan 7.

**The render contract, transcribed** (target shapes emit must produce; keep in sync if the-pointe changes):

```ts
// the-pointe src/lib/blux/presentation.ts  (READ-ONLY REFERENCE)
type RenderMedia = { kind: "image" | "video"; url: string; alt?: string };
type GridToken   = { cols: number | "any"; ratio?: number; sized?: number };   // NB: no `raw`
type RenderNode =
  | { kind: "row";    cells: RenderCell[] }
  | { kind: "stack";  children: RenderNode[] }
  | { kind: "heading"; level: number; html: string; role?: string }
  | { kind: "body";    html: string; role?: string }
  | { kind: "subtitle"; text: string; role?: string }
  | { kind: "media";  media: RenderMedia }
  | { kind: "raw";    html: string }
  | { kind: "widget"; widget: { type: "map" } };
type RenderCell = { token: GridToken; node: RenderNode };
type MapRenderConfig = {
  mid: string;
  layers: { name: string; lid: string; initiallyVisible: boolean; preserveViewport: boolean }[];
  toggles: { label: string; layers: string[] }[];
  styles: unknown[];
  center?: { lat: number; lng: number };
  zoom?: number;
};
type BandPresentation = {
  style?: Record<string, string>;
  background?: RenderMedia;
  tree?: RenderNode;
  split?: { mediaSide: "left" | "right"; ratio: number; media: RenderMedia; text: RenderNode };
  gallery?: RenderMedia[];
  media?: RenderMedia;
  map?: MapRenderConfig;
};
type Presentation = { bands: Record<string, BandPresentation> };
```

**Locked design decisions for this plan** (rationale in the "Decisions" section at the bottom — read it):

1. **Media is Prismic-hosted (Tucker's decision), two-phase.** `convert` (offline) writes the manifest with the CDN URLs (`data-base` + uuid, renders immediately) **and** populates `plan.assets`. `migrate` (online, creds-gated) uploads those assets to the Prismic library, then **rewrites** `blux-presentation.json`'s media URLs to the uploaded Prismic URLs (durable — survives the client dropping Blux). No API key or network at `convert` time.
2. **All media lives in the manifest**, matching the shipped render contract (gallery/media_full/split/hero-bg/grid-tree media all read from `bands[i]`, not Prismic Image fields). The Prismic page doc carries **text + band-index numbers only** — no Image fields. The uploaded assets are library assets the manifest points at by URL, not doc-field references (so media is Prismic-hosted and durable, but not individually CMS-editable — accepted per spec decision #4).
3. **Text placement:** heading/subtitle/body for `hero` (band variation) and `title_band`, and `content` for `rich_text`, go into the **page doc**. Split text goes into the **manifest** (`split.text`); the split_feature `body` override is left empty (manifest renders it) — CMS-editability of split text is a nice-to-have.
4. **Band-index key:** `SpecBase.index` (== `Band.index`, the source `page-block-N` number) is used **identically** for the manifest key `String(index)` and the doc `primary.band` Number. They must match or `bandFor` returns null.
5. **New `convert` CLI action** (parse → classify → emit); `grid` stays inspection-only; `migrate` is reused unchanged. `convert` writes `migration-plan.json`, `blux-presentation.json`, `map-config.json`, `theme.css`.
6. **Block `style` source:** `site.json` block styles (`b.styles` cleaned by `cleanCssValue`), joined to grid bands by array-position/render-order with a loud contiguity assertion — NOT a new CSS parser.
7. **Map render wiring** (the-pointe `Grid.svelte` mounting a real map for a co-located `widget:map`) is **plan 7**, not here. Plan 5 only *attaches* the `map` payload to the correct band in the manifest.

---

## File Structure

**Create (reddoor-maintenance):**
- `src/blux/emit/grid-slice.ts` — `sliceSpecToPlanSlice(spec): PlanSlice`. Pure `SliceSpec` → Prismic page-doc slice (text + band number). Replaces the archetype `slices.ts` for the grid path.
- `src/blux/emit/grid-plan.ts` — `buildGridPlan(specs, ir): MigrationPlan`. Assembles the page `PlanDocument` (title + slices), carries reused `customTypes` (collections) and empty `assets`.
- `src/blux/emit/block-styles.ts` — `blockStylesByIndex(siteJson): Map<number, Record<string, string>>`. Reuses `cleanCssValue`.
- `src/blux/emit/presentation.ts` — `buildPresentation(specs, deps): Presentation`. The manifest builder: per-variant `BandPresentation`, node-tree → `RenderNode` serialization (strip `GridToken.raw`, resolve `Media`), `MapConfig` → `MapRenderConfig`. Media/style come via injected `deps` (offline + testable).
- Tests: `tests/blux/emit/grid-slice.test.ts`, `tests/blux/emit/grid-plan.test.ts`, `tests/blux/emit/block-styles.test.ts`, `tests/blux/emit/presentation.test.ts`, plus a fidelity golden `tests/blux/grid-convert-golden.test.ts` + its snapshot.

**Modify:**
- `src/blux/grid/parse-grid.ts` — treat `[data-exec]` embeds as `raw` leaves (Task 1).
- `src/cli/commands/blux.ts` — add the `convert` action (Task 6).
- `src/cli/bin.ts` — extend the `blux` action list/description to include `convert` (Task 6).
- `tests/blux/__snapshots__/grid-golden.test.ts.snap` — band 14 line updates (Task 1).
- `tests/cli/blux-command.test.ts` — add `describe("blux convert")` (Task 7).
- `.changeset/` — add a changeset (Task 8).

**Do NOT touch:** `run-migration.ts`, `plan.ts`, `theme.ts`, `coerce-html.ts`, `custom-types.ts`, the archetype `migration-plan.ts`/`slices.ts`/`flatten.ts` (kept for the legacy `emit`), or anything in `the-pointe`.

---

## Task 1: Parser — Blux custom-code embeds (`[data-exec]`) survive as `raw` leaves

**Why:** On the real page the map mount (`<div id="custom-element0" data-exec=…>`) is class-less, so `isStructural` (class/token-based) returns false and `collectStructuralChildren` peels the whole subtree to nothing — the map is silently dropped, even from the Grid fallback. Making the `[data-exec]` wrapper a `raw` leaf preserves it; map recognition stays the classifier's job (`isMapMount`), so the parser remains map-agnostic.

**Files:**
- Modify: `src/blux/grid/parse-grid.ts` (`isStructural` ~lines 24–25; `parseNode` before its final `return parseContainer(el)` ~line 66)
- Test: `tests/blux/grid-parse.test.ts` (add cases)
- Snapshot: `tests/blux/__snapshots__/grid-golden.test.ts.snap` (band 14 line regenerates)

- [ ] **Step 1: Write the failing test** — append to `tests/blux/grid-parse.test.ts`:

```ts
import { parseGridBands, parseNode } from "../../src/blux/grid/index.js";
import { parse } from "node-html-parser";

describe("data-exec custom-code embeds", () => {
  it("preserves a data-exec embed as a single raw leaf (outerHTML)", () => {
    const html = `<div id="page-content"><section class="blocks0" id="page-block-0">
      <div class="block-content">
        <div id="custom-element0" data-exec="custom_abc">
          <div id="burbank_map" style="height:600px">map loading...</div>
        </div>
      </div></section></div>`;
    const [band] = parseGridBands(html);
    expect(band?.root).toEqual({
      kind: "raw",
      html: `<div id="custom-element0" data-exec="custom_abc">
          <div id="burbank_map" style="height:600px">map loading...</div>
        </div>`,
    });
  });

  it("keeps a data-exec embed alongside a sibling grid as a stack[raw,row]", () => {
    const html = `<div id="page-content"><section class="blocks0" id="page-block-0">
      <div class="block-content">
        <div id="custom-element0" data-exec="x"><div id="burbank_map">m</div></div>
        <div class="block-grid-container cagrid" data-columns="1">
          <div class="block-subcontent cagriditem top grid-1 "><p class="block-body text2">hi</p></div>
        </div>
      </div></section></div>`;
    const [band] = parseGridBands(html);
    expect(band?.root.kind).toBe("stack");
    const stack = band?.root as { kind: "stack"; children: { kind: string }[] };
    expect(stack.children[0]?.kind).toBe("raw");
    expect(stack.children[1]?.kind).toBe("row");
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm vitest run tests/blux/grid-parse.test.ts -t "data-exec"`
Expected: FAIL — first case yields `raw` with empty/peeled html or a container, not the outerHTML leaf.

- [ ] **Step 3: Implement** — in `src/blux/grid/parse-grid.ts`:

Add the `data-exec` clause to `isStructural` (so the wrapper stops being peeled):

```ts
const isStructural = (el: HTMLElement): boolean =>
  isLeafElement(el) ||
  el.hasAttribute("data-exec") ||           // Blux custom-code embed (e.g. map mount)
  hasClass(el, "cagrid") ||
  parseGridToken(el.classNames) !== null;
```

And emit it as a `raw` leaf in `parseNode`, immediately before the final `return parseContainer(el);`:

```ts
if (el.hasAttribute("data-exec")) {
  // Custom-code embed (map, third-party widget). Keep the whole subtree —
  // including id="burbank_map" and any inline initMap/KmlLayer scripts — so
  // extract-map can read it and Grid.svelte can render it verbatim.
  return { kind: "raw", html: el.outerHTML };
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm vitest run tests/blux/grid-parse.test.ts -t "data-exec"`
Expected: PASS (both cases).

- [ ] **Step 5: Regenerate + eyeball the parse golden**

Run: `pnpm vitest run tests/blux/grid-golden.test.ts -u`
Then confirm the diff: **only band 14** changes, from a bare `row[...]` to `stack[raw,row[grid-1:...]]`, and `bands.length` is still 16. Run `git diff tests/blux/__snapshots__/grid-golden.test.ts.snap` and verify exactly one line changed (the band 14 line now begins `stack[raw,row[`). If any other band changed, STOP — the `data-exec` clause matched something it shouldn't.

- [ ] **Step 6: Verify the classify golden is untouched**

Run: `pnpm vitest run tests/blux/grid-classify-golden.test.ts`
Expected: PASS with **no** snapshot change (band 14 stays `"14 Grid"` — the map `raw` lives inside `GridSpec.root`, invisible to the kind-only summary). If it wants an update, investigate before accepting.

- [ ] **Step 7: Commit**

```bash
git add src/blux/grid/parse-grid.ts tests/blux/grid-parse.test.ts tests/blux/__snapshots__/grid-golden.test.ts.snap
git commit -m "fix(blux/grid): data-exec embeds survive as raw leaves (map mount peel)"
```

---

## Task 1B: Parser — capture `data-base` so media resolves to a working URL offline

**Why:** The manifest needs an absolute `RenderMedia.url`. The rendered HTML already carries the exact working CDN URL per image: `data-base` (full prefix, e.g. `https://d3syaxnfm3oj0e.cloudfront.net/<folder>/`) + `data-media` (`<uuid>.<ext>`). The current parser drops `data-base`, so emit would have no URL without a network probe. Capturing it into `Media.base` makes `convert` fully offline and deterministic (no probe), using the same URL the live page uses. `alt` still comes from `site.json` (`ir.assets`) at emit time — the HTML has none.

**Files:**
- Modify: `src/blux/grid/types.ts` (add `base?` to `Media`)
- Modify: `src/blux/grid/leaf.ts` (`mediaFromElement` reads `data-base`)
- Modify: `src/blux/grid/parse-grid.ts` (`bandBackground` reads `data-base` too — band backgrounds are `camediaload` divs)
- Test: `tests/blux/grid-leaf.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tests/blux/grid-leaf.test.ts`:

```ts
import { mediaFromElement } from "../../src/blux/grid/leaf.js";
import { parse } from "node-html-parser";

it("captures data-base as Media.base for a camediaload image", () => {
  const el = parse(
    `<div class="ib img imgfit camediaload" data-ext="png" data-base="https://cdn.example/folder/" data-media="abc123.png"></div>`,
  ).firstChild as never;
  expect(mediaFromElement(el)).toEqual({ kind: "image", assetId: "abc123", ext: "png", base: "https://cdn.example/folder/" });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm vitest run tests/blux/grid-leaf.test.ts -t "data-base"`
Expected: FAIL — result has no `base` key.

- [ ] **Step 3: Implement**

In `src/blux/grid/types.ts`, extend `Media` (keep it optional so nothing else breaks):

```ts
export type Media = { kind: "image" | "video"; assetId: string; ext?: string; base?: string };
```

In `src/blux/grid/leaf.ts`, in `mediaFromElement`'s image branch, read `data-base` and spread it conditionally:

```ts
    if (rawId) {
      const ext = img.getAttribute("data-ext") ?? undefined;
      const base = img.getAttribute("data-base") ?? undefined;
      return {
        kind: "image",
        assetId: stripAssetExt(rawId, ext),
        ...(ext ? { ext } : {}),
        ...(base ? { base } : {}),
      };
    }
```

In `src/blux/grid/parse-grid.ts`, apply the same `data-base` capture inside `bandBackground` (the `camediaload` band-wrapper reader ~line 92) so band backgrounds also carry `base`. If `bandBackground` already delegates to `mediaFromElement`, this is free; otherwise add the identical `...(base ? { base } : {})` spread there.

- [ ] **Step 4: Run — verify it passes + no golden drift**

Run: `pnpm vitest run tests/blux/grid-leaf.test.ts tests/blux/grid-golden.test.ts tests/blux/grid-classify-golden.test.ts`
Expected: PASS. The goldens' `sig()`/summary print media as `media:image` (kind only), so `base` does not move them. If `grid-parse.test.ts` has an exact `toEqual` on a media node, update that expectation to include `base` where the fixture carries `data-base`.

- [ ] **Step 5: Commit**

```bash
git add src/blux/grid/types.ts src/blux/grid/leaf.ts src/blux/grid/parse-grid.ts tests/blux/grid-leaf.test.ts
git commit -m "feat(blux/grid): capture data-base into Media.base for offline URL resolution"
```

---

## Task 2: `sliceSpecToPlanSlice` — SliceSpec → Prismic page-doc slice (text + band number)

**Why:** The page doc carries only CMS-editable text and the band index; everything visual is in the manifest (Decision 2/3). This mapper is table-driven and pure.

**Files:**
- Create: `src/blux/emit/grid-slice.ts`
- Test: `tests/blux/emit/grid-slice.test.ts`

Reference — the page-doc field contract per slice (from the-pointe `model.json`s; verified in the render-contract scout):

| SliceSpec | slice_type | variation | primary fields |
| --- | --- | --- | --- |
| Hero | `hero` | `band` | `band` (Number), `heading` (Text), `subtitle` (Text), `body` (Text) |
| TitleBand | `title_band` | `default` | `band`, `heading` (Text), `subtitle` (Text) |
| RichText | `rich_text` | `default` | `content` (StructuredText = `richText(html)`), `band` (Number) |
| SplitFeature | `split_feature` | `default` | `band` |
| Gallery | `gallery` | `default` | `band` |
| MediaFull | `media_full` | `default` | `band` |
| VideoFeature | `media_full` | `default` | `band` |
| LocationMap | `location_map` | `default` | `band` |
| Grid | `grid_band` | `default` | `band` |

Text fields are **plain strings** (omit when absent); StructuredText uses the `richText()` marker. `items` is always `[]`.

- [ ] **Step 1: Write the failing test** — `tests/blux/emit/grid-slice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sliceSpecToPlanSlice } from "../../../src/blux/emit/grid-slice.js";
import type { SliceSpec } from "../../../src/blux/grid/index.js";

const base = { index: 3 };

describe("sliceSpecToPlanSlice", () => {
  it("maps Hero to hero/band with Text heading+subtitle+body (tags stripped)", () => {
    const spec: SliceSpec = { ...base, slice: "Hero", heading: "THE OUTDOORS", subtitle: "eyebrow", body: "<p>Green <em>space</em>.</p>" };
    expect(sliceSpecToPlanSlice(spec)).toEqual({
      slice_type: "hero", variation: "band", items: [],
      primary: { band: 3, heading: "THE OUTDOORS", subtitle: "eyebrow", body: "Green space." },
    });
  });

  it("maps TitleBand to title_band/default", () => {
    const spec: SliceSpec = { ...base, slice: "TitleBand", heading: "THE SPACE" };
    expect(sliceSpecToPlanSlice(spec)).toEqual({
      slice_type: "title_band", variation: "default", items: [], primary: { band: 3, heading: "THE SPACE" },
    });
  });

  it("maps RichText to rich_text/default with a richtext marker", () => {
    const spec: SliceSpec = { ...base, slice: "RichText", html: "<p>Body copy.</p>" };
    expect(sliceSpecToPlanSlice(spec)).toEqual({
      slice_type: "rich_text", variation: "default", items: [],
      primary: { content: { __richtext_html: "<p>Body copy.</p>" }, band: 3 },
    });
  });

  it("maps VideoFeature onto media_full (band only)", () => {
    const spec: SliceSpec = { ...base, slice: "VideoFeature", media: { kind: "video", assetId: "u" } };
    expect(sliceSpecToPlanSlice(spec)).toEqual({ slice_type: "media_full", variation: "default", items: [], primary: { band: 3 } });
  });

  it.each([
    ["SplitFeature", "split_feature"], ["Gallery", "gallery"], ["MediaFull", "media_full"],
    ["LocationMap", "location_map"], ["Grid", "grid_band"],
  ] as const)("maps %s to %s/default with band only", (slice, slice_type) => {
    const spec = { ...base, slice, ratio: 40, mediaSide: "right", media: { kind: "image", assetId: "u" }, text: { kind: "body", html: "x" }, root: { kind: "row", cells: [] } } as unknown as SliceSpec;
    const out = sliceSpecToPlanSlice({ ...spec, slice } as SliceSpec);
    expect(out.slice_type).toBe(slice_type);
    expect(out.variation).toBe("default");
    expect(out.primary).toEqual({ band: 3 });
    expect(out.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm vitest run tests/blux/emit/grid-slice.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/blux/emit/grid-slice.ts`:

```ts
import type { SliceSpec } from "../grid/index.js";
import { type PlanSlice, richText } from "./plan.js";

/** Strip all tags → the plain text a Prismic "Text" (key-text) field holds. */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/** Map one classified band to its page-doc slice. Text + band index only —
 * media, layout, style and map all live in the presentation manifest. */
export function sliceSpecToPlanSlice(spec: SliceSpec): PlanSlice {
  switch (spec.slice) {
    case "Hero":
      return {
        slice_type: "hero", variation: "band", items: [],
        primary: {
          band: spec.index,
          ...(spec.heading ? { heading: spec.heading } : {}),
          ...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
          ...(spec.body ? { body: stripTags(spec.body) } : {}),
        },
      };
    case "TitleBand":
      return {
        slice_type: "title_band", variation: "default", items: [],
        primary: { band: spec.index, heading: spec.heading, ...(spec.subtitle ? { subtitle: spec.subtitle } : {}) },
      };
    case "RichText":
      return {
        slice_type: "rich_text", variation: "default", items: [],
        primary: { content: richText(spec.html), band: spec.index },
      };
    case "SplitFeature":
      return { slice_type: "split_feature", variation: "default", items: [], primary: { band: spec.index } };
    case "Gallery":
      return { slice_type: "gallery", variation: "default", items: [], primary: { band: spec.index } };
    case "MediaFull":
    case "VideoFeature":
      return { slice_type: "media_full", variation: "default", items: [], primary: { band: spec.index } };
    case "LocationMap":
      return { slice_type: "location_map", variation: "default", items: [], primary: { band: spec.index } };
    case "Grid":
      return { slice_type: "grid_band", variation: "default", items: [], primary: { band: spec.index } };
  }
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm vitest run tests/blux/emit/grid-slice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blux/emit/grid-slice.ts tests/blux/emit/grid-slice.test.ts
git commit -m "feat(blux/emit): sliceSpecToPlanSlice — grid slice → page-doc text slice"
```

---

## Task 3: `buildGridPlan` — SliceSpec[] + IR → MigrationPlan (page doc + assets to upload)

**Why:** Assemble the whole `MigrationPlan` the unchanged `run-migration.ts` consumes: a `page` document (`title` + `slices`, text only), reused custom types (collections), and — because media is Prismic-hosted (Tucker's decision) — a **populated `assets` list** of every image/video referenced by the manifest, so `runMigration` uploads them. The uploaded assets are library assets the manifest points at (they are not doc Image fields); the page doc stays text-only.

**Files:**
- Create: `src/blux/emit/grid-plan.ts` (`buildGridPlan` + `collectPlanAssets`)
- Test: `tests/blux/emit/grid-plan.test.ts`

Media lives in three places per spec: the band `background`, direct media fields (`Gallery.media[]`, `MediaFull`/`VideoFeature.media`, `SplitFeature.media`), and inside node trees (`SplitFeature.text`, `Grid.root`). Node-tree media is collected with the classifier's exported `collectMedia(node)`. The CDN URL is built from `Media.base` (Task 1B); `alt` comes from `ir.assets`.

- [ ] **Step 1: Write the failing test** — `tests/blux/emit/grid-plan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildGridPlan } from "../../../src/blux/emit/grid-plan.js";
import type { SliceSpec, Media } from "../../../src/blux/grid/index.js";
import type { SiteIR } from "../../../src/blux/ir.js";

const img = (id: string): Media => ({ kind: "image", assetId: id, ext: "png", base: "https://cdn/f/" });
const ir = {
  meta: {}, theme: {} as never, collections: [],
  assets: [{ id: "a", sourceUrl: "https://cdn/f/a.png", name: "a.png", mime: "image/png", alt: "Alt A" }],
  diagnostics: [],
  pages: [{ uid: "the-pointe", title: "The Pointe", description: "", sections: [] }],
} as unknown as SiteIR;

const specs: SliceSpec[] = [
  { index: 0, slice: "Hero", heading: "Hi", background: img("a") },
  { index: 1, slice: "Gallery", media: [img("a"), img("b")] },   // "a" dedups
  { index: 2, slice: "Grid", root: { kind: "row", cells: [{ token: { cols: 1, raw: "grid-1" }, node: { kind: "media", media: img("c") } }] } },
];

describe("buildGridPlan", () => {
  it("builds a page document with a heading1 title and one slice per band", () => {
    const plan = buildGridPlan(specs, ir);
    expect(plan.documents).toHaveLength(1);
    const doc = plan.documents[0]!;
    expect(doc.type).toBe("page");
    expect(doc.uid).toBe("the-pointe");
    expect(doc.data.title).toEqual({ __richtext_html: "<h1>The Pointe</h1>" });
    const slices = doc.data.slices as { slice_type: string; primary: { band: number } }[];
    expect(slices.map((s) => s.slice_type)).toEqual(["hero", "gallery", "grid_band"]);
    expect(slices.map((s) => s.primary.band)).toEqual([0, 1, 2]);
  });

  it("collects every referenced asset (deduped) with CDN url + alt for upload", () => {
    const plan = buildGridPlan(specs, ir);
    expect(plan.assets).toEqual([
      { id: "a", url: "https://cdn/f/a.png", alt: "Alt A" },
      { id: "b", url: "https://cdn/f/b.png", alt: "" },
      { id: "c", url: "https://cdn/f/c.png", alt: "" },
    ]);
    expect(Array.isArray(plan.customTypes)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm vitest run tests/blux/emit/grid-plan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/blux/emit/grid-plan.ts`:

```ts
import { type SliceSpec, type Media, collectMedia } from "../grid/index.js";
import type { SiteIR } from "../ir.js";
import { buildCustomType } from "./custom-types.js";
import { sliceSpecToPlanSlice } from "./grid-slice.js";
import { type MigrationPlan, type PlanAsset, type PlanDocument, richText } from "./plan.js";

/** Build the CDN url for a media from its parser-captured base + uuid + ext. */
function cdnUrl(m: Media): string | null {
  return m.base ? `${m.base}${m.assetId}${m.ext ? `.${m.ext}` : ""}` : null;
}

/** Every Media referenced across all specs: band backgrounds, direct media
 * fields, and media inside node trees (SplitFeature.text / Grid.root). Deduped
 * by assetId, first occurrence wins, insertion order preserved. */
export function collectPlanAssets(specs: SliceSpec[], altFor: (id: string) => string): PlanAsset[] {
  const byId = new Map<string, PlanAsset>();
  const add = (m: Media) => {
    if (byId.has(m.assetId)) return;
    const url = cdnUrl(m);
    if (url) byId.set(m.assetId, { id: m.assetId, url, alt: altFor(m.assetId) });
  };
  for (const spec of specs) {
    if (spec.background) add(spec.background);
    switch (spec.slice) {
      case "Gallery": spec.media.forEach(add); break;
      case "MediaFull":
      case "VideoFeature": add(spec.media); break;
      case "SplitFeature": add(spec.media); collectMedia(spec.text).forEach(add); break;
      case "Grid": collectMedia(spec.root).forEach(add); break;
      default: break; // Hero/TitleBand/RichText/LocationMap: only background (handled above)
    }
  }
  return [...byId.values()];
}

/** Build the Prismic migration plan for a grid-converted site: one text-only
 * page document + the assets its manifest references (uploaded so the manifest
 * can be rewritten to Prismic urls at migrate time). Collections flow through
 * `buildCustomType`, unchanged from archetype. */
export function buildGridPlan(specs: SliceSpec[], ir: SiteIR): MigrationPlan {
  const page = ir.pages[0];
  const uid = page?.uid ?? "home";
  const title = page?.title ?? uid;
  const doc: PlanDocument = {
    type: "page",
    uid,
    data: { title: richText(`<h1>${title}</h1>`), slices: specs.map(sliceSpecToPlanSlice) },
  };
  const altById = new Map(ir.assets.map((a) => [a.id, a.alt ?? ""]));
  const assets = collectPlanAssets(specs, (id) => altById.get(id) ?? "");
  const customTypes = ir.collections.map(buildCustomType);
  return { customTypes, documents: [doc], assets, stylesManifest: [], diagnostics: ir.diagnostics ?? [] };
}
```

> Confirm `collectMedia` is exported from `src/blux/grid/index.js` (it is, per the classifier barrel) and returns `Media[]`. Confirm `buildCustomType`/`ir.collections`/`ir.assets` shapes as in the archetype. If `ir.diagnostics` isn't on `SiteIR`, use `[]`.

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm vitest run tests/blux/emit/grid-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blux/emit/grid-plan.ts tests/blux/emit/grid-plan.test.ts
git commit -m "feat(blux/emit): buildGridPlan + collectPlanAssets — page doc + assets to upload"
```

---

## Task 4: `blockStylesByIndex` — site.json block styles keyed by band index

**Why:** `BandPresentation.style` (background-color, min-height, text-align — the design-pass band styling) comes from `site.json` block `styles`, cleaned exactly as `normalize.ts` already does. Grid bands are keyed by render-order index; site.json top-level page blocks are in the same order.

**Files:**
- Create: `src/blux/emit/block-styles.ts`
- Test: `tests/blux/emit/block-styles.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/blux/emit/block-styles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { blockStylesByIndex } from "../../../src/blux/emit/block-styles.js";

describe("blockStylesByIndex", () => {
  it("cleans + keys each top-level block's styles by its position", () => {
    const siteJson = {
      pages: [{ blocks: [
        { styles: { "background-color": "#fff", "min-height": "100vh" } },
        { styles: {} },
        { styles: { "text-align": "center", "z-index": 10 } },  // numeric kept as string
      ] }],
    };
    const map = blockStylesByIndex(siteJson);
    expect(map.get(0)).toEqual({ "background-color": "#fff", "min-height": "100vh" });
    expect(map.has(1)).toBe(false);                       // empty → no entry
    expect(map.get(2)).toEqual({ "text-align": "center", "z-index": "10" });
  });

  it("returns an empty map when there are no pages/blocks", () => {
    expect(blockStylesByIndex({}).size).toBe(0);
    expect(blockStylesByIndex({ pages: [] }).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm vitest run tests/blux/emit/block-styles.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/blux/emit/block-styles.ts`:

```ts
import { cleanCssValue } from "../normalize.js";

/** Per-band block styles (background-color, min-height, text-align, …) sourced
 * from site.json's top-level page blocks, cleaned exactly as normalize.ts does.
 * Keyed by the block's render-order index, which equals the grid `Band.index`
 * (the `page-block-N` number) for a contiguously-rendered page. */
export function blockStylesByIndex(siteJson: unknown): Map<number, Record<string, string>> {
  const out = new Map<number, Record<string, string>>();
  const blocks = (siteJson as { pages?: { blocks?: unknown[] }[] })?.pages?.[0]?.blocks;
  if (!Array.isArray(blocks)) return out;
  blocks.forEach((b, i) => {
    const styles = (b as { styles?: Record<string, unknown> })?.styles ?? {};
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(styles)) {
      const c = cleanCssValue(v);
      if (c) cleaned[k] = c;
    }
    if (Object.keys(cleaned).length) out.set(i, cleaned);
  });
  return out;
}
```

> Confirm `cleanCssValue`'s exact export + signature in `src/blux/normalize.ts` (it's used at lines ~82–84). Confirm the site.json page-blocks path — the archetype reads blocks via `assembleIR`; open `src/blux/parse.ts`/`assemble.ts` to verify `pages[0].blocks[].styles` is the right shape, and adapt the accessor if the real key differs (e.g. nested under `page.blocks` vs `blocks`).

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm vitest run tests/blux/emit/block-styles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blux/emit/block-styles.ts tests/blux/emit/block-styles.test.ts
git commit -m "feat(blux/emit): blockStylesByIndex — per-band block styles from site.json"
```

---

## Task 5: `buildPresentation` — SliceSpec[] → the presentation manifest

**Why:** This is the render-faithful half: the `{bands: {...}}` manifest the-pointe loads. It transforms the source node tree → `RenderNode` (dropping `GridToken.raw`, resolving `Media` → `RenderMedia`), fans each variant into the right `BandPresentation` field, attaches per-band `style`/`background`, and joins the map config. All media/style resolution is injected (`deps`) so the builder is pure, offline and snapshot-testable.

**Files:**
- Create: `src/blux/emit/presentation.ts`
- Test: `tests/blux/emit/presentation.test.ts`

**`deps` contract:**

```ts
export type PresentationDeps = {
  /** Resolve a source Media (bare-uuid assetId) → an absolute-URL RenderMedia,
   *  or null if unresolved (missing sourceUrl). */
  resolveMedia: (media: Media) => RenderMedia | null;
  /** Per-band block styles (Task 4), or an empty map. */
  styleFor: (index: number) => Record<string, string> | undefined;
  /** The map render config (MapConfig minus mountId), or null if no map. */
  map?: MapRenderConfig | null;
};
```

- [ ] **Step 1: Write the failing test (node-tree serialization + per-variant fan-out)** — `tests/blux/emit/presentation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPresentation, type PresentationDeps } from "../../../src/blux/emit/presentation.js";
import type { SliceSpec, Media, Node } from "../../../src/blux/grid/index.js";

const url = (m: Media) => ({ kind: m.kind, url: `https://cdn/${m.assetId}.jpg`, alt: `alt-${m.assetId}` });
const deps: PresentationDeps = { resolveMedia: url, styleFor: (i) => (i === 7 ? { "background-color": "#fff" } : undefined), map: null };

const img = (id: string): Media => ({ kind: "image", assetId: id });

describe("buildPresentation", () => {
  it("keys bands by String(index) and attaches style/background per band", () => {
    const specs: SliceSpec[] = [{ index: 7, slice: "Hero", heading: "H", background: img("bg") }];
    const p = buildPresentation(specs, deps);
    expect(Object.keys(p.bands)).toEqual(["7"]);
    expect(p.bands["7"]).toEqual({
      style: { "background-color": "#fff" },
      background: { kind: "image", url: "https://cdn/bg.jpg", alt: "alt-bg" },
    });
  });

  it("Gallery → gallery[], MediaFull/VideoFeature → media, no style when absent", () => {
    const specs: SliceSpec[] = [
      { index: 0, slice: "Gallery", media: [img("a"), img("b")] },
      { index: 1, slice: "MediaFull", media: img("c") },
      { index: 2, slice: "VideoFeature", media: { kind: "video", assetId: "v" } },
    ];
    const p = buildPresentation(specs, deps);
    expect(p.bands["0"]).toEqual({ gallery: [url(img("a")), url(img("b"))] });
    expect(p.bands["1"]).toEqual({ media: url(img("c")) });
    expect(p.bands["2"]).toEqual({ media: { kind: "video", url: "https://cdn/v.jpg", alt: "alt-v" } });
  });

  it("SplitFeature → split payload with resolved media + recursively-serialized text", () => {
    const text: Node = { kind: "body", html: "<p>copy</p>" };
    const specs: SliceSpec[] = [{ index: 1, slice: "SplitFeature", ratio: 40, mediaSide: "right", media: img("m"), text }];
    const p = buildPresentation(specs, deps);
    expect(p.bands["1"]).toEqual({
      split: { mediaSide: "right", ratio: 40, media: url(img("m")), text: { kind: "body", html: "<p>copy</p>" } },
    });
  });

  it("Grid → tree with GridToken.raw stripped and cell Media resolved", () => {
    const root: Node = {
      kind: "row",
      cells: [
        { token: { cols: 2, raw: "grid-2" }, node: { kind: "body", html: "<p>x</p>" } },
        { token: { cols: 2, ratio: 40, raw: "grid-2-r40" }, node: { kind: "media", media: img("z") } },
      ],
    };
    const p = buildPresentation([{ index: 3, slice: "Grid", root }], deps);
    expect(p.bands["3"].tree).toEqual({
      kind: "row",
      cells: [
        { token: { cols: 2 }, node: { kind: "body", html: "<p>x</p>" } },
        { token: { cols: 2, ratio: 40 }, node: { kind: "media", media: url(img("z")) } },
      ],
    });
  });

  it("LocationMap → map payload from deps.map", () => {
    const map = { mid: "M", layers: [], toggles: [], styles: [] };
    const p = buildPresentation([{ index: 5, slice: "LocationMap" }], { ...deps, map });
    expect(p.bands["5"]).toEqual({ map });
  });

  it("attaches deps.map to a Grid band whose tree contains a widget:map", () => {
    const map = { mid: "M", layers: [], toggles: [], styles: [] };
    const root: Node = { kind: "stack", children: [{ kind: "widget", widget: { type: "map" } }, { kind: "body", html: "<p>addr</p>" }] };
    const p = buildPresentation([{ index: 9, slice: "Grid", root }], { ...deps, map });
    expect(p.bands["9"].map).toEqual(map);
    expect(p.bands["9"].tree?.kind).toBe("stack");
  });

  it("drops a media node whose asset is unresolved rather than emitting a bad url", () => {
    const p = buildPresentation([{ index: 0, slice: "MediaFull", media: img("gone") }], { ...deps, resolveMedia: () => null });
    expect(p.bands["0"]).toEqual({});   // media omitted, band still present
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm vitest run tests/blux/emit/presentation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement — node-tree serializer** in `src/blux/emit/presentation.ts`:

```ts
import type { Media, Node, GridToken as SrcToken } from "../grid/index.js";

// Render-side mirror types (must match the-pointe presentation.ts exactly).
export type RenderMedia = { kind: "image" | "video"; url: string; alt?: string };
export type RenderToken = { cols: number | "any"; ratio?: number; sized?: number };
export type RenderNode =
  | { kind: "row"; cells: { token: RenderToken; node: RenderNode }[] }
  | { kind: "stack"; children: RenderNode[] }
  | { kind: "heading"; level: number; html: string; role?: string }
  | { kind: "body"; html: string; role?: string }
  | { kind: "subtitle"; text: string; role?: string }
  | { kind: "media"; media: RenderMedia }
  | { kind: "raw"; html: string }
  | { kind: "widget"; widget: { type: "map" } };
export type MapRenderConfig = {
  mid: string;
  layers: { name: string; lid: string; initiallyVisible: boolean; preserveViewport: boolean }[];
  toggles: { label: string; layers: string[] }[];
  styles: unknown[];
  center?: { lat: number; lng: number };
  zoom?: number;
};
export type BandPresentation = {
  style?: Record<string, string>;
  background?: RenderMedia;
  tree?: RenderNode;
  split?: { mediaSide: "left" | "right"; ratio: number; media: RenderMedia; text: RenderNode };
  gallery?: RenderMedia[];
  media?: RenderMedia;
  map?: MapRenderConfig;
};
export type Presentation = { bands: Record<string, BandPresentation> };

export type PresentationDeps = {
  resolveMedia: (media: Media) => RenderMedia | null;
  styleFor: (index: number) => Record<string, string> | undefined;
  map?: MapRenderConfig | null;
};

/** Drop the source-only `raw` field from a grid token; keep only cols/ratio/sized. */
function renderToken(t: SrcToken): RenderToken {
  return {
    cols: t.cols,
    ...(t.ratio !== undefined ? { ratio: t.ratio } : {}),
    ...(t.sized !== undefined ? { sized: t.sized } : {}),
  };
}

/** Recursively serialize a source Node → RenderNode: resolve media (dropping
 * unresolved media nodes), strip token.raw. Never mutates the input. */
function renderNode(node: Node, resolve: PresentationDeps["resolveMedia"]): RenderNode | null {
  switch (node.kind) {
    case "row": {
      const cells = node.cells
        .map((c) => {
          const rn = renderNode(c.node, resolve);
          return rn ? { token: renderToken(c.token), node: rn } : null;
        })
        .filter((c): c is { token: RenderToken; node: RenderNode } => c !== null);
      return { kind: "row", cells };
    }
    case "stack": {
      const children = node.children
        .map((c) => renderNode(c, resolve))
        .filter((c): c is RenderNode => c !== null);
      return { kind: "stack", children };
    }
    case "heading":
      return { kind: "heading", level: node.level, html: node.html, ...(node.role ? { role: node.role } : {}) };
    case "body":
      return { kind: "body", html: node.html, ...(node.role ? { role: node.role } : {}) };
    case "subtitle":
      return { kind: "subtitle", text: node.text, ...(node.role ? { role: node.role } : {}) };
    case "media": {
      const m = resolve(node.media);
      return m ? { kind: "media", media: m } : null;   // drop unresolved media
    }
    case "raw":
      return { kind: "raw", html: node.html };
    case "widget":
      return { kind: "widget", widget: node.widget };
  }
}

/** Does a (source) node tree contain a map widget anywhere? */
function hasMapWidget(node: Node): boolean {
  if (node.kind === "widget") return node.widget.type === "map";
  if (node.kind === "row") return node.cells.some((c) => hasMapWidget(c.node));
  if (node.kind === "stack") return node.children.some(hasMapWidget);
  return false;
}
```

- [ ] **Step 4: Implement — the per-variant builder** (append to `presentation.ts`):

```ts
import type { SliceSpec } from "../grid/index.js";

export function buildPresentation(specs: SliceSpec[], deps: PresentationDeps): Presentation {
  const bands: Record<string, BandPresentation> = {};
  for (const spec of specs) {
    const bp: BandPresentation = {};
    const style = deps.styleFor(spec.index);
    if (style) bp.style = style;
    if (spec.background) {
      const bg = deps.resolveMedia(spec.background);
      if (bg) bp.background = bg;
    }

    switch (spec.slice) {
      case "Hero":
      case "TitleBand":
        break; // text is in the page doc; only style/background here
      case "RichText":
        break; // content is in the page doc
      case "Gallery": {
        const g = spec.media.map(deps.resolveMedia).filter((m): m is RenderMedia => m !== null);
        if (g.length) bp.gallery = g;
        break;
      }
      case "MediaFull":
      case "VideoFeature": {
        const m = deps.resolveMedia(spec.media);
        if (m) bp.media = m;
        break;
      }
      case "SplitFeature": {
        const media = deps.resolveMedia(spec.media);
        const text = renderNode(spec.text, deps.resolveMedia);
        if (media && text) bp.split = { mediaSide: spec.mediaSide, ratio: spec.ratio, media, text };
        break;
      }
      case "LocationMap":
        if (deps.map) bp.map = deps.map;
        break;
      case "Grid": {
        const tree = renderNode(spec.root, deps.resolveMedia);
        if (tree) bp.tree = tree;
        // Co-located map (widget:map inside the tree): attach the map config too.
        if (deps.map && hasMapWidget(spec.root)) bp.map = deps.map;
        break;
      }
    }
    bands[String(spec.index)] = bp;
  }
  return { bands };
}
```

- [ ] **Step 5: Run — verify it passes**

Run: `pnpm vitest run tests/blux/emit/presentation.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Cross-check the render contract by eye**

Run: `git -C ~/Documents/GitHub/the-pointe show origin/main:src/lib/blux/presentation.ts | head -80`
Confirm the field names/shapes in the implemented `BandPresentation`/`RenderNode`/`MapRenderConfig` match byte-for-byte (esp. `split.mediaSide` values `"left"|"right"`, `GridToken` has no `raw`, `RenderMedia` has `url`+optional `alt`). Fix any drift.

- [ ] **Step 7: Commit**

```bash
git add src/blux/emit/presentation.ts tests/blux/emit/presentation.test.ts
git commit -m "feat(blux/emit): buildPresentation — SliceSpec[] → render manifest"
```

---

## Task 6: `blux convert` — CLI action wiring the whole pipeline

**Why:** One offline, creds-free command that reads an export and writes all four artifacts. It resolves the injected `deps` from the real IR (media → CDN URLs via `ir.assets`; block styles via Task 4; map via `extractMapConfig`).

**Files:**
- Modify: `src/cli/commands/blux.ts` (add the `convert` action + update the unknown-action list)
- Modify: `src/cli/bin.ts` (extend the `blux` description/`--out` already exists; ensure `convert` is documented)
- Reference: the existing `emit` action (assembleIR + writes) and `grid` action (parseGridBands + extractMapConfig + map-config.json) in the same file.

- [ ] **Step 1: Write the failing test** — add to `tests/cli/blux-command.test.ts` a new `describe("blux convert")` (full test in Task 7; write the first assertion now so the action exists):

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBluxCommand } from "../../src/cli/commands/blux.js";

describe("blux convert", () => {
  it("writes blux-presentation.json + migration-plan.json offline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blux-convert-"));
    await writeFile(
      join(dir, "index.html"),
      `<div id="page-content"><section class="blocks0" id="page-block-0"><div class="block-content"><h1 class="block-title text5">Hi</h1></div></section></div>`,
    );
    await writeFile(
      join(dir, "site.json"),
      JSON.stringify({ pages: [{ uid: "home", title: "Home", blocks: [{ styles: { "background-color": "#fff" } }] }], settings: {} }),
    );
    const res = await runBluxCommand("convert", dir, { cwd: dir });
    expect(res.code).toBe(0);
    const manifest = JSON.parse(await readFile(join(dir, "blux-out", "blux-presentation.json"), "utf-8"));
    expect(manifest.bands["0"]).toBeDefined();
    const plan = JSON.parse(await readFile(join(dir, "blux-out", "migration-plan.json"), "utf-8"));
    expect(plan.documents[0].data.slices[0].slice_type).toBe("title_band");
  });
});
```

> The single-`h1` band with no media classifies to `TitleBand`; adjust the expected `slice_type` if your minimal fixture classifies differently — run `blux grid` on it first to confirm.

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm vitest run tests/cli/blux-command.test.ts -t "blux convert"`
Expected: FAIL — `unknown blux action 'convert'`.

- [ ] **Step 3: Implement the `convert` action** in `src/cli/commands/blux.ts`.

First extend the imports at the top of the file:

```ts
import { parseGridBands, extractMapConfig, makeIsMapMount, classifyBands } from "../../blux/grid/index.js";
import { buildGridPlan } from "../../blux/emit/grid-plan.js";
import { buildPresentation, type PresentationDeps, type RenderMedia } from "../../blux/emit/presentation.js";
import { blockStylesByIndex } from "../../blux/emit/block-styles.js";
```

Add this block **before** the final unknown-action `return` (mirror the `emit` action for reading `site.json` + `assembleIR`, and the `grid` action for `index.html` + `extractMapConfig`):

```ts
if (action === "convert") {
  if (!dir) return { output: "blux convert needs a Blux export directory.", code: 1 };
  let html: string;
  let siteJson: unknown;
  try {
    html = await readFile(join(dir, "index.html"), "utf-8");
    siteJson = JSON.parse(await readFile(join(dir, "site.json"), "utf-8"));
  } catch (err) {
    return { output: `could not read export in ${dir}: ${(err as Error).message}`, code: 1 };
  }

  // Structure (HTML) + content/assets/theme (site.json).
  const bands = parseGridBands(html);
  const mapConfig = extractMapConfig(html);
  const specs = classifyBands(bands, mapConfig ? { isMapMount: makeIsMapMount(mapConfig) } : {});
  const ir = assembleIR({ siteJson, htmls: [html] });

  // deps: resolve source Media → absolute-URL RenderMedia. URL comes from the
  // parser-captured `data-base` (the exact live CDN url, offline); alt comes
  // from site.json via ir.assets. Fall back to the scrape's sourceUrl if a
  // media node somehow lacks `base`.
  const assetsById = new Map(ir.assets.map((a) => [a.id, a]));
  const styles = blockStylesByIndex(siteJson);
  const deps: PresentationDeps = {
    resolveMedia: (m) => {
      const a = assetsById.get(m.assetId);
      const url = m.base ? `${m.base}${m.assetId}${m.ext ? `.${m.ext}` : ""}` : (a?.sourceUrl ?? null);
      if (!url) return null;
      const alt = a?.alt;
      const rm: RenderMedia = { kind: m.kind, url, ...(alt ? { alt } : {}) };
      return rm;
    },
    styleFor: (i) => styles.get(i),
    map: mapConfig ? mapRenderFromConfig(mapConfig) : null,
  };

  const plan = buildGridPlan(specs, ir);
  const presentation = buildPresentation(specs, deps);

  const outDir = opts.out ?? join(dir, "blux-out");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "migration-plan.json"), JSON.stringify(plan, null, 2));
  await writeFile(join(outDir, "blux-presentation.json"), JSON.stringify(presentation, null, 2) + "\n");
  await writeFile(join(outDir, "theme.css"), emitThemeCss(ir.theme) + "\n" + emitRolesCss(ir.theme));
  if (mapConfig) {
    await writeFile(join(outDir, "map-config.json"), JSON.stringify(mapConfig, null, 2) + "\n");
  }
  return {
    output:
      `Converted ${bands.length} bands → ${outDir} ` +
      `(${Object.keys(presentation.bands).length} manifest bands, ${plan.documents[0]?.data.slices ? (plan.documents[0].data.slices as unknown[]).length : 0} slices` +
      (mapConfig ? ", map config extracted" : "") + ")",
    code: 0,
  };
}
```

Add the small `MapConfig → MapRenderConfig` helper at the bottom of the file (drops `mountId`):

```ts
import type { MapConfig } from "../../blux/grid/index.js";
import type { MapRenderConfig } from "../../blux/emit/presentation.js";
function mapRenderFromConfig(c: MapConfig): MapRenderConfig {
  return {
    mid: c.mid,
    layers: c.layers,
    toggles: c.toggles,
    styles: c.styles,
    ...(c.center ? { center: c.center } : {}),
    ...(c.zoom !== undefined ? { zoom: c.zoom } : {}),
  };
}
```

Update the fallthrough action list string to include `convert`:

```ts
return { output: `unknown blux action '${action}'. Use: emit, migrate, validate, grid, convert.`, code: 1 };
```

> Confirm against the real file: `assembleIR`, `emitThemeCss`, `emitRolesCss`, `readFile`, `writeFile`, `mkdir`, `join` are already imported for `emit`/`grid`; `ir.assets` fields (`id`, `sourceUrl`, `alt`) — verify names in `src/blux/assemble.ts`. If the probe wiring is non-trivial, copy the `emit` action's `--probe` block verbatim and have it mutate `ir.assets[].sourceUrl` before building `deps`. Keep `MapConfig`/`MapRenderConfig` type-only imports.

- [ ] **Step 4: Update `bin.ts`** — find the `blux <action>` command registration (~lines 547–581) and add `convert` to the action description/help text so `--out` applies. No new option needed (`--out`, `--probe` already exist).

```ts
// in the blux command description, list convert alongside emit/migrate/validate/grid
.description("Blux conversion: emit | migrate | validate | grid | convert")
```

- [ ] **Step 5: Run — verify it passes**

Run: `pnpm vitest run tests/cli/blux-command.test.ts -t "blux convert"`
Expected: PASS.

- [ ] **Step 6: Typecheck + full blux suite**

Run: `pnpm typecheck && pnpm vitest run tests/blux tests/cli/blux-command.test.ts`
Expected: PASS, no type errors (watch strict `exactOptionalPropertyTypes` on the conditional spreads).

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/blux.ts src/cli/bin.ts tests/cli/blux-command.test.ts
git commit -m "feat(blux): blux convert — parse+classify+emit page doc + presentation manifest"
```

---

## Task 6B: Prismic-host media — rewrite the manifest's URLs at migrate time

**Why:** Tucker's decision: media is Prismic-hosted for durability. `convert` writes the manifest with CDN URLs (renders offline immediately); `migrate` uploads the assets (Task 3 populated `plan.assets`) and then **rewrites** `blux-presentation.json`'s media URLs from the CDN URL to the uploaded Prismic URL. The rewrite is a pure, structured walk keyed by URL; the `migrate` CLI action drives it after `runMigration`.

**Files:**
- Create: `src/blux/emit/rewrite-manifest.ts` (`rewriteManifestUrls`)
- Modify: `src/blux/emit/run-migration.ts` (expose `assetUrlById` on the result)
- Modify: `src/cli/commands/blux.ts` (the `migrate` action rewrites the manifest when present)
- Test: `tests/blux/emit/rewrite-manifest.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/blux/emit/rewrite-manifest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rewriteManifestUrls } from "../../../src/blux/emit/rewrite-manifest.js";
import type { Presentation } from "../../../src/blux/emit/presentation.js";

const manifest: Presentation = {
  bands: {
    "0": { background: { kind: "image", url: "https://cdn/f/a.png", alt: "A" } },
    "1": { gallery: [{ kind: "image", url: "https://cdn/f/a.png" }, { kind: "image", url: "https://cdn/f/b.png" }] },
    "2": { split: { mediaSide: "left", ratio: 40, media: { kind: "image", url: "https://cdn/f/c.png" }, text: { kind: "row", cells: [{ token: { cols: 1 }, node: { kind: "media", media: { kind: "image", url: "https://cdn/f/b.png" } } }] } } },
    "3": { tree: { kind: "media", media: { kind: "image", url: "https://cdn/f/a.png" } }, media: { kind: "video", url: "https://cdn/f/v.mp4" } },
  },
};

describe("rewriteManifestUrls", () => {
  it("swaps every RenderMedia url found in the map, deep, leaving unknowns intact", () => {
    const map = new Map([
      ["https://cdn/f/a.png", "https://images.prismic.io/repo/a"],
      ["https://cdn/f/b.png", "https://images.prismic.io/repo/b"],
      ["https://cdn/f/c.png", "https://images.prismic.io/repo/c"],
      // v.mp4 intentionally absent → left as-is
    ]);
    const out = rewriteManifestUrls(manifest, map);
    expect(out.bands["0"].background!.url).toBe("https://images.prismic.io/repo/a");
    expect(out.bands["1"].gallery!.map((m) => m.url)).toEqual(["https://images.prismic.io/repo/a", "https://images.prismic.io/repo/b"]);
    expect(out.bands["2"].split!.media.url).toBe("https://images.prismic.io/repo/c");
    // nested media inside split.text tree
    const cell = (out.bands["2"].split!.text as { cells: { node: { media: { url: string } } }[] }).cells[0]!;
    expect(cell.node.media.url).toBe("https://images.prismic.io/repo/b");
    expect((out.bands["3"].tree as { media: { url: string } }).media.url).toBe("https://images.prismic.io/repo/a");
    expect(out.bands["3"].media!.url).toBe("https://cdn/f/v.mp4"); // unknown left intact
    // input not mutated
    expect(manifest.bands["0"].background!.url).toBe("https://cdn/f/a.png");
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm vitest run tests/blux/emit/rewrite-manifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/blux/emit/rewrite-manifest.ts`:

```ts
import type { BandPresentation, Presentation, RenderMedia, RenderNode } from "./presentation.js";

const swap = (m: RenderMedia, map: Map<string, string>): RenderMedia => {
  const url = map.get(m.url);
  return url ? { ...m, url } : m;
};

function walkNode(node: RenderNode, map: Map<string, string>): RenderNode {
  switch (node.kind) {
    case "row":
      return { kind: "row", cells: node.cells.map((c) => ({ token: c.token, node: walkNode(c.node, map) })) };
    case "stack":
      return { kind: "stack", children: node.children.map((c) => walkNode(c, map)) };
    case "media":
      return { kind: "media", media: swap(node.media, map) };
    default:
      return node; // heading/body/subtitle/raw/widget carry no media url
  }
}

function walkBand(bp: BandPresentation, map: Map<string, string>): BandPresentation {
  const out: BandPresentation = { ...bp };
  if (bp.background) out.background = swap(bp.background, map);
  if (bp.media) out.media = swap(bp.media, map);
  if (bp.gallery) out.gallery = bp.gallery.map((m) => swap(m, map));
  if (bp.tree) out.tree = walkNode(bp.tree, map);
  if (bp.split) out.split = { ...bp.split, media: swap(bp.split.media, map), text: walkNode(bp.split.text, map) };
  return out; // style / map are untouched (no media urls)
}

/** Return a deep copy of the manifest with every RenderMedia.url present in
 * `urlMap` replaced by its mapped value. Unknown urls are left intact. Pure. */
export function rewriteManifestUrls(manifest: Presentation, urlMap: Map<string, string>): Presentation {
  const bands: Record<string, BandPresentation> = {};
  for (const [k, bp] of Object.entries(manifest.bands)) bands[k] = walkBand(bp, urlMap);
  return { bands };
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm vitest run tests/blux/emit/rewrite-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Expose the CDN→Prismic url map from `runMigration`**

In `src/blux/emit/run-migration.ts`: the asset phase already fetches each library asset's Prismic `url` and knows each `PlanAsset` (`{id, url: cdnUrl, alt}`). Build a `Map<cdnUrl, prismicUrl>` alongside the existing `assetIdByUuid` and add it to the returned `MigrationResult` as `assetUrlByCdn`. Concretely: whenever you resolve/upload an asset and learn its Prismic `url`, also record `assetUrlByCdn.set(planAsset.url, prismicUrl)` (keyed by the plan asset's CDN url — the same string the manifest carries). Add `assetUrlByCdn: Map<string, string>` to the `MigrationResult` type and return it. Do **not** change any existing field or the push logic.

Add a focused test in `tests/blux/emit/` (or extend the existing run-migration test) that stubs the asset API `fetch` and asserts `result.assetUrlByCdn` maps each plan asset's CDN url → its Prismic url. If the existing run-migration test already stubs uploads, extend it; otherwise add `tests/blux/emit/run-migration-asseturls.test.ts` mirroring the existing stub pattern.

- [ ] **Step 6: Wire the rewrite into the `migrate` CLI action**

In `src/cli/commands/blux.ts`, in the `migrate` action, after `runMigration(plan, onLine)` returns, if a `blux-presentation.json` sits next to the plan, rewrite it:

```ts
import { rewriteManifestUrls } from "../../blux/emit/rewrite-manifest.js";
import type { Presentation } from "../../blux/emit/presentation.js";
// … after: const result = await runMigration(plan, (line) => process.stderr.write(line + "\n"));
const manifestPath = join(dirname(planPath), "blux-presentation.json");
try {
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as Presentation;
  const rewritten = rewriteManifestUrls(manifest, result.assetUrlByCdn);
  await writeFile(manifestPath, JSON.stringify(rewritten, null, 2) + "\n");
  // add to the summary: `manifest media rewritten to Prismic urls`
} catch {
  /* no manifest beside the plan (archetype emit) — skip silently */
}
```

> `planPath` is the resolved plan path the `migrate` action already computes; use `dirname(planPath)` (import `dirname` from `node:path`). `readFile`/`writeFile` are already imported. Keep this inside the creds-gated `migrate` branch so no offline run touches it.

- [ ] **Step 7: Test the migrate rewrite wiring** — extend `tests/cli/blux-command.test.ts`'s `migrate` describe with a case that: writes a `migration-plan.json` + a `blux-presentation.json` (CDN urls) to a temp dir, stubs creds + the run-migration import (or the asset-API fetch) to return a known `assetUrlByCdn`, runs `runBluxCommand("migrate", dir, …)`, and asserts the on-disk `blux-presentation.json` now has Prismic urls. If stubbing the lazy `run-migration` import is awkward, assert instead that with no creds the action refuses and does NOT touch the manifest (the pure rewrite is already covered by Step 1–4).

Run: `pnpm vitest run tests/cli/blux-command.test.ts -t "migrate"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/blux/emit/rewrite-manifest.ts src/blux/emit/run-migration.ts src/cli/commands/blux.ts tests/blux/emit/rewrite-manifest.test.ts tests/cli/blux-command.test.ts tests/blux/emit/run-migration-asseturls.test.ts 2>/dev/null
git commit -m "feat(blux/emit): migrate rewrites manifest media urls to Prismic (durable hosting)"
```

---

## Task 7: Fidelity goldens — the-pointe manifest + map emit path

**Why:** The snapshot golden is the fidelity gate (like the parse/classify goldens). It runs the full `parse → classify → buildPresentation` on the committed the-pointe fixture with a deterministic stub resolver, and separately proves the map path with the map-band fixture + a real `extractMapConfig`.

**Files:**
- Create: `tests/blux/grid-convert-golden.test.ts` (+ its snapshot, generated)
- Fixtures used (already committed on this branch's base `b087dc7`): `tests/blux/fixtures/the-pointe-page-content.html`, `tests/blux/fixtures/the-pointe-map-band.html`

- [ ] **Step 1: Write the golden test** — `tests/blux/grid-convert-golden.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseGridBands, classifyBands, extractMapConfig, makeIsMapMount } from "../../src/blux/grid/index.js";
import { buildPresentation, type PresentationDeps, type RenderMedia } from "../../src/blux/emit/presentation.js";
import { sliceSpecToPlanSlice } from "../../src/blux/emit/grid-slice.js";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf-8");

// Deterministic offline resolver: assetId → stable fake URL (no site.json needed).
const deps: PresentationDeps = {
  resolveMedia: (m): RenderMedia => ({ kind: m.kind, url: `asset://${m.assetId}`, alt: m.assetId }),
  styleFor: () => undefined,
  map: null,
};

describe("grid convert golden — the-pointe", () => {
  it("classifies 16 bands into a stable slice-type sequence", () => {
    const bands = parseGridBands(fixture("the-pointe-page-content.html"));
    const specs = classifyBands(bands);
    expect(specs.map((s) => `${s.index} ${s.slice}`)).toMatchSnapshot();
  });

  it("builds a stable presentation manifest (structure + media placeholders)", () => {
    const bands = parseGridBands(fixture("the-pointe-page-content.html"));
    const specs = classifyBands(bands);
    const manifest = buildPresentation(specs, deps);
    expect(manifest).toMatchSnapshot();
  });

  it("builds a stable page-doc slice sequence", () => {
    const bands = parseGridBands(fixture("the-pointe-page-content.html"));
    const specs = classifyBands(bands);
    expect(specs.map(sliceSpecToPlanSlice)).toMatchSnapshot();
  });

  it("map-band fixture → LocationMap-or-Grid band carrying the map payload", () => {
    const html = fixture("the-pointe-map-band.html");
    const cfg = extractMapConfig(html);
    expect(cfg).not.toBeNull();
    const bands = parseGridBands(html);
    const specs = classifyBands(bands, { isMapMount: makeIsMapMount(cfg!) });
    const mapDeps: PresentationDeps = { ...deps, map: { mid: cfg!.mid, layers: cfg!.layers, toggles: cfg!.toggles, styles: cfg!.styles, ...(cfg!.center ? { center: cfg!.center } : {}), ...(cfg!.zoom !== undefined ? { zoom: cfg!.zoom } : {}) } };
    const manifest = buildPresentation(specs, mapDeps);
    // Exactly one band carries a map payload; its mid matches the extracted config.
    const withMap = Object.values(manifest.bands).filter((b) => b.map);
    expect(withMap).toHaveLength(1);
    expect(withMap[0]!.map!.mid).toBe(cfg!.mid);
  });
});
```

- [ ] **Step 2: Run — generate the snapshots**

Run: `pnpm vitest run tests/blux/grid-convert-golden.test.ts -u`
Expected: PASS, snapshot file created.

- [ ] **Step 3: Eyeball the golden (the fidelity check — do NOT skip)**

Open `tests/blux/__snapshots__/grid-convert-golden.test.ts.snap` and verify:
- 16 bands present, indices contiguous 0–15.
- Band 14's `tree` is a `stack` whose first child is a `raw` node containing `id="burbank_map"` (the Task-1 fix carried the map into the manifest).
- Band 1 has a `split` payload (`mediaSide:"right"`, `ratio:40`); band 8 has a `gallery` of 3; the three `TitleBand` bands (2, 13, 15) have no `tree`/`media`/`split` (text is doc-side), only possibly `style`.
- No `token.raw` key anywhere in the manifest; every `media` has a `url`.

If any of these are wrong, the bug is upstream (Task 1/5) — fix there, don't paper over the snapshot.

- [ ] **Step 4: Commit**

```bash
git add tests/blux/grid-convert-golden.test.ts tests/blux/__snapshots__/grid-convert-golden.test.ts.snap
git commit -m "test(blux): grid convert fidelity golden — the-pointe manifest + map path"
```

---

## Task 8: Full-suite verification, changeset, docs

**Files:**
- Create: `.changeset/<name>.md`
- Modify (optional): a short note in the spec's "rollout" section marking step 4's emit paths done.

- [ ] **Step 1: Run the entire blux + CLI suite**

Run: `pnpm vitest run tests/blux tests/cli` (add `--no-file-parallelism` if the Mac is loaded — worker-timeout flakes, not real failures).
Expected: all green.

- [ ] **Step 2: Lint + typecheck + dist build**

Run: `pnpm lint && pnpm typecheck && pnpm build && pnpm test:dist`
Expected: clean (CI prettier-checks markdown too; the new `.ts` public exports must survive `test:dist`).

- [ ] **Step 3: Real-run smoke against the actual export (manual, offline)**

Run: `pnpm tsx src/cli/bin.ts blux convert ~/Desktop/thePointe --out /tmp/blux-convert-smoke`
Expected: exit 0, prints "Converted 16 bands …, map config extracted". Then inspect:
- `/tmp/blux-convert-smoke/blux-presentation.json` — band 14 has both a `tree` (with the map `raw`/`widget`) and a `map` payload; media `url`s are real cloudfront URLs (`data-base` + uuid + ext, resolved offline for **every** image — no probe); `style` present on white/hero bands.
- `/tmp/blux-convert-smoke/migration-plan.json` — one `page` doc, 16 slices, `title` heading1, and a populated `assets` array (every unique image/video with a CDN url + alt) ready for upload.
- `/tmp/blux-convert-smoke/map-config.json` + `theme.css` present.

This is the real-data confirmation the fixture goldens can't give (fixtures have scripts stripped / no site.json). The **migrate-time rewrite** to Prismic urls needs creds + a live push — verified in plan 7, not here; this smoke confirms `convert`'s offline half. Capture the output in the PR description.

- [ ] **Step 4: Changeset** — `.changeset/blux-grid-emit.md`:

```markdown
---
"reddoor-maintenance": minor
---

feat(blux): faithful-grid plan 5 — `blux convert` emits the Prismic page document
(text + band indices) and the `blux-presentation.json` render manifest (layout
tree + resolved media + block styles + map payload), keyed by band index. Media
is Prismic-hosted: `convert` writes CDN urls + the asset list, and `blux migrate`
uploads the assets and rewrites the manifest urls to Prismic for durability.
Parser fix: Blux custom-code embeds (`[data-exec]`, incl. the map mount) now
survive as `raw` leaves instead of being peeled away.
```

- [ ] **Step 5: Commit**

```bash
git add .changeset/blux-grid-emit.md docs/superpowers/specs/2026-07-08-blux-faithful-grid-slices-design.md
git commit -m "chore(blux): changeset + spec note for grid emit (plan 5)"
```

- [ ] **Step 6: Push + open PR**

```bash
git push -u origin feat/blux-grid-emit
gh pr create --title "feat(blux): faithful-grid plan 5 — grid emit paths (page doc + presentation manifest)" --body "…summary + Task-8 smoke output…"
```

Per the merge-authority policy: auto-merge once CI-green + review-clean (this is a non-release PR). Run the pre-merge gate (`build` completed:success on the head SHA, `pnpm test:dist`, `pnpm typecheck`) before merging.

---

## Decisions (rationale — read before executing)

- **Why two-phase Prismic hosting (Decision 1):** Prismic URLs aren't known until assets are uploaded (a creds-gated network step), but `convert` must stay offline/deterministic (Tucker's "zero-token, don't touch the live site" strategy). So `convert` writes the CDN URL (which renders faithfully with zero creds — the exact URL the live page uses, from `data-base`) and populates `plan.assets`; the creds-gated `migrate` uploads those assets and rewrites the manifest URLs to Prismic. This gives durability (Blux cloudfront could lapse if the client stops paying Blux) without coupling `convert` to the network. Convert-only = CDN preview; convert+migrate = Prismic-hosted production.
- **Why no Image fields in the page doc (Decision 2):** the shipped render contract (plans 3–4) reads *all* media from the manifest (`bands[i].gallery/media/split/background/tree`), not Prismic Image fields. Emit conforms to what shipped, so the uploaded assets are library assets the manifest references by URL, not doc-field images. Consequence: media is Prismic-hosted/durable but not individually CMS-editable — accepted per spec decision #4 (CMS is a nice-to-have). Making media CMS-editable (Prismic Image fields in the slices) would require changing the-pointe's render slices — out of scope here.
- **Why split text → manifest, hero/title/richtext text → doc (Decision 3):** `BandPresentation` has slots for `split.text` (a `RenderNode`, so nested media survives) but none for heading/subtitle/hero-body/richtext-content; those map to Prismic Text/StructuredText fields the band slices read from `primary`. Leaving the split_feature `body` override empty means the manifest text renders — faithful, just not separately CMS-editable.
- **Why a new `convert` action (Decision 5):** the legacy `emit`/archetype pipeline has different inputs (all page HTML + `site.json`) and outputs (`SectionIR`-based). Fusing them risks the `migrate` contract that reads `migration-plan.json`. `convert` reuses the plan/marker/runner plumbing but is a clean separate entry; `grid` stays a pure inspect step. `migrate` is untouched and pushes `convert`'s `migration-plan.json` verbatim.
- **Why block styles from site.json by index (Decision 6):** the values are already structured data in `site.json` (`b.styles`) and already cleaned by `normalize.ts` (`cleanCssValue`) — reuse beats writing a CSS-rule parser for the rendered `<style>`. Risk: the array-position↔`page-block-N` join can misalign on a page that skips block indices; the contiguity assertion in the golden (Task 7 step 3: indices 0–15 contiguous) is the tripwire, and a non-contiguous site fails loudly rather than mis-styling.

## Out of scope (explicit — these are later plans)

- **the-pointe consumption / render wiring** (dropping the new `blux-presentation.json` in, updating `Grid.svelte` to mount a real `LocationMap` for a co-located `widget:map`, adding the six band slices + hero `band` variation to the `page` custom type's slice-zone choices, Slice Machine push) — **plan 7**.
- **`validate.ts` layout-signature check** (parse both answer key + rendered page → compare signature sequences) — **plan 6**.
- **CMS-editable media** (Prismic Image fields in the render slices) — a bigger the-pointe render change; not needed for durable hosting.
- **Promoting the emit/manifest generic pieces to reddoor-starter** — **plan 8**.
