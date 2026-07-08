# Blux grid-tree parser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse the Blux rendered `index.html` into a recursive **grid tree**
(`Band[]`) that faithfully captures the page's rows, column ratios, typed leaf
content, media, and text roles — the layout the current `site.json`-only pipeline
throws away.

**Architecture:** A new, self-contained module `src/blux/grid/` that adds the first
HTML-DOM parser to the pipeline (`node-html-parser`). It reads structure from the
rendered HTML only; it does not touch `site.json`, Prismic, or the existing IR. Its
output (`Band[]`) is the input contract for the later classifier/emit plans. This
plan delivers the parser + a golden snapshot against the-pointe answer key + a
`blux grid` CLI action that writes `grid-tree.json` for eyeballing.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), `node-html-parser`,
vitest (tests under `tests/blux/`, run with `pnpm exec vitest run <file>`).

**Spec:** `docs/superpowers/specs/2026-07-08-blux-faithful-grid-slices-design.md`.
This is **plan 1 of a sequence** against that spec. Downstream plans (not detailed
here): (2) band classifier + widget router, (3) slice components + recursive
`Grid.svelte` in the-pointe, (4) `extract-map` + `LocationMap`, (5) emit paths, (6)
`validate` layout-signature check, (7) the-pointe migrate + verify, (8) promote to
starter. Each consumes the `Band[]` this plan produces.

**Scope boundaries (what this plan does NOT do):**

- No role→font resolution, no Prismic emit, no slice mapping — just the tree.
- No map/video _widget_ identification. The map mount div (`#burbank_map`) has a
  site-specific id; it is preserved as a `raw` node (never dropped) for plan 2 to
  identify. `<video>` IS parsed as a `media` node of kind `video` (that's structural,
  not widget routing).
- No `site.json` correlation — roles come straight from the rendered HTML class
  (`text\d+`), which the DOM inspection confirmed is present on every heading/body.

---

## Grid-tree model (the output contract)

```ts
// A cell's layout, parsed from its grid-* class token.
type GridToken = {
  cols: number | "any"; // grid-2 -> 2, grid-4 -> 4, grid-any-s20 -> "any"
  ratio?: number; // grid-2-r60 -> 60 (this cell's % of a 2-col row)
  sized?: number; // grid-1-s40 -> 40 (fixed-sized cell)
  raw: string; // "grid-2-r60"
};

type Media = { kind: "image" | "video"; assetId: string; ext?: string };
type Widget = { type: "map" }; // forward-declared; parser does not emit yet

type Node =
  | { kind: "row"; cells: Cell[] } // a horizontal grid (.cagrid, or ibb holders)
  | { kind: "stack"; children: Node[] } // a vertical flow of >1 nodes
  | { kind: "heading"; role?: string; level: number; html: string } // block-title
  | { kind: "body"; role?: string; html: string } // block-body
  | { kind: "subtitle"; role?: string; text: string } // block-subtitle
  | { kind: "media"; media: Media } // block-media-holder / <video>
  | { kind: "widget"; widget: Widget } // (plan 2)
  | { kind: "raw"; html: string }; // unrecognized — preserved, never dropped

type Cell = { token: GridToken; node: Node };
type Band = { index: number; background?: Media; root: Node };
```

Refinement vs the spec: the spec's `Node` union is extended with `stack` (a vertical
flow container — the spec implied a single `root: Node`, but a band's content is
usually several stacked leaves) and `raw` (a never-drop fallback for fidelity). Both
are noted here as deliberate implementation refinements.

---

## File Structure

- Create `src/blux/grid/types.ts` — the types above. One responsibility: the shared
  data model. No logic.
- Create `src/blux/grid/token.ts` — `parseGridToken(className)`. Pure string→token.
- Create `src/blux/grid/leaf.ts` — leaf helpers: `textRoleFromClass`, `headingLevel`,
  `mediaFromElement`. Pure per-element classification.
- Create `src/blux/grid/parse-grid.ts` — the recursive parser: `parseNode`,
  `parseContainer`, `collectStructuralChildren`, and the top-level `parseGridBands`.
