# Blux Grid — Plan 2: Band classifier + widget router

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure, table-driven classifier that turns each plan-1 `Band` into a typed `SliceSpec` — recognized layouts become CMS-editable **pattern slices**, everything else falls back to a render-faithful **`Grid`** spec carrying the raw node tree — plus a **widget router** that rewrites recognized map mounts into `widget:map` nodes and promotes map-/video-dominant bands to `LocationMap`/`VideoFeature`.

**Architecture:** One new module `src/blux/grid/classify-band.ts` consuming the plan-1 `Band`/`Node` contract (`src/blux/grid/types.ts`) and producing a new `SliceSpec` IR (`src/blux/grid/slice-spec.ts`). Classification is **conservative** — a band is promoted to a pattern slice only on an unambiguous structural signature; anything fuzzy or deeply nested stays a `Grid` fallback (fidelity is the fallback's job — see spec decision #2). The **map widget** is detected via an **injected predicate** (`isMapMount`), not by parsing the `initMap` script — that extraction is plan 4 (`extract-map.ts`); plan 2 delivers the rewrite/route mechanism and tests it with a stub predicate. No emit, no Svelte, no Prismic — those are plans 3–5.

**Tech Stack:** TypeScript (NodeNext — relative imports carry `.js`), Vitest (node env, `tests/**/*.test.ts`), ESLint (`no-explicit-any`) + Prettier. Strict tsconfig: `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — guard `arr[i]`/regex groups and build optional fields via conditional spread. No new deps.

---

## Key design decisions (read first — these are the spec seams this plan resolves)

1. **Classify off the `Band` contract alone.** Plan-1's `Band = { index; background?; root }` has **no `BlockStyle`/height** (the spec assumed one; the shipped type does not — `src/blux/grid/types.ts`). So the classifier uses **structural** signals only (background presence, node kinds, the top row's cells). Height-based Hero refinement is a plan-5 emit/manifest concern, not this plan's.
2. **Conservative promotion.** Fidelity is guaranteed by the `Grid` fallback (spec §"Locked design decisions" #2). A band becomes a pattern slice only when its signature is unambiguous; otherwise `Grid`. Over-eager matching would silently drop layout — the exact failure this replan exists to fix.
3. **Map via dependency injection.** `classifyBand(band, opts?)` accepts `opts.isMapMount?: (node) => boolean`. Default = never (so plan 2's default output leaves the map mount as a `raw` node inside band 10's fallback). Plan 4 supplies the real predicate from `extract-map.ts`. This plan tests the map path with a stub predicate.
4. **`StatGrid` is deferred.** It fires on **zero** top-level the-pointe bands (every stat row is nested inside a larger band → `Grid` fallback). Per spec Open-Q #2 ("promote more signatures to pattern slices … when a real site needs it") it is not implemented here. The `SliceSpec` union does **not** include a `StatGrid` variant yet.
5. **Video is a media kind, not a slice.** `VideoFeature` is only the name for a band whose sole content is one video (spec §"Slice components"). On the-pointe no band is video-only (band 10's video co-exists with the map + stat images → `Grid` fallback), so `VideoFeature` is tested with a synthetic band.

### Real-band coverage (the-pointe golden fixture, `parseGridBands` → 16 bands)

Measured signatures (from `gridSignature`) and their target slice under this plan:

| Band | Signature (abbrev)                                                    | Slice                       |
| ---- | -------------------------------------------------------------------- | --------------------------- |
| 0    | `(bg) stack[media:image,subtitle]`                                   | `Grid` (no heading; fuzzy)  |
| 1    | `(bg) row[grid-2-r60:stack[h1,media,h4,body,media], grid-2-r40:media]`| `SplitFeature` (mediaSide=right, ratio 60) |
| 2    | `stack[h2,subtitle]`                                                  | `TitleBand`                 |
| 3    | `row[grid-2:…, grid-2:row[4× stat]]` (deep)                          | `Grid`                      |
| 4    | `(bg) raw` (tall bg-only block-holder)                               | `Grid`                      |
| 5    | `row[grid-2-r60:stack[h4,media,h4,body]]` (1 cell)                   | `Grid`                      |
| 6    | `row[3× grid-1:row[media|body] zigzag]`                              | `Grid`                      |
| 7    | `(bg) stack[h2,subtitle]`                                            | `Hero` (bg + overlay heading)|
| 8    | `row[grid-1:media, grid-1:media, grid-1:media]`                       | `Gallery` (3)               |
| 9    | `(bg) stack[h4,media,media,body]`                                    | `Grid`                      |
| 10   | `stack[media:video, row[grid-2:raw(map mount), grid-2:stack[h4,row[2× media]]]]` | `Grid` (nested video + map mount) |
| 11   | `(bg) stack[h4,media,h4,body]`                                       | `Grid`                      |
| 12   | `row[3× grid-1:row[body|media] zigzag]`                              | `Grid`                      |
| 13   | `stack[h2,subtitle]`                                                  | `TitleBand`                 |
| 14   | `row[grid-1:row[7× grid-4 stat], grid-1:row[7× media], …]` (deep)   | `Grid`                      |
| 15   | `h2`                                                                  | `TitleBand`                 |

So on the-pointe: **3 TitleBand, 1 Hero, 1 Gallery, 1 SplitFeature, 10 Grid**. This is expected and correct — the fallback + plan-3 `Grid.svelte` carry layout fidelity; the pattern slices provide editability where the shape is unambiguous. `MediaFull`/`RichText`/`VideoFeature`/`LocationMap` fire on 0 the-pointe bands but are implemented (cheap, real on other sites) and tested with synthetic bands.

**Reference files (read before starting):**

- `src/blux/grid/types.ts` — the `Band`/`Node`/`Cell`/`GridToken`/`Media`/`Widget` contract (plan-1). **The `widget` node kind is forward-declared for this plan.**
- `src/blux/grid/parse-grid.ts` — how bands parse; `parseGridBands`, `parseContainer`, `bandBackground`. Note the map mount parses to `raw` (`kind:"raw"`).
- `src/blux/grid/signature.ts` — `gridSignature`/`sig`; mirror its exhaustive `switch (node.kind)` style so a new node kind is a compile error, not a silent drop.
- `src/blux/grid/index.ts` — the module's public barrel; extend it.
- `tests/blux/grid-golden.test.ts` + `tests/blux/fixtures/the-pointe-page-content.html` — the plan-1 golden fixture. **Reuse this fixture** — do not invent a new one. This plan adds a parallel classification golden.

**Guardrails:**

- Pure functions only. No fetch, no fs (except tests reading the fixture), no Prismic, no Svelte.
- NodeNext: every relative import ends in `.js`.
- `exactOptionalPropertyTypes`: never assign `undefined` to an optional field — omit it via conditional spread (`...(x ? { x } : {})`).
- Exhaustive `switch (node.kind)` with no `default` so TS flags an unhandled kind.

---

## File structure

- Create: `src/blux/grid/slice-spec.ts` — the `SliceSpec` discriminated union (the plan-2 IR; imported by the classifier and, later, the emit stages).
- Create: `src/blux/grid/classify-band.ts` — `classifyBand`, `classifyBands`, and pure internal helpers + the widget router.
- Modify: `src/blux/grid/index.ts` — export the new public API.
- Test: `tests/blux/grid-classify.test.ts` — per-pattern unit tests over real + synthetic bands.
- Test: `tests/blux/grid-classify-golden.test.ts` — a stable snapshot of `classifyBands(parseGridBands(fixture))` (the fidelity gate).

---

## Task 1: `SliceSpec` type

**Files:**

- Create: `src/blux/grid/slice-spec.ts`

- [ ] **Step 1: Write the type module**

```ts
import type { Media, Node } from "./types.js";

/** Every SliceSpec carries the band's slice-zone index and (optional) band
 * background, so the runtime can line slices up with the emit outputs and render
 * the background band exactly as today. */
type SpecBase = { index: number; background?: Media };

/** A full-bleed band with overlay text (structural signal: a band `background`
 * plus an overlay heading, no grid row, no foreground media). */
export type HeroSpec = SpecBase & {
  slice: "Hero";
  heading?: string;
  subtitle?: string;
  body?: string;
};

/** A centered title band: heading (+ optional eyebrow subtitle), no media. */
export type TitleBandSpec = SpecBase & {
  slice: "TitleBand";
  heading: string;
  subtitle?: string;
};

/** One row, exactly two cells: one pure-media, one text-bearing. `ratio` is the
 * media cell's grid share (e.g. 40 for `grid-2-r40`); `mediaSide` says which side. */
export type SplitFeatureSpec = SpecBase & {
  slice: "SplitFeature";
  ratio: number;
  mediaSide: "left" | "right";
  media: Media;
  text: Node;
};

/** One row whose every cell is a single media node (≥2 cells). */
export type GallerySpec = SpecBase & { slice: "Gallery"; media: Media[] };

/** A single full-width media node, no text. */
export type MediaFullSpec = SpecBase & { slice: "MediaFull"; media: Media };

/** Only rich text (one body node, no media / rows). */
export type RichTextSpec = SpecBase & { slice: "RichText"; html: string };

/** A band whose sole content is one video. */
export type VideoFeatureSpec = SpecBase & { slice: "VideoFeature"; media: Media };

/** A band whose dominant content is the interactive map widget. Config
 * (mid/lids/style/center) is extracted later (plan 4, `extract-map.ts`). */
export type LocationMapSpec = SpecBase & { slice: "LocationMap" };

/** The render-faithful fallback: the (widget-rewritten) node tree, rendered
 * recursively by plan-3's `Grid.svelte`. */
export type GridSpec = SpecBase & { slice: "Grid"; root: Node };

export type SliceSpec =
  | HeroSpec
  | TitleBandSpec
  | SplitFeatureSpec
  | GallerySpec
  | MediaFullSpec
  | RichTextSpec
  | VideoFeatureSpec
  | LocationMapSpec
  | GridSpec;

export type SliceKind = SliceSpec["slice"];
```

- [ ] **Step 2: Commit**

```bash
git add src/blux/grid/slice-spec.ts
git commit -m "feat(blux): SliceSpec IR for the grid band classifier (plan 2)"
```

---

## Task 2: Pure node-inspection helpers

The classifier decisions all reduce to a handful of pure predicates over a `Node`. Build and test them first so each classifier task is a thin table lookup.

**Files:**

- Create: `src/blux/grid/classify-band.ts` (helpers only in this task)
- Test: `tests/blux/grid-classify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { Node } from "../../src/blux/grid/types.js";
import {
  collectMedia,
  collectText,
  topRow,
  isEmptyRaw,
} from "../../src/blux/grid/classify-band.js";

const media = (kind: "image" | "video"): Node => ({ kind: "media", media: { kind, assetId: "a" } });
const heading = (level: number): Node => ({ kind: "heading", level, html: "H" });
const body = (): Node => ({ kind: "body", html: "<p>b</p>" });

describe("node-inspection helpers", () => {
  it("collectMedia gathers media across rows and stacks", () => {
    const tree: Node = { kind: "stack", children: [media("image"), { kind: "row", cells: [{ token: { cols: 1, raw: "grid-1" }, node: media("video") }] }] };
    expect(collectMedia(tree).map((m) => m.kind)).toEqual(["image", "video"]);
  });

  it("collectText gathers heading/body/subtitle nodes", () => {
    const tree: Node = { kind: "stack", children: [heading(2), body()] };
    expect(collectText(tree).map((n) => n.kind)).toEqual(["heading", "body"]);
  });

  it("topRow returns cells when the root is a row, else null", () => {
    const row: Node = { kind: "row", cells: [{ token: { cols: 2, raw: "grid-2" }, node: media("image") }] };
    expect(topRow(row)?.length).toBe(1);
    expect(topRow(heading(1))).toBeNull();
  });

  it("isEmptyRaw is true only for a raw node with no text/element content", () => {
    expect(isEmptyRaw({ kind: "raw", html: '<div class="block-content"></div>' })).toBe(true);
    expect(isEmptyRaw({ kind: "raw", html: "<p>hi</p>" })).toBe(false);
    expect(isEmptyRaw(heading(1))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/blux/grid-classify.test.ts --no-coverage`
Expected: FAIL (module `classify-band.js` not found / exports missing).

- [ ] **Step 3: Implement the helpers**

```ts
import type { Cell, Media, Node } from "./types.js";

/** Depth-first collect of every `media` node's `Media` in a subtree. */
export function collectMedia(node: Node): Media[] {
  switch (node.kind) {
    case "media":
      return [node.media];
    case "row":
      return node.cells.flatMap((c) => collectMedia(c.node));
    case "stack":
      return node.children.flatMap(collectMedia);
    case "heading":
    case "body":
    case "subtitle":
    case "widget":
    case "raw":
      return [];
  }
}

/** Depth-first collect of text nodes (heading/body/subtitle). */
export function collectText(node: Node): Node[] {
  switch (node.kind) {
    case "heading":
    case "body":
    case "subtitle":
      return [node];
    case "row":
      return node.cells.flatMap((c) => collectText(c.node));
    case "stack":
      return node.children.flatMap(collectText);
    case "media":
    case "widget":
    case "raw":
      return [];
  }
}

/** The cells of the root row, or null when the root is not a single row. A
 * `stack` whose only child is a row also counts (Blux wraps rows in holders). */
export function topRow(node: Node): Cell[] | null {
  if (node.kind === "row") return node.cells;
  if (node.kind === "stack" && node.children.length === 1) {
    const [only] = node.children;
    if (only && only.kind === "row") return only.cells;
  }
  return null;
}

/** A `raw` node carrying no rendered text or nested block — the shape a
 * client-injected mount (e.g. the map container) parses to. */
export function isEmptyRaw(node: Node): boolean {
  if (node.kind !== "raw") return false;
  const text = node.html.replace(/<[^>]*>/g, "").trim();
  return text.length === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/blux/grid-classify.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blux/grid/classify-band.ts tests/blux/grid-classify.test.ts
git commit -m "feat(blux): node-inspection helpers for band classification"
```

---

## Task 3: `classifyBand` skeleton + `Grid` fallback + `classifyBands`

Establish the entry point that classifies **everything to `Grid`** for now (default-safe), plus the public `classifyBands` and the barrel export. Later tasks slot pattern branches ahead of the fallback.

**Files:**

- Modify: `src/blux/grid/classify-band.ts`
- Modify: `src/blux/grid/index.ts`
- Test: `tests/blux/grid-classify.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing describe file)

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseGridBands } from "../../src/blux/grid/index.js";
import { classifyBand, classifyBands } from "../../src/blux/grid/classify-band.js";
import type { Band } from "../../src/blux/grid/types.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/the-pointe-page-content.html", import.meta.url));
const realBands = (): Band[] => parseGridBands(readFileSync(FIXTURE, "utf-8"));
const band = (bands: Band[], index: number): Band => {
  const b = bands.find((x) => x.index === index);
  if (!b) throw new Error(`no band ${index}`);
  return b;
};

describe("classifyBand — fallback + wiring", () => {
  it("carries index and background onto every spec", () => {
    const spec = classifyBand(band(realBands(), 4)); // tall bg-only raw → Grid
    expect(spec.slice).toBe("Grid");
    expect(spec.index).toBe(4);
    expect(spec.background?.kind).toBe("image");
  });

  it("classifyBands preserves order and length", () => {
    const bands = realBands();
    const specs = classifyBands(bands);
    expect(specs).toHaveLength(bands.length);
    expect(specs.map((s) => s.index)).toEqual(bands.map((b) => b.index));
  });

  it("a deeply nested band falls back to Grid carrying its root tree", () => {
    const spec = classifyBand(band(realBands(), 3));
    expect(spec.slice).toBe("Grid");
    if (spec.slice === "Grid") expect(spec.root.kind).toBe("row");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/blux/grid-classify.test.ts --no-coverage`
Expected: FAIL (`classifyBand`/`classifyBands` not exported).

- [ ] **Step 3: Implement the skeleton** (append to `classify-band.ts`)

```ts
import type { Band } from "./types.js";
import type { SliceSpec } from "./slice-spec.js";

/** Options for the classifier. `isMapMount` is injected by plan 4
 * (`extract-map.ts`); by default nothing is recognized as a map. */
export type ClassifyOptions = {
  isMapMount?: (node: Node) => boolean;
};

/** The band's slice-zone base carried onto every spec (conditional spread keeps
 * `background` absent, not `undefined`, under exactOptionalPropertyTypes). */
function base(band: Band): { index: number; background?: Media } {
  return { index: band.index, ...(band.background ? { background: band.background } : {}) };
}

/** Classify one band into a SliceSpec. Conservative: only unambiguous shapes
 * become pattern slices; everything else is a render-faithful Grid fallback. */
export function classifyBand(band: Band, opts: ClassifyOptions = {}): SliceSpec {
  void opts; // used by the widget router (Task 8)
  return { slice: "Grid", ...base(band), root: band.root };
}

export function classifyBands(bands: Band[], opts: ClassifyOptions = {}): SliceSpec[] {
  return bands.map((b) => classifyBand(b, opts));
}
```

- [ ] **Step 4: Export from the barrel** — add to `src/blux/grid/index.ts`:

```ts
export type {
  SliceSpec,
  SliceKind,
  HeroSpec,
  TitleBandSpec,
  SplitFeatureSpec,
  GallerySpec,
  MediaFullSpec,
  RichTextSpec,
  VideoFeatureSpec,
  LocationMapSpec,
  GridSpec,
} from "./slice-spec.js";
export { classifyBand, classifyBands } from "./classify-band.js";
export type { ClassifyOptions } from "./classify-band.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/blux/grid-classify.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/blux/grid/classify-band.ts src/blux/grid/index.ts tests/blux/grid-classify.test.ts
git commit -m "feat(blux): classifyBand skeleton + Grid fallback + barrel exports"
```

---

## Task 4: `TitleBand` + `RichText` (text-only bands)

**Files:**

- Modify: `src/blux/grid/classify-band.ts`
- Test: `tests/blux/grid-classify.test.ts`

Rule (checked in this order, only when there is **no media, no widget, and `topRow` is null**):
- **TitleBand:** ≥1 heading. `heading` = first heading's plain text; `subtitle` = first subtitle's text if present.
- **RichText:** no heading but ≥1 body node (no background). `html` = the body node(s)' HTML joined.

- [ ] **Step 1: Write the failing test**

```ts
describe("classifyBand — text-only", () => {
  it("heading + subtitle with no media/bg → TitleBand", () => {
    const spec = classifyBand(band(realBands(), 2)); // stack[h2,subtitle]
    expect(spec.slice).toBe("TitleBand");
    if (spec.slice === "TitleBand") {
      expect(spec.heading.length).toBeGreaterThan(0);
      expect(spec.subtitle).toBeDefined();
    }
  });

  it("a bare heading → TitleBand", () => {
    const spec = classifyBand(band(realBands(), 15)); // h2
    expect(spec.slice).toBe("TitleBand");
  });

  it("only body text → RichText", () => {
    const only: Band = { index: 99, root: { kind: "body", html: "<p>hello</p>" } };
    const spec = classifyBand(only);
    expect(spec.slice).toBe("RichText");
    if (spec.slice === "RichText") expect(spec.html).toContain("hello");
  });
});
```

- [ ] **Step 2: Run → FAIL** (`band 2` still returns `Grid`).

Run: `pnpm exec vitest run tests/blux/grid-classify.test.ts --no-coverage`

- [ ] **Step 3: Implement** — add helpers + branch before the `Grid` return in `classifyBand`.

Add helpers:

```ts
/** Plain text of a heading/subtitle/body node (tags stripped, whitespace collapsed). */
function nodeText(node: Node): string {
  const html =
    node.kind === "heading" || node.kind === "body"
      ? node.html
      : node.kind === "subtitle"
        ? node.text
        : "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
```

Insert at the top of `classifyBand`, after computing shared locals:

```ts
  const root = band.root;
  const media = collectMedia(root);
  const text = collectText(root);
  const row = topRow(root);
  const headings = text.filter((n) => n.kind === "heading");
  const subtitles = text.filter((n) => n.kind === "subtitle");
  const bodies = text.filter((n) => n.kind === "body");

  // Text-only bands (no media, no row).
  if (media.length === 0 && row === null) {
    if (headings.length > 0 && !band.background) {
      const first = headings[0];
      const sub = subtitles[0];
      return {
        slice: "TitleBand",
        ...base(band),
        heading: first ? nodeText(first) : "",
        ...(sub ? { subtitle: nodeText(sub) } : {}),
      };
    }
    if (headings.length === 0 && bodies.length > 0 && !band.background) {
      return {
        slice: "RichText",
        ...base(band),
        html: bodies.map((b) => (b.kind === "body" ? b.html : "")).join("\n"),
      };
    }
  }
```

> Note: the `!band.background` guard defers backgrounded text bands to the Hero branch (Task 5). `band 7` (bg + heading) intentionally does NOT match TitleBand here.

- [ ] **Step 4: Run → PASS.**

Run: `pnpm exec vitest run tests/blux/grid-classify.test.ts --no-coverage`

- [ ] **Step 5: Commit**

```bash
git add src/blux/grid/classify-band.ts tests/blux/grid-classify.test.ts
git commit -m "feat(blux): classify TitleBand + RichText (text-only bands)"
```

---

## Task 5: `Hero` (background + overlay heading)

**Files:**

- Modify: `src/blux/grid/classify-band.ts`
- Test: `tests/blux/grid-classify.test.ts`

Rule (after the text-only branch, before `Grid`): a band with a `background`, ≥1 heading, `topRow === null`, and no foreground media → **Hero**. `heading`/`subtitle`/`body` are the first of each (all optional on the spec, but heading is required to reach this branch).

- [ ] **Step 1: Write the failing test**

```ts
describe("classifyBand — Hero", () => {
  it("background + overlay heading, no foreground media → Hero", () => {
    const spec = classifyBand(band(realBands(), 7)); // (bg) stack[h2,subtitle]
    expect(spec.slice).toBe("Hero");
    if (spec.slice === "Hero") {
      expect(spec.background?.kind).toBe("image");
      expect(spec.heading).toBeDefined();
      expect(spec.subtitle).toBeDefined();
    }
  });

  it("background but no heading (bg-only) stays Grid", () => {
    const spec = classifyBand(band(realBands(), 4)); // (bg) raw
    expect(spec.slice).toBe("Grid");
  });
});
```

- [ ] **Step 2: Run → FAIL** (`band 7` returns `Grid`).

- [ ] **Step 3: Implement** — insert after the text-only block:

```ts
  // Full-bleed hero: a background image with overlay text and no grid row.
  if (band.background && headings.length > 0 && row === null && media.length === 0) {
    const h = headings[0];
    const sub = subtitles[0];
    const bod = bodies[0];
    return {
      slice: "Hero",
      ...base(band),
      ...(h ? { heading: nodeText(h) } : {}),
      ...(sub ? { subtitle: nodeText(sub) } : {}),
      ...(bod && bod.kind === "body" ? { body: bod.html } : {}),
    };
  }
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/blux/grid/classify-band.ts tests/blux/grid-classify.test.ts
git commit -m "feat(blux): classify Hero (background + overlay heading)"
```

---

## Task 6: `Gallery` + `MediaFull` (media rows / lone media)

**Files:**

- Modify: `src/blux/grid/classify-band.ts`
- Test: `tests/blux/grid-classify.test.ts`

Rules (after Hero, before `Grid`):
- **Gallery:** `topRow` is non-null, has ≥2 cells, and **every** cell's node is a single `media`. `media` = each cell's media, in order.
- **MediaFull:** exactly one media in the subtree, no text, and (`row === null` or a single-cell media row).

- [ ] **Step 1: Write the failing test**

```ts
describe("classifyBand — media", () => {
  it("a row of media cells → Gallery", () => {
    const spec = classifyBand(band(realBands(), 8)); // row[grid-1:media ×3]
    expect(spec.slice).toBe("Gallery");
    if (spec.slice === "Gallery") expect(spec.media).toHaveLength(3);
  });

  it("a single lone media → MediaFull", () => {
    const only: Band = { index: 98, root: { kind: "media", media: { kind: "image", assetId: "x" } } };
    const spec = classifyBand(only);
    expect(spec.slice).toBe("MediaFull");
    if (spec.slice === "MediaFull") expect(spec.media.assetId).toBe("x");
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — add a helper + branches:

```ts
/** If every cell of a row is exactly one media node, return them in order. */
function galleryMedia(cells: Cell[]): Media[] | null {
  const out: Media[] = [];
  for (const c of cells) {
    if (c.node.kind !== "media") return null;
    out.push(c.node.media);
  }
  return out.length >= 2 ? out : null;
}
```

Insert before the fallback:

```ts
  // Gallery: a row whose cells are all single media.
  if (row) {
    const gm = galleryMedia(row);
    if (gm) return { slice: "Gallery", ...base(band), media: gm };
  }

  // MediaFull: one media, no text.
  if (media.length === 1 && text.length === 0) {
    const m = media[0];
    if (m) return { slice: "MediaFull", ...base(band), media: m };
  }
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/blux/grid/classify-band.ts tests/blux/grid-classify.test.ts
git commit -m "feat(blux): classify Gallery + MediaFull"
```

---

## Task 7: `SplitFeature` (two-cell media | text row)

**Files:**

- Modify: `src/blux/grid/classify-band.ts`
- Test: `tests/blux/grid-classify.test.ts`

Rule (after Gallery/MediaFull, before `Grid`): `topRow` has **exactly 2 cells**; **one** cell is a single pure `media` node; the **other** cell contains ≥1 text node. Then:
- `media` = the media cell's media; `mediaSide` = `"left"` if it is cells[0] else `"right"`; `ratio` = the media cell's `token.ratio` (fallback: `100/(token.cols as number)` when no explicit ratio, or `50` when `cols === "any"`); `text` = the other cell's node.

- [ ] **Step 1: Write the failing test**

```ts
describe("classifyBand — SplitFeature", () => {
  it("2-cell row [text-stack | media] → SplitFeature, mediaSide=right", () => {
    const spec = classifyBand(band(realBands(), 1)); // r60 text+media stack | r40 media
    expect(spec.slice).toBe("SplitFeature");
    if (spec.slice === "SplitFeature") {
      expect(spec.mediaSide).toBe("right");
      expect(spec.ratio).toBe(40); // the media cell is grid-2-r40
      expect(spec.media.kind).toBe("image");
      expect(spec.text.kind).toBe("stack");
    }
  });

  it("synthetic [media | text] → mediaSide=left", () => {
    const b: Band = {
      index: 97,
      root: {
        kind: "row",
        cells: [
          { token: { cols: 2, ratio: 60, raw: "grid-2-r60" }, node: { kind: "media", media: { kind: "image", assetId: "m" } } },
          { token: { cols: 2, ratio: 40, raw: "grid-2-r40" }, node: { kind: "body", html: "<p>t</p>" } },
        ],
      },
    };
    const spec = classifyBand(b);
    expect(spec.slice).toBe("SplitFeature");
    if (spec.slice === "SplitFeature") {
      expect(spec.mediaSide).toBe("left");
      expect(spec.ratio).toBe(60);
    }
  });
});
```

> Note the answer-key expectation: band 1's media cell is `grid-2-r40`, so `ratio === 40` and `mediaSide === "right"`. Confirm against `gridSignature` output if the fixture differs.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — add helpers + branch:

```ts
/** The single media of a pure-media cell, or null if the cell isn't pure media. */
function pureCellMedia(cell: Cell): Media | null {
  return cell.node.kind === "media" ? cell.node.media : null;
}

/** A cell's effective column share as a percentage, from its grid token. */
function cellRatio(cell: Cell): number {
  const t = cell.token;
  if (typeof t.ratio === "number") return t.ratio;
  if (typeof t.sized === "number") return t.sized;
  if (t.cols === "any") return 50;
  return Math.round(100 / t.cols);
}
```

Insert before the fallback:

```ts
  // SplitFeature: exactly two cells, one pure media, one text-bearing.
  if (row && row.length === 2) {
    const [c0, c1] = row;
    if (c0 && c1) {
      const m0 = pureCellMedia(c0);
      const m1 = pureCellMedia(c1);
      const t0 = collectText(c0.node).length > 0;
      const t1 = collectText(c1.node).length > 0;
      if (m0 && !m1 && t1) {
        return { slice: "SplitFeature", ...base(band), media: m0, mediaSide: "left", ratio: cellRatio(c0), text: c1.node };
      }
      if (m1 && !m0 && t0) {
        return { slice: "SplitFeature", ...base(band), media: m1, mediaSide: "right", ratio: cellRatio(c1), text: c0.node };
      }
    }
  }
```

- [ ] **Step 4: Run → PASS.**

> If band 1's left cell parses such that `pureCellMedia` is null (a stack) and the right cell is pure media, the `m1 && !m0 && t0` branch fires (mediaSide=right, ratio=40) — matching the answer key. Verify with the real fixture; if band 1 does not match (e.g. the right cell isn't pure media), leave band 1 to the `Grid` fallback and keep only the synthetic test — do **not** loosen the rule to force a match (conservative principle).

- [ ] **Step 5: Commit**

```bash
git add src/blux/grid/classify-band.ts tests/blux/grid-classify.test.ts
git commit -m "feat(blux): classify SplitFeature (2-cell media|text row)"
```

---

## Task 8: Widget router — video + injected map mount

**Files:**

- Modify: `src/blux/grid/classify-band.ts`
- Test: `tests/blux/grid-classify.test.ts`

Two widget behaviors:

1. **Map rewrite (injected).** When `opts.isMapMount` is supplied, DFS-rewrite the band's tree, replacing any node for which `isMapMount(node)` returns true with `{ kind: "widget", widget: { type: "map" } }`. This runs **first**, so downstream classification and the `Grid` fallback see the widget node.
2. **Top-level widget promotion** (checked before the pattern branches):
   - If the (rewritten) root's dominant content is a single map widget (root is the widget, or `topRow`/stack collapses to one significant child that is the widget) → **`LocationMap`**.
   - If the only media is exactly one video and there is no other significant content (no headings, no other media, no widget) → **`VideoFeature`**.

Because band 10 has a video **and** stat images **and** the map mount, it is neither map-dominant nor video-only → it remains a `Grid` fallback whose tree now contains a `widget:map` node when `isMapMount` is injected.

- [ ] **Step 1: Write the failing test**

```ts
import type { Node } from "../../src/blux/grid/types.js";
import { collectWidgets } from "../../src/blux/grid/classify-band.js";

describe("classifyBand — widget router", () => {
  it("video-only band → VideoFeature", () => {
    const b: Band = { index: 96, root: { kind: "media", media: { kind: "video", assetId: "v" } } };
    const spec = classifyBand(b);
    expect(spec.slice).toBe("VideoFeature");
    if (spec.slice === "VideoFeature") expect(spec.media.kind).toBe("video");
  });

  it("injected isMapMount rewrites the mount to a widget:map node (band 10 → Grid with a map widget)", () => {
    const bands = realBands();
    const isMapMount = (n: Node) => isEmptyRawExported(n); // empty block-content mount
    const spec = classifyBand(band(bands, 10), { isMapMount });
    expect(spec.slice).toBe("Grid");
    if (spec.slice === "Grid") {
      expect(collectWidgets(spec.root).some((w) => w.type === "map")).toBe(true);
    }
  });

  it("a map-dominant band → LocationMap", () => {
    const b: Band = { index: 95, root: { kind: "raw", html: '<div class="block-content"></div>' } };
    const spec = classifyBand(b, { isMapMount: (n) => n.kind === "raw" });
    expect(spec.slice).toBe("LocationMap");
  });
});
```

> `isEmptyRawExported` is `isEmptyRaw` (already exported from Task 2) — import it under that name or reuse `isEmptyRaw` directly. `collectWidgets` is added in Step 3.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

Add a widget collector + a pure map-rewrite (mirror `signature.ts`'s exhaustive switch):

```ts
import type { Widget } from "./types.js";

/** DFS collect of every widget in a subtree. */
export function collectWidgets(node: Node): Widget[] {
  switch (node.kind) {
    case "widget":
      return [node.widget];
    case "row":
      return node.cells.flatMap((c) => collectWidgets(c.node));
    case "stack":
      return node.children.flatMap(collectWidgets);
    case "heading":
    case "body":
    case "subtitle":
    case "media":
    case "raw":
      return [];
  }
}

/** Return a copy of the tree with every node matching `isMapMount` replaced by a
 * `widget:map` node. Pure — does not mutate the input. */
function rewriteMapMounts(node: Node, isMapMount: (n: Node) => boolean): Node {
  if (isMapMount(node)) return { kind: "widget", widget: { type: "map" } };
  switch (node.kind) {
    case "row":
      return { kind: "row", cells: node.cells.map((c) => ({ token: c.token, node: rewriteMapMounts(c.node, isMapMount) })) };
    case "stack":
      return { kind: "stack", children: node.children.map((n) => rewriteMapMounts(n, isMapMount)) };
    case "heading":
    case "body":
    case "subtitle":
    case "media":
    case "widget":
    case "raw":
      return node;
  }
}

/** The single significant child of a container (ignoring empty raw), or the node
 * itself. Used to detect a band whose dominant content is one widget. */
function soleSignificant(node: Node): Node {
  const kids = node.kind === "row" ? node.cells.map((c) => c.node) : node.kind === "stack" ? node.children : [node];
  const significant = kids.filter((n) => !isEmptyRaw(n));
  return significant.length === 1 && significant[0] ? significant[0] : node;
}
```

Then at the **very top** of `classifyBand`, replace `const root = band.root;` with the rewrite + widget promotion:

```ts
  const root = opts.isMapMount ? rewriteMapMounts(band.root, opts.isMapMount) : band.root;
  const widgets = collectWidgets(root);

  // Top-level widget promotion (before structural patterns).
  const sole = soleSignificant(root);
  if (sole.kind === "widget" && sole.widget.type === "map") {
    return { slice: "LocationMap", ...base(band) };
  }
```

And update the media/text/row locals to use `root` (they already do). Add the VideoFeature branch right after the LocationMap check:

```ts
  const mediaAll = collectMedia(root);
  if (
    mediaAll.length === 1 &&
    mediaAll[0]?.kind === "video" &&
    collectText(root).length === 0 &&
    widgets.length === 0 &&
    topRow(root) === null
  ) {
    const v = mediaAll[0];
    return { slice: "VideoFeature", ...base(band), media: v };
  }
```

> Reconcile locals: ensure the later branches (Tasks 4–7) read from the same `root`/`media`/`text`/`row` computed once here. Remove the duplicate `const media = collectMedia(root)` if it now shadows; keep a single set of locals at the top of the function. The `void opts;` line from Task 3 is deleted.

- [ ] **Step 4: Run → PASS.**

Run the whole file: `pnpm exec vitest run tests/blux/grid-classify.test.ts --no-coverage`

- [ ] **Step 5: Commit**

```bash
git add src/blux/grid/classify-band.ts tests/blux/grid-classify.test.ts
git commit -m "feat(blux): widget router — video-only + injected map mount + LocationMap"
```

---

## Task 9: Classification golden snapshot (fidelity gate)

Mirror plan-1's `grid-golden.test.ts`: a stable snapshot of the whole page's classification, so any classifier change shows up as a reviewable diff. Use a compact summary (slice + index + key props), **not** the full tree, so the snapshot stays readable.

**Files:**

- Create: `tests/blux/grid-classify-golden.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseGridBands } from "../../src/blux/grid/index.js";
import { classifyBands } from "../../src/blux/grid/classify-band.js";
import type { SliceSpec } from "../../src/blux/grid/slice-spec.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/the-pointe-page-content.html", import.meta.url));

/** One compact, human-readable line per slice. */
function summary(s: SliceSpec): string {
  const bg = s.background ? "(bg)" : "";
  switch (s.slice) {
    case "Hero":
      return `${s.index}${bg} Hero heading=${JSON.stringify(s.heading ?? "")}`;
    case "TitleBand":
      return `${s.index}${bg} TitleBand heading=${JSON.stringify(s.heading)}`;
    case "SplitFeature":
      return `${s.index}${bg} SplitFeature ${s.mediaSide} r${s.ratio}`;
    case "Gallery":
      return `${s.index}${bg} Gallery n=${s.media.length}`;
    case "MediaFull":
      return `${s.index}${bg} MediaFull ${s.media.kind}`;
    case "RichText":
      return `${s.index}${bg} RichText`;
    case "VideoFeature":
      return `${s.index}${bg} VideoFeature`;
    case "LocationMap":
      return `${s.index}${bg} LocationMap`;
    case "Grid":
      return `${s.index}${bg} Grid`;
  }
}

describe("classify golden (the-pointe)", () => {
  it("classifies the 16 bands to a stable set of slices", () => {
    const bands = parseGridBands(readFileSync(FIXTURE, "utf-8"));
    const lines = classifyBands(bands).map(summary);
    expect(lines).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run to generate the snapshot**

Run: `pnpm exec vitest run tests/blux/grid-classify-golden.test.ts --no-coverage`
Expected: PASS (writes `tests/blux/__snapshots__/grid-classify-golden.test.ts.snap`).

- [ ] **Step 3: Eyeball the snapshot** against the coverage table in "Key design decisions": expect 3 `TitleBand` (2, 13, 15), 1 `Hero` (7), 1 `Gallery` (8), and the rest `Grid` (band 1 `SplitFeature` iff it matched in Task 7; otherwise `Grid`). No `LocationMap`/`VideoFeature` (no `isMapMount` injected here). If a band is misclassified, fix the classifier, not the snapshot.

- [ ] **Step 4: Commit**

```bash
git add tests/blux/grid-classify-golden.test.ts tests/blux/__snapshots__/grid-classify-golden.test.ts.snap
git commit -m "test(blux): classification golden snapshot over the-pointe 16 bands"
```

---

## Task 10: Full-gate verification

- [ ] **Step 1:** `pnpm typecheck` → both tsconfigs clean. (Watch the strict flags: `noUncheckedIndexedAccess` on `arr[i]`/regex groups; `exactOptionalPropertyTypes` on every optional spec field.)
- [ ] **Step 2:** `pnpm lint` → eslint + prettier clean (`pnpm format` if needed). No `any` (the tests type nodes explicitly).
- [ ] **Step 3:** `pnpm build` → tsup clean.
- [ ] **Step 4:** `pnpm test:coverage` → all pass, coverage above floors (statements 78 / branches 67 / functions 76 / lines 80). Every new `src` function is exercised; the exhaustive `switch` arms with no reachable body are covered by `collectMedia`/`collectWidgets`/`rewriteMapMounts` tests. (Local quirk from plan 1: if the globalSetup stale-dist rebuild trips a pre-existing TS error under typescript@6.x, `touch dist/cli/bin.js` then re-run — does not occur in CI.)
- [ ] **Step 5:** `pnpm test:dist` → import-graph smoke OK. The classifier is a pure grid module with no central-only imports; verify it does not pull anything into an audit import path.
- [ ] **Step 6:** Confirm the working tree is clean and the branch is a stack of small commits ready for review.

---

## Self-review checklist (controller, before final review)

- `SliceSpec` is the single IR; no `StatGrid` variant (deferred, decision #4); the union and the `index.ts` barrel agree.
- Classification is conservative: every non-matching band returns `Grid` carrying its (widget-rewritten) `root`. No band silently loses layout.
- The map is handled **only** via the injected `isMapMount` — no `initMap`/script parsing in this plan (that is plan 4).
- All optional spec fields use conditional spread (no `undefined` assignments under `exactOptionalPropertyTypes`).
- Every node-walking helper mirrors `signature.ts`'s exhaustive `switch (node.kind)` — a future node kind is a compile error.
- The golden snapshot matches the real-band coverage table; classifier bugs are fixed in code, never by editing the snapshot.
- Delivery is branch + commits only; nothing pushes (RED tier).
