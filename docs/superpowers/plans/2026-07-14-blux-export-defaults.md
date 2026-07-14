# Blux Export Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the export's own defaults — block-class content padding, text-node inline colors/padding, `margin-N{r,l,t,b}` utility classes — into the emit pipeline, and fix the three live the-pointe fidelity bugs (media force-centering, dropped hero-subtitle white, missing band padding).

**Architecture:** All capture is offline and export-structural, from two sources already read by `blux convert`: `site.json` (`styles.blocks` → `.blocksNcontainer` defaults incl. `__media_mobile_padding`; `styles.colors`) and the rendered content markup (band wrapper `blocksN` class, text-leaf inline `style`, utility class names). The head `<style>` is never parsed — `styles.blocks` is its structured source. The parser gains `Band.blockClass` + text-node style capture; emit resolves class-default padding into each band's `BandPresentation.style` so the render stays dumb. Render side: Grid stops forcing `mx-auto` (media follows inherited `text-align`, matching the original's inline-block flow) and renders text-node color/padding/margin.

**Tech Stack:** TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), node-html-parser, vitest snapshots; Svelte 5, Tailwind v4.

**Key evidence (verified against `~/Desktop/thePointe` export + live site):**

- `site.json` `styles.blocks` → `".blocks0container": { "max-width":"1280px", "margin":"0 auto", "padding":"120px 4% 120px 4%", "__media_mobile_padding":"80px 4% 80px 4%" }`, `.blocks2container` → `40px 0` / mobile `20px 0`.
- Band wrapper class (`blocks0`/`blocks2`) must come from the HTML (`site.json` `items[i].class` is null for 7/16 the-pointe blocks).
- ⚠️ Parser trap: a band container can have a style attr WITHOUT a padding declaration (bands 4/15) — the trigger for filling the default is "no `_contentPadding` in the block's styles", never "no style attr".
- Hero subtitle: `class="block-subtitle text13" style="padding: 10px 0px 0px; color: rgb(255, 255, 255);"` — inline in the export body.
- `margin-20r` (→ `margin-right:20%`, reset to 0 ≤800px) appears 5× on body leaves with NO inline twin; `pd_*` classes are always duplicated inline, so inline capture covers them.
- Nothing in the export CSS centers media: `.ib{display:inline-block}` images are positioned by ancestor `text-align`. Our `Grid.svelte` `mx-auto` is the bug.
- Bands 1,2,3,4,5,9,10,11,15 rely on class-default padding (the-pointe manifest already hand-carries most; only 15 — and invisibly 4 — are missing).

---

## The locked contract additions

Byte-consistent in `src/blux/emit/presentation.ts` (maintenance) and `src/lib/blux/presentation.ts` (the-pointe + reddoor-starter):

```ts
// On the heading / body / subtitle RenderNode variants (all three):
/** Inline deviations the export carries on the text leaf (color, padding)
 * plus decoded margin utilities (margin-20r → margin-right:20%). The
 * margin-right percentage is desktop-only in the source (reset ≤800px) —
 * the render scopes it to md+. */
style?: Record<string, string>;
```

Source `Node` text variants gain the same `style?: Record<string, string>`. `Band` gains:

```ts
/** The band wrapper's blocksN class (e.g. "blocks0") — resolves which
 * .blocksNcontainer class defaults apply when the block's own styles
 * omit padding/max-width. From the HTML (site.json items[].class is
 * unreliable — null for 7/16 the-pointe blocks). */
blockClass?: string;
```

`BandPresentation.style` (existing field) gains two emit-resolved keys, only when the block's own styles omit them: `_contentPadding` (the class default, e.g. `"120px 4%"`) and `_contentPaddingMobile` (from `__media_mobile_padding`, e.g. `"80px 4%"` — also emitted when the block DOES have its own padding but no mobile override does NOT apply: only pair it with a filled default). `_max-content-width` likewise fills from the class default when absent (harmless: 1280px matches the render fallback).

# Half A — reddoor-maintenance (branch `feat/blux-export-defaults`)

Gate: `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:dist`.