- Create `src/blux/grid/signature.ts` — `gridSignature(bands)`: a compact structural
  serialization used by the golden test (and reused by plan 6's layout check).
- Create `src/blux/grid/index.ts` — re-exports the public surface
  (`parseGridBands`, `gridSignature`, and the types).
- Modify `src/cli/commands/blux.ts` — add a `grid` action that writes `grid-tree.json`.
- Modify `src/cli/bin.ts` — mention `grid` in the `blux` command description.
- Test files under `tests/blux/`: `grid-token.test.ts`, `grid-leaf.test.ts`,
  `grid-parse.test.ts`, `grid-bands.test.ts`, `grid-golden.test.ts`.
- Fixture `tests/blux/fixtures/the-pointe-page-content.html` — the `#page-content`
  subtree of the-pointe answer key (no `<head>`/`<script>`/inline-CSS, so no API key
  is committed), extracted by a one-time command in Task 6.

---

## Task 1: Add the HTML parser dependency and the type model

**Files:**

- Modify: `package.json` (add `node-html-parser` to `dependencies`)
- Create: `src/blux/grid/types.ts`

- [ ] **Step 1: Add the dependency**

Run: `pnpm add node-html-parser`
Expected: `node-html-parser` appears under `dependencies` in `package.json` and
`pnpm-lock.yaml` updates. (It is a pure-JS, zero-native-dep parser with a
`querySelector`/`classList` API.)

- [ ] **Step 2: Create the type model**

Create `src/blux/grid/types.ts` with exactly the model from the "Grid-tree model"
section above:

```ts
export type GridToken = {
  cols: number | "any";
  ratio?: number;
  sized?: number;
  raw: string;
};

export type Media = { kind: "image" | "video"; assetId: string; ext?: string };
export type Widget = { type: "map" };

export type Node =
  | { kind: "row"; cells: Cell[] }
  | { kind: "stack"; children: Node[] }
  | { kind: "heading"; role?: string; level: number; html: string }
  | { kind: "body"; role?: string; html: string }
  | { kind: "subtitle"; role?: string; text: string }
  | { kind: "media"; media: Media }
  | { kind: "widget"; widget: Widget }
  | { kind: "raw"; html: string };

export type Cell = { token: GridToken; node: Node };
export type Band = { index: number; background?: Media; root: Node };
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors (types-only file compiles).

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/blux/grid/types.ts
git commit -m "feat(blux): grid-tree types + node-html-parser dep"
```

---

## Task 2: Parse a grid-\* class token

**Files:**

- Create: `src/blux/grid/token.ts`
- Test: `tests/blux/grid-token.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/blux/grid-token.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseGridToken } from "../../src/blux/grid/token.js";

describe("parseGridToken", () => {
  it("reads an equal-column token", () => {
    expect(parseGridToken("block-subcontent cagriditem top grid-2 ")).toEqual({
      cols: 2,
      raw: "grid-2",
    });
    expect(parseGridToken("grid-4")).toEqual({ cols: 4, raw: "grid-4" });
    expect(parseGridToken("grid-1")).toEqual({ cols: 1, raw: "grid-1" });
  });
  it("reads a ratio split token", () => {
    expect(parseGridToken("cagriditem grid-2-r60")).toEqual({
      cols: 2,
      ratio: 60,
      raw: "grid-2-r60",
    });
    expect(parseGridToken("block-media-holder ibb top grid-2-r20 ")).toEqual({
      cols: 2,
      ratio: 20,
      raw: "grid-2-r20",
    });
  });
  it("reads a fixed-sized token", () => {
    expect(parseGridToken("cagriditem top grid-1-s40 ")).toEqual({
      cols: 1,
      sized: 40,
      raw: "grid-1-s40",
    });
    expect(parseGridToken("grid-any-s20")).toEqual({
      cols: "any",
      sized: 20,
      raw: "grid-any-s20",
    });
  });
  it("ignores grid-container and returns null when no token is present", () => {
    expect(parseGridToken("block-grid-container cagrid")).toBeNull();
    expect(parseGridToken("block-content valignmiddleitem")).toBeNull();
    expect(parseGridToken("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/blux/grid-token.test.ts`
Expected: FAIL — `parseGridToken` is not defined / module not found.

- [ ] **Step 3: Implement**

Create `src/blux/grid/token.ts`:

```ts
import type { GridToken } from "./types.js";

const TOKEN_RE = /\bgrid-(\d+|any)(?:-(r|s)(\d+))?\b/;

/** Parse the `grid-*` layout token out of an element's class string.
 * `grid-2` -> equal 2-col; `grid-2-r60` -> 60% of a 2-col row; `grid-1-s40` ->
 * fixed-sized cell. Returns null when the class has no grid token (e.g.
 * `grid-container`, which carries no column count). */
export function parseGridToken(className: string): GridToken | null {
  const m = TOKEN_RE.exec(className);
  if (!m) return null;
  const cols = m[1] === "any" ? "any" : Number(m[1]);
  const token: GridToken = { cols, raw: m[0] };
  if (m[2] === "r") token.ratio = Number(m[3]);
  if (m[2] === "s") token.sized = Number(m[3]);
  return token;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm exec vitest run tests/blux/grid-token.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/blux/grid/token.ts tests/blux/grid-token.test.ts
git commit -m "feat(blux): parse grid-* layout tokens"
```

---

## Task 3: Leaf classification helpers (role, heading level, media)

**Files:**

- Create: `src/blux/grid/leaf.ts`
- Test: `tests/blux/grid-leaf.test.ts`

`node-html-parser`'s `parse()` returns an `HTMLElement` whose nodes expose
`.tagName` (upper-case, e.g. `"H1"`, or `null` for text), `.classNames` (the raw
class string), `.getAttribute(name)`, `.querySelector(sel)`, `.innerHTML`, and
`.childNodes`. These helpers operate on a single `HTMLElement`.

- [ ] **Step 1: Write the failing test**

Create `tests/blux/grid-leaf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import { textRoleFromClass, headingLevel, mediaFromElement } from "../../src/blux/grid/leaf.js";

const el = (html: string) => parse(html).firstChild as any;

describe("textRoleFromClass", () => {
  it("extracts the textN role token", () => {
    expect(textRoleFromClass("block-title text5")).toBe("text5");
    expect(textRoleFromClass("block-body text1 margin-20r")).toBe("text1");
    expect(textRoleFromClass("block-subtitle text13")).toBe("text13");
  });
  it("returns undefined when no role token is present", () => {
    expect(textRoleFromClass("block-title")).toBeUndefined();
    expect(textRoleFromClass("")).toBeUndefined();
  });
});

describe("headingLevel", () => {
  it("reads the level off an h1..h6 tag", () => {
    expect(headingLevel(el("<h1 class='block-title'>x</h1>"))).toBe(1);
    expect(headingLevel(el("<h5 class='block-title'>x</h5>"))).toBe(5);
  });
});

describe("mediaFromElement", () => {
  it("reads an image asset from a block-media-holder's camediaload child", () => {
    const holder = el(
      '<div class="block-media-holder ibb top grid-2-r20"><div class="ib img imgfit camediaload" data-ext="png" data-media="449cb545-61ab"></div></div>',
    );
    expect(mediaFromElement(holder)).toEqual({
      kind: "image",
      assetId: "449cb545-61ab",
      ext: "png",
    });
  });
  it("reads a video asset id from a <video> src", () => {
    const v = el(
      '<video src="https://dv4tl7yyk1zlp.cloudfront.net/site-1/c023afe4-996f.mp4" controls></video>',
    );
    expect(mediaFromElement(v)).toEqual({
      kind: "video",
      assetId: "c023afe4-996f",
      ext: "mp4",
    });
  });
  it("returns null when the element holds no media", () => {
    expect(mediaFromElement(el("<div class='block-content'>x</div>"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/blux/grid-leaf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/blux/grid/leaf.ts`:

```ts
import type { HTMLElement } from "node-html-parser";
import type { Media } from "./types.js";

const ROLE_RE = /\btext\d+\b/;

/** The Blux text role (`text5`, `text11`, …) carried on a block-title/body/subtitle
 * element's class in the rendered HTML, or undefined when none is present. */
export function textRoleFromClass(className: string): string | undefined {
  return ROLE_RE.exec(className)?.[0];
}

/** The heading level (1..6) for an h1..h6 element. */
export function headingLevel(el: HTMLElement): number {
  const m = /^H([1-6])$/.exec(el.tagName ?? "");
  return m ? Number(m[1]) : 2;
}

/** The last path segment of a CDN url, sans extension (the Blux asset uuid). */
function uuidFromUrl(url: string): { id: string; ext?: string } {
  const file = url.split(/[?#]/)[0].split("/").pop() ?? "";
  const dot = file.lastIndexOf(".");
  return dot > 0 ? { id: file.slice(0, dot), ext: file.slice(dot + 1) } : { id: file };
}

/** Resolve the media an element carries: a `.camediaload` descendant (image, via
 * `data-media`) or a `<video>` (via its src uuid). Returns null when there is none. */
export function mediaFromElement(el: HTMLElement): Media | null {
  if (el.tagName === "VIDEO") {
    const src = el.getAttribute("src") ?? "";
    const { id, ext } = uuidFromUrl(src);
    return id ? { kind: "video", assetId: id, ext } : null;
  }
  const img =
    el.classNames.includes("camediaload") && el.getAttribute("data-media")
      ? el
      : el.querySelector(".camediaload[data-media]");
  if (img) {
    const assetId = img.getAttribute("data-media");
    if (assetId) {
      const ext = img.getAttribute("data-ext") ?? undefined;
      return { kind: "image", assetId, ...(ext ? { ext } : {}) };
    }
  }
  const video = el.querySelector("video");
  if (video) return mediaFromElement(video);
  return null;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm exec vitest run tests/blux/grid-leaf.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/blux/grid/leaf.ts tests/blux/grid-leaf.test.ts
git commit -m "feat(blux): grid leaf helpers (role, heading level, media)"
```

---

## Task 4: The recursive node parser

**Files:**

- Create: `src/blux/grid/parse-grid.ts` (this task adds `parseNode`,
  `parseContainer`, `collectStructuralChildren`; Task 5 adds `parseGridBands`)
- Test: `tests/blux/grid-parse.test.ts`

**Algorithm.** `parseNode(el)` dispatches: a `block-title` h-tag → `heading`; a
`block-body` → `body`; a `block-subtitle` → `subtitle`; a `block-media-holder` or
`<video>` → `media`; anything else → `parseContainer(el)`.

`parseContainer(el)` gathers `collectStructuralChildren(el)` — the child elements
that matter, after peeling pure wrapper divs (`block-holder`, `block-content`,
`block-sub-item-container`, and `block-grid-container`/`block-subcontent` that carry
no grid token). It then decides:

- If `el` is a `.cagrid`, **or** ≥2 of the gathered children carry a grid token →
  a `row` whose cells pair each child's token (defaulting to `grid-1`) with its
  parsed node. This unifies `.cagrid`/`.cagriditem` grids with the `ibb`
  media-holder/title-holder pairs.
- Else exactly 1 child → that child's node (transparent).
- Else ≥2 children → a `stack`.
- Else (no structural children) → a `raw` node preserving `el.innerHTML`.

A child is "structural" when it is a leaf (`block-title`/`block-body`/
`block-subtitle`/`block-media-holder`/`<video>`), a `.cagrid`, or carries a grid
token; otherwise it is a wrapper to peel through.

- [ ] **Step 1: Write the failing test**

Create `tests/blux/grid-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import { parseNode } from "../../src/blux/grid/parse-grid.js";

const node = (html: string) => parseNode(parse(html).firstChild as any);

describe("parseNode", () => {
  it("parses a heading leaf with its role and level", () => {
    expect(node("<h5 class='block-title text5'>The <b>Pointe</b></h5>")).toEqual({
      kind: "heading",
      role: "text5",
      level: 5,
      html: "The <b>Pointe</b>",
    });
  });

  it("parses a body leaf", () => {
    expect(node("<div class='block-body text1'><p>Hello</p></div>")).toEqual({
      kind: "body",
      role: "text1",
      html: "<p>Hello</p>",
    });
  });

  it("peels wrapper divs down to a single leaf", () => {
    const html =
      "<div class='block-content valignmiddleitem'><div class='block-subtitle text13'>Eyebrow</div></div>";
    expect(node(html)).toEqual({
      kind: "subtitle",
      role: "text13",
      text: "Eyebrow",
    });
  });

  it("stacks multiple sibling leaves under a container", () => {
    const html =
      "<div class='block-content'><h2 class='block-title text5'>Title</h2><div class='block-body text1'>Body</div></div>";
    expect(node(html)).toEqual({
      kind: "stack",
      children: [
        { kind: "heading", role: "text5", level: 2, html: "Title" },
        { kind: "body", role: "text1", html: "Body" },
      ],
    });
  });

  it("parses a .cagrid into a row of cells with their tokens", () => {
    const html =
      "<div class='block-grid-container cagrid'>" +
      "<div class='block-subcontent cagriditem top grid-2-r60'><div class='block-content'><h1 class='block-title text5'>L</h1></div></div>" +
      "<div class='block-subcontent cagriditem top grid-2-r40'><div class='block-content'><div class='block-media-holder'><div class='camediaload' data-media='abc' data-ext='png'></div></div></div></div>" +
      "</div>";
    expect(node(html)).toEqual({
      kind: "row",
      cells: [
        {
          token: { cols: 2, ratio: 60, raw: "grid-2-r60" },
          node: { kind: "heading", role: "text5", level: 1, html: "L" },
        },
        {
          token: { cols: 2, ratio: 40, raw: "grid-2-r40" },
          node: { kind: "media", media: { kind: "image", assetId: "abc", ext: "png" } },
        },
      ],
    });
  });

  it("treats ibb media+title holders as an implicit row (the stat pattern)", () => {
    const html =
      "<div class='block-content'>" +
      "<div class='block-media-holder ibb top grid-2-r20'><div class='camediaload' data-media='ic' data-ext='png'></div></div>" +
      "<div class='block-title-holder ibb top grid-2-r80'><h5 class='block-title text5'>Label</h5></div>" +
      "</div>";
    expect(node(html)).toEqual({
      kind: "row",
      cells: [
        {
          token: { cols: 2, ratio: 20, raw: "grid-2-r20" },
          node: { kind: "media", media: { kind: "image", assetId: "ic", ext: "png" } },
        },
        {
          token: { cols: 2, ratio: 80, raw: "grid-2-r80" },
          node: { kind: "heading", role: "text5", level: 5, html: "Label" },
        },
      ],
    });
  });

  it("preserves an unrecognized empty container as a raw node", () => {
    expect(node("<div id='burbank_map'></div>")).toEqual({
      kind: "raw",
      html: "",
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/blux/grid-parse.test.ts`
Expected: FAIL — `parseNode` not exported.

- [ ] **Step 3: Implement**

Create `src/blux/grid/parse-grid.ts`:

```ts
import type { HTMLElement, Node as HTMLNode } from "node-html-parser";
import type { Cell, GridToken, Node } from "./types.js";
import { parseGridToken } from "./token.js";
import { textRoleFromClass, headingLevel, mediaFromElement } from "./leaf.js";

const DEFAULT_TOKEN: GridToken = { cols: 1, raw: "grid-1" };

const isElement = (n: HTMLNode): n is HTMLElement =>
  (n as HTMLElement).tagName !== undefined && (n as HTMLElement).tagName !== null;

const hasClass = (el: HTMLElement, c: string) => el.classNames.split(/\s+/).includes(c);

const isLeafElement = (el: HTMLElement): boolean =>
  hasClass(el, "block-title") ||
  hasClass(el, "block-body") ||
  hasClass(el, "block-subtitle") ||
  hasClass(el, "block-media-holder") ||
  el.tagName === "VIDEO";

/** Is this element a structural boundary (a leaf, a grid row, or a token-bearing
 * cell/holder), as opposed to a pure wrapper div we should peel through? */
const isStructural = (el: HTMLElement): boolean =>
  isLeafElement(el) || hasClass(el, "cagrid") || parseGridToken(el.classNames) !== null;

/** The child elements that carry structure, peeling pure wrapper divs. */
export function collectStructuralChildren(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const child of el.childNodes) {
    if (!isElement(child)) continue;
    if (isStructural(child)) out.push(child);
    else out.push(...collectStructuralChildren(child));
  }
  return out;
}

/** Parse one element into a grid Node. Leaves dispatch by role; everything else
 * becomes a row / stack / single / raw via parseContainer. */
export function parseNode(el: HTMLElement): Node {
  if (hasClass(el, "block-title") && /^H[1-6]$/.test(el.tagName ?? "")) {
    return {
      kind: "heading",
      ...(textRoleFromClass(el.classNames) ? { role: textRoleFromClass(el.classNames) } : {}),
      level: headingLevel(el),
      html: el.innerHTML,
    };
  }
  if (hasClass(el, "block-body")) {
    return {
      kind: "body",
      ...(textRoleFromClass(el.classNames) ? { role: textRoleFromClass(el.classNames) } : {}),
      html: el.innerHTML,
    };
  }
  if (hasClass(el, "block-subtitle")) {
    return {
      kind: "subtitle",
      ...(textRoleFromClass(el.classNames) ? { role: textRoleFromClass(el.classNames) } : {}),
      text: el.text.trim(),
    };
  }
  if (hasClass(el, "block-media-holder") || el.tagName === "VIDEO") {
    const media = mediaFromElement(el);
    if (media) return { kind: "media", media };
  }
  return parseContainer(el);
}

/** Parse a wrapper/cell/band-body element: a row when it is a grid or holds
 * ≥2 token-bearing children, else a stack / single / raw. */
export function parseContainer(el: HTMLElement): Node {
  const kids = collectStructuralChildren(el);
  const tokens = kids.map((k) => parseGridToken(k.classNames));
  const isGrid = hasClass(el, "cagrid");
  const tokenCount = tokens.filter(Boolean).length;

  if ((isGrid || tokenCount >= 2) && kids.length > 0) {
    const cells: Cell[] = kids.map((k, i) => ({
      token: tokens[i] ?? DEFAULT_TOKEN,
      node: parseNode(k),
    }));
    return { kind: "row", cells };
  }
  if (kids.length === 1) return parseNode(kids[0]);
  if (kids.length === 0) return { kind: "raw", html: el.innerHTML };
  return { kind: "stack", children: kids.map((k) => parseNode(k)) };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm exec vitest run tests/blux/grid-parse.test.ts`
Expected: PASS (7 tests). If the `.cagrid` cell case fails because a `cagriditem`
also carries a token and is double-classified, confirm `parseNode(cagriditem)` routes
to `parseContainer` (a `cagriditem` is not a leaf), which then peels its
`block-content` wrapper to the inner leaf — the token stays on the cell, not the node.

- [ ] **Step 5: Commit**

```bash
git add src/blux/grid/parse-grid.ts tests/blux/grid-parse.test.ts
git commit -m "feat(blux): recursive grid-node parser (rows, stacks, leaves)"
```

---

## Task 5: Split the page into top-level bands

**Files:**

- Modify: `src/blux/grid/parse-grid.ts` (add `parseGridBands`)
- Create: `src/blux/grid/index.ts`
- Test: `tests/blux/grid-bands.test.ts`

Top-level bands are the direct children of `#page-content` whose `id` matches
`page-block-N`. `N` is the band index. A band wrapper that itself has class
`camediaload` + a `data-media` attribute carries a background image for the band.

- [ ] **Step 1: Write the failing test**

Create `tests/blux/grid-bands.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseGridBands } from "../../src/blux/grid/index.js";

describe("parseGridBands", () => {
  it("splits #page-content into indexed bands and reads band backgrounds", () => {
    const html = `<html><body><div id="page-content">
      <div class="blocks2 camediaload" id="page-block-0" data-media="bg0" data-ext="jpg">
        <div class="block-holder"><div class="block-content valignmiddleitem">
          <div class="block-subtitle text13">Eyebrow</div>
        </div></div>
      </div>
      <section class="blocks0" id="page-block-1">
        <div class="block-content"><h2 class="block-title text5">Title</h2></div>
      </section>
    </div></body></html>`;
    const bands = parseGridBands(html);
    expect(bands).toHaveLength(2);
    expect(bands[0]).toEqual({
      index: 0,
      background: { kind: "image", assetId: "bg0", ext: "jpg" },
      root: { kind: "subtitle", role: "text13", text: "Eyebrow" },
    });
    expect(bands[1]).toEqual({
      index: 1,
      root: { kind: "heading", role: "text5", level: 2, html: "Title" },
    });
  });

  it("returns an empty array when there is no #page-content", () => {
    expect(parseGridBands("<html><body><p>x</p></body></html>")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/blux/grid-bands.test.ts`
Expected: FAIL — `parseGridBands` not exported / `index.js` missing.

- [ ] **Step 3: Implement `parseGridBands`**

Append to `src/blux/grid/parse-grid.ts`:

```ts
import { parse } from "node-html-parser";
import type { Band, Media } from "./types.js";

const BAND_ID_RE = /^page-block-(\d+)$/;

/** Read the band-level background media off a `camediaload` band wrapper. */
function bandBackground(el: HTMLElement): Media | undefined {
  if (!hasClass(el, "camediaload")) return undefined;
  const assetId = el.getAttribute("data-media");
  if (!assetId) return undefined;
  const ext = el.getAttribute("data-ext") ?? undefined;
  return { kind: "image", assetId, ...(ext ? { ext } : {}) };
}

/** Parse the rendered Blux index.html into the page's top-level band tree. */
export function parseGridBands(html: string): Band[] {
  const root = parse(html);
  const content = root.querySelector("#page-content");
  if (!content) return [];
  const bands: Band[] = [];
  for (const child of content.childNodes) {
    if (!isElement(child)) continue;
    const m = BAND_ID_RE.exec(child.getAttribute("id") ?? "");
    if (!m) continue;
    const background = bandBackground(child);
    bands.push({
      index: Number(m[1]),
      ...(background ? { background } : {}),
      root: parseContainer(child),
    });
  }
  return bands;
}
```

Note: `parseContainer` on the band wrapper peels `block-holder`/`block-content` to
the real content; the band's own `data-media` is read separately as `background`, so
it is not double-counted as a child media node (it is an attribute, not a child
element).

- [ ] **Step 4: Create the public barrel**

Create `src/blux/grid/index.ts`:

```ts
export type { Band, Node, Cell, GridToken, Media, Widget } from "./types.js";
export { parseGridBands, parseNode } from "./parse-grid.js";
export { parseGridToken } from "./token.js";
export { gridSignature } from "./signature.js";
```

Note: `./signature.js` is created in Task 6; if running strictly task-by-task,
temporarily omit that last re-export until Task 6, then add it back.

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm exec vitest run tests/blux/grid-bands.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/blux/grid/parse-grid.ts src/blux/grid/index.ts tests/blux/grid-bands.test.ts
git commit -m "feat(blux): split rendered index.html into top-level grid bands"
```

---

## Task 6: Golden snapshot against the-pointe answer key

**Files:**

- Create: `src/blux/grid/signature.ts`
- Create: `tests/blux/fixtures/the-pointe-page-content.html` (generated, one-time)
- Test: `tests/blux/grid-golden.test.ts`

- [ ] **Step 1: Generate the fixture from the local answer key**

Run (one-time; requires the operator's local export at `~/Desktop/thePointe/index.html`):

```bash
python3 - ~/Desktop/thePointe/index.html tests/blux/fixtures/the-pointe-page-content.html <<'PY'
import sys, re
src, dst = sys.argv[1], sys.argv[2]
h = open(src, encoding="utf-8").read()
i = h.find('id="page-content"')
start = h.rfind("<", 0, i)
# walk forward to the matching </div> for #page-content
depth = 0; j = start
for m in re.finditer(r"<(/?)(div|section)\b[^>]*>", h[start:]):
    depth += -1 if m.group(1) else 1
    if depth == 0:
        j = start + m.end(); break
open(dst, "w", encoding="utf-8").write(h[start:j])
print("wrote", dst, j - start, "bytes")
PY
```

Expected: writes `tests/blux/fixtures/the-pointe-page-content.html` (~40–60 KB). It
contains only the `#page-content` subtree — no `<head>`, no `<script>` (so the
referrer-restricted Maps key is NOT committed), no inline CSS.

If the local file is absent, skip this task's golden test by leaving the fixture out;
the unit tests above still fully cover the parser. Prefer generating it — the golden
test is what proves fidelity against the real answer key.

- [ ] **Step 2: Write the failing test**

Create `tests/blux/grid-golden.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseGridBands, gridSignature } from "../../src/blux/grid/index.js";

const fixture = fileURLToPath(new URL("./fixtures/the-pointe-page-content.html", import.meta.url));
const hasFixture = existsSync(fixture);

describe.skipIf(!hasFixture)("grid parser — the-pointe golden", () => {
  const bands = parseGridBands(readFileSync(fixture, "utf-8"));

  it("parses all 16 top-level bands with contiguous indices", () => {
    expect(bands.length).toBe(16);
    expect(bands.map((b) => b.index)).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });

  it("finds the hero band background and real grid rows", () => {
    expect(bands[0].background?.kind).toBe("image");
    // at least one band is a real multi-cell grid (not a flat stack)
    const rows = bands.filter((b) => b.root.kind === "row");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("has a stable structural signature", () => {
    expect(gridSignature(bands)).toMatchSnapshot();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm exec vitest run tests/blux/grid-golden.test.ts`
Expected: FAIL — `gridSignature` not exported.

- [ ] **Step 4: Implement `gridSignature`**