### Task A1: parser — `Band.blockClass` + text-leaf style capture + margin utilities

**Files:** `src/blux/grid/types.ts`, `src/blux/grid/parse-grid.ts`, `src/blux/grid/leaf.ts`; tests `tests/blux/grid-parse.test.ts`, `tests/blux/grid-leaf.test.ts`

- [ ] Failing tests: (1) `parseGridBands` captures `blockClass: "blocks2"` for a `<div id="page-block-0" class="blocks2 camediaload">` band and `"blocks0"` for a plain section; absent/unmatched class → field absent. (2) A heading leaf with `style="padding: 0px 0px 0px 8px"` yields `style: { padding: "0px 0px 0px 8px" }`; a subtitle with `color: rgb(255, 255, 255)` yields `style: { color: "rgb(255, 255, 255)" }`; a body with `class="block-body text1 margin-20r"` and no inline style yields `style: { "margin-right": "20%" }`; a leaf with neither → no `style` key. (3) Band-8-style captions inside media holders (the #395 path) also carry their styles.
- [ ] Implement: `types.ts` — `Band.blockClass?`, text-node `style?`. `leaf.ts` — `textLeafStyle(el): Record<string,string> | null`: allowlist `color`, `padding`, `margin*` from the inline style (via `cssProp`/style parsing), merged with `utilityStylesFromClass(className)` decoding `/\bmargin-(\d+)(r|l|t|b)\b/` → `margin-right|left|top|bottom: N%` (inline wins over class on conflict). `parse-grid.ts` — spread `...(style ? { style } : {})` in the heading/body/subtitle branches (both the plain and #395 caption paths); capture `blockClass` in `parseGridBands` from the band wrapper's classNames (`/\bblocks\d+\b/`).
- [ ] `grid-golden` structural signature must stay unchanged (style is not part of the signature). Commit `feat(blux): capture band blockClass + text-leaf style deviations`.

### Task A2: emit — class-default padding resolution + style passthrough

**Files:** `src/blux/emit/block-styles.ts` (or new `src/blux/emit/block-defaults.ts`), `src/blux/emit/convert.ts`, `src/blux/emit/presentation.ts`; tests `tests/blux/emit/*` + goldens

- [ ] Failing tests: (1) `blockClassDefaults(siteJson)` parses `styles.blocks` → `Map<"blocks0"|"blocks2"|…, { padding?, mobilePadding?, maxWidth? }>` from `.blocksNcontainer` entries (+`__media_mobile_padding`); tolerates absent `styles.blocks`. (2) `buildPresentation`: a spec whose band has `blockClass: "blocks0"` and NO `_contentPadding` in its style record gets `style._contentPadding = "120px 4% 120px 4%"` and `style._contentPaddingMobile = "80px 4% 80px 4%"`; a band whose block styles already carry `_contentPadding` is untouched (no mobile key added); a band with no blockClass/defaults entry is untouched. (3) renderNode passes text-node `style` through to RenderNode (all three variants; absent stays absent).
- [ ] Implement: defaults table from siteJson threaded through `convertExport` into `PresentationDeps` (e.g. `defaultsFor(blockClass)`); `buildPresentation` fills the two keys before the per-slice switch (works for every slice type — TitleBand/Hero bands need padding too); `presentation.ts` mirror types per the locked contract. Check `validate-layout`'s sigOf/renderNode comparisons ignore `style` (they compare structure — confirm no drift finding appears).
- [ ] Regenerate goldens (`pnpm vitest run tests/blux/ -u`); hand-review: convert-golden presentation gains `_contentPadding`/`Mobile` on the default-relying bands (1,2,3,4,5,9,10,11,15 per the table — band 2 gets `40px 0`) + `style` records on text nodes that carry deviations (BURBANK color, stat-label paddings, `margin-right` bodies); page-doc slices unchanged; classify-golden unchanged; grid-golden unchanged. Changeset `"@reddoorla/maintenance": minor`. Commit `feat(blux): emit export class-default padding + text-style deviations`.

# Half B — the-pointe (branch `feat/blux-export-defaults`)

Gate: `pnpm exec prettier --check --plugin prettier-plugin-svelte . && pnpm exec eslint . && pnpm check && pnpm build && pnpm test`. Build = /#N prerender gate.

### Task B1: render — media alignment + text-node style

**Files:** `src/lib/blux/presentation.ts`, `src/lib/blux/Grid.svelte`, `src/lib/blux/BandContent.svelte`, `src/app.css` (one rule); tests `Grid.test.ts`, `BandContent.test.ts` (new)

- [ ] Failing tests: (1) Grid media renders inside a `w-full` block wrapper with an `inline-block` image (no `mx-auto`) — and a `text-align:left` ancestor leaves it left (assert class absence + wrapper). (2) A heading/subtitle RenderNode with `style: { color: "rgb(255,255,255)" }` renders that inline color; `margin-right` renders as `--node-mr` var + `md:mr-(--node-mr)` class (desktop-only, mirroring the source's ≤800px reset); padding renders inline. (3) BandContent: `_contentPaddingMobile` present → emits `--band-pad`/`--band-pad-m` vars + the `band-pad` class instead of a fixed inline padding; absent → current inline padding behavior unchanged.
- [ ] Implement: presentation.ts mirror (`style?` on the three text variants). Grid.svelte media branch → `<div class="w-full"><Media media={node.media} class="inline-block h-auto max-w-full" /></div>`; text branches render the style record (color/padding inline; margin via var). BandContent: when `_contentPaddingMobile` exists, switch to `--band-pad` vars + class `band-pad`; add to app.css:

```css
/* Band content padding with the export's mobile override (≤700px in source). */
.band-pad {
  padding: var(--band-pad);
}
@media (max-width: 700px) {
  .band-pad {
    padding: var(--band-pad-m, var(--band-pad));
  }
}
```

- [ ] Commit `feat(blux): media follows text-align; text-node style deviations; mobile band padding`.

### Task B2: manifest deltas (hand-edit — do NOT regenerate; it clobbers six PRs of live tunes)

**Files:** `src/lib/blux/blux-presentation.json`

- [ ] Band 0 tree subtitle node (BURBANK): add `"style": { "color": "rgb(255, 255, 255)" }`.
- [ ] Band 15 style: add `"_contentPadding": "120px 4% 120px 4%"`, `"_contentPaddingMobile": "80px 4% 80px 4%"`. Band 4 style: same two keys (correct though invisible).
- [ ] Band 1 body nodes carrying `margin-20r` in the source: add `"style": { "margin-right": "20%" }` to the two intro body nodes (bands 1 and 5 copy, per the export). Cross-check each against the export markup before editing.
- [ ] Full gate + Playwright visual pass on `/dev/blux-page` bands 0/1/3/15 vs www.thepointeburbank.com at 1440px (kill any 5173 squatter first; wait out the 2.4s reveal before shooting). Expected deltas: BURBANK white; band-1 accent line + band-3 stat icons left-aligned; band-15 CTA gains 120px vertical padding. Commit `fix(blux): BURBANK white, band-15 padding, margin-20r bodies (export deltas)`.

# Half C — reddoor-starter sync (branch `feat/blux-export-defaults`, AFTER Half B review)

- [ ] Port the same `presentation.ts` contract + `Grid.svelte` + `BandContent.svelte` + app.css `.band-pad` changes and their tests (the starter's copies are byte-identical pre-change; keep its generalized BandTitle/Media divergences intact). `/dev/blux-page` fixture: extend one text node with a `style` color + one band with `_contentPaddingMobile` so the axe/dev page exercises the new paths.
- [ ] Starter gate (`pnpm lint && pnpm check && pnpm build && pnpm test`) + commit.

## Out of scope

- Head-`<style>` CSS parsing (styles.blocks is the structured source; revisit only if a site's site.json lacks it).
- Per-role colors in theme.css (`.textN` rules carry none; page color already flows via `styles.colors`).
- Band 9's live-only black heading, band-1 6%-vs-4% and band-8 dead padding deltas (live tunes / benign, per the render-gaps table).
- The nav-sticky/body-padding runtime behavior (JS-injected, not export-structural).