Create `src/blux/grid/signature.ts`:

```ts
import type { Band, Node } from "./types.js";

/** A compact, stable string form of a node's structure (kinds + tokens, no prose),
 * used to snapshot layout fidelity and (in plan 6) diff a converted page against
 * the answer key. */
function sig(node: Node): string {
  switch (node.kind) {
    case "row":
      return `row[${node.cells.map((c) => `${c.token.raw}:${sig(c.node)}`).join(",")}]`;
    case "stack":
      return `stack[${node.children.map(sig).join(",")}]`;
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

/** One signature line per band: `bandN(bg?): <node-signature>`. */
export function gridSignature(bands: Band[]): string[] {
  return bands.map((b) => `band${b.index}${b.background ? "(bg)" : ""}: ${sig(b.root)}`);
}
```

Then add the `gridSignature` re-export back to `src/blux/grid/index.ts` if it was
omitted in Task 5.

- [ ] **Step 5: Run it and watch it pass; review the snapshot**

Run: `pnpm exec vitest run tests/blux/grid-golden.test.ts`
Expected: PASS (3 tests). The first run writes
`tests/blux/__snapshots__/grid-golden.test.ts.snap`. **Read that snapshot** — every
band should read as a plausible layout (rows with sensible tokens, the stat band as
a `row` of `grid-1-s40` cells each `row[grid-2-r20:media,grid-2-r80:h5]`, the map
band as `raw`). If a band is unexpectedly `raw` or a `row` collapsed to a single
`stack`, that is a parser gap to fix before committing the snapshot.

- [ ] **Step 6: Commit**

```bash
git add src/blux/grid/signature.ts src/blux/grid/index.ts \
  tests/blux/fixtures/the-pointe-page-content.html \
  tests/blux/grid-golden.test.ts tests/blux/__snapshots__/grid-golden.test.ts.snap
git commit -m "test(blux): golden grid-tree snapshot vs the-pointe answer key"
```

---

## Task 7: `blux grid` CLI action → grid-tree.json

**Files:**

- Modify: `src/cli/commands/blux.ts`
- Modify: `src/cli/bin.ts` (description only)
- Test: `tests/blux/grid-cli.test.ts`

This gives the operator a real artifact to eyeball and sets the seam plan 2 reads.
It reads `index.html` from the export dir, parses it, and writes
`<out>/grid-tree.json`.

- [ ] **Step 1: Write the failing test**

Create `tests/blux/grid-cli.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBluxCommand } from "../../src/cli/commands/blux.js";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "blux-grid-"));
  await writeFile(
    join(dir, "index.html"),
    `<html><body><div id="page-content"><section class="blocks0" id="page-block-0"><div class="block-content"><h1 class="block-title text5">Hi</h1></div></section></div></body></html>`,
  );
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("blux grid", () => {
  it("writes a grid-tree.json of the parsed bands", async () => {
    const res = await runBluxCommand("grid", dir, { cwd: dir });
    expect(res.code).toBe(0);
    const tree = JSON.parse(await readFile(join(dir, "blux-out", "grid-tree.json"), "utf-8"));
    expect(tree).toHaveLength(1);
    expect(tree[0].root).toEqual({
      kind: "heading",
      role: "text5",
      level: 1,
      html: "Hi",
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tests/blux/grid-cli.test.ts`
Expected: FAIL — `runBluxCommand("grid", …)` hits the unknown-action branch (code 1).

- [ ] **Step 3: Implement the action**

In `src/cli/commands/blux.ts`, add a branch before the unknown-action fallthrough
(mirroring how the `validate` action reads `index.html` at line ~169). Add the import
at the top of the file:

```ts
import { parseGridBands } from "../../blux/grid/index.js";
```

Then the action (place alongside the other `if (action === …)` blocks):

```ts
if (action === "grid") {
  const html = await readFile(join(dir, "index.html"), "utf-8");
  const bands = parseGridBands(html);
  const outDir = opts.out ?? join(dir, "blux-out");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "grid-tree.json"), JSON.stringify(bands, null, 2));
  return {
    output: `Parsed ${bands.length} bands → ${join(outDir, "grid-tree.json")}`,
    code: 0,
  };
}
```

Confirm `readFile`, `writeFile`, `mkdir`, and `join` are already imported at the top
of `blux.ts` (the `emit` action uses all four); add any that are missing.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm exec vitest run tests/blux/grid-cli.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Update the command description**

In `src/cli/bin.ts`, extend the `blux <action>` description string to mention the new
action, e.g. append: `grid: parse rendered index.html → grid-tree.json (layout tree).`

- [ ] **Step 6: Full-suite check + commit**

Run: `pnpm exec vitest run tests/blux/`
Expected: all blux tests PASS (existing + the 6 new grid test files).

Run: `pnpm lint`
Expected: clean (prettier + eslint). Fix any formatting before committing.

```bash
git add src/cli/commands/blux.ts src/cli/bin.ts tests/blux/grid-cli.test.ts
git commit -m "feat(blux): grid CLI action writes grid-tree.json"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** This plan covers spec build-step 1 ("HTML grid-tree parser +
  tree model"), producing the `Band[]` contract every downstream plan consumes. Roles
  (spec §"The data we have") are read from the rendered HTML class — resolving spec
  open-question #3 in the parser's favor. Widget identification and band-style joining
  are explicitly out of scope (later plans), stated in Scope boundaries.
- **Placeholder scan:** No TBD/TODO. Every step has runnable commands and complete
  code. The only conditional is Task 6's fixture generation, which degrades to a
  skipped golden test (`describe.skipIf`) with unit coverage intact — an explicit,
  logged fallback, not a silent gap.
- **Type consistency:** `Band`/`Node`/`Cell`/`GridToken`/`Media` are defined once in
  Task 1 and used verbatim thereafter. Function names are stable across tasks:
  `parseGridToken`, `textRoleFromClass`, `headingLevel`, `mediaFromElement`,
  `collectStructuralChildren`, `parseNode`, `parseContainer`, `parseGridBands`,
  `gridSignature`. `node-html-parser`'s `HTMLElement` API (`.tagName`, `.classNames`,
  `.getAttribute`, `.querySelector`, `.innerHTML`, `.text`, `.childNodes`) is used
  consistently.
- **Ambiguity:** The "row vs stack" decision is pinned to a concrete rule (`.cagrid`
  or ≥2 token-bearing children → row) and exercised by both the `.cagrid` and the
  `ibb` test cases in Task 4.

## Risks

1. **`node-html-parser` API drift** — if `.tagName` is lower-case or `.text` differs
   from expectations, Task 3/4 tests will catch it immediately (they run against the
   real library). Adjust the helpers, not the model.
2. **A band the parser mis-shapes** — caught by reading the Task 6 golden snapshot
   before committing it. The snapshot is the fidelity gate for this plan.
3. **Fixture contains a secret** — mitigated by committing only the `#page-content`
   subtree (no `<script>`), so the Maps key never enters the repo.
