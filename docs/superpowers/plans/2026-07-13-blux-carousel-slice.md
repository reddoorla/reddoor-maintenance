# Blux Carousel Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the Blux slider band (`.caslider`, band 8 of the the-pointe export) from the Grid fallback to a first-class `Carousel` pattern slice — emitted upstream, rendered as a true APG slider at the-pointe.

**Architecture:** The parser starts carrying the slider marker (`.caslider` class + `data-columns`) on row nodes; the classifier turns a marked row of media/captioned-media cells into a `CarouselSpec`; all five emit paths (plan slice, plan assets, presentation manifest, layout validation, manifest URL rewrite) gain a carousel case. The-pointe mirrors the new `BandPresentation.carousel` contract and renders it through the existing APG-compliant `Slider.svelte` via a shared `CarouselFrames` wrapper — used by both a new registered `carousel` slice (post-migrate future + `/dev/blux-page`) and a carousel mode in the existing `gallery` slice (live `/` today, prerender-safe: band 8's Prismic slice stays `gallery`).

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), node-html-parser, vitest snapshots; Svelte 5 runes, SvelteKit, Tailwind v4, Slice Machine models.

**Faithful-to-export scope (decision rule):** the export structurally encodes ONLY: slider identity (`caslider`), `data-columns="1"`, 3 cover-image slides with inline `min-height: 80vh`, one nested `h5.block-title.text5` caption per slide in a white centered card, and prev/next arrow buttons. It encodes NOTHING about autoplay, duration, transition, loop, or dots — those fields are deliberately absent from the spec.

---

## The locked contract

Both halves implement against this; it must land byte-identically in `src/blux/emit/presentation.ts` (reddoor-maintenance) and `src/lib/blux/presentation.ts` (the-pointe).

```ts
// On BandPresentation:
/** Carousel payload: the band is a source slider (.caslider). Caption TEXT
 * lives in the page doc's items (Prismic-editable); the manifest carries the
 * media and the caption's role metadata. `columns` = slides visible at once
 * (source data-columns). */
carousel?: {
  slides: {
    media: RenderMedia;
    caption?: { level?: number; role?: string };
  }[];
  columns?: number;
};

// On RenderMedia (new field):
/** The source holder's inline min-height (e.g. "80vh" on slider slides), so
 * a cover-frame carousel reserves the original's height. */
minHeight?: string;
```

Plan slice shape (migration-plan.json):

```json
{
  "slice_type": "carousel",
  "variation": "default",
  "items": [{ "caption": "a place to sit and breathe" }, ...],
  "primary": { "band": 8 }
}
```

`items` has one entry per slide, in slide order (render zips by index); an uncaptioned slide contributes `{}`.

---

# Half A — reddoor-maintenance (branch `feat/blux-carousel-slice`)

Worktree: `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.claude/worktrees/blux-emit-backport`. All tests: `pnpm vitest run tests/blux/` (snapshots update with `-u`). Gate before push: `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:dist`.

### Task A1: Parser — carry the slider marker on row nodes

**Files:**

- Modify: `src/blux/grid/types.ts` (row Node variant)
- Modify: `src/blux/grid/parse-grid.ts` (`parseContainer`)
- Modify: `src/blux/grid/leaf.ts` (min-height capture)
- Test: `tests/blux/grid-parse.test.ts`

- [ ] **Step 1: Failing tests** — in `tests/blux/grid-parse.test.ts` near the existing slider-tile tests (lines ~203-232):

```ts
it("marks a .caslider row as a slider and captures data-columns", () => {
  const html = `<div id="page-content"><section id="page-block-0" class="blocks0">
    <div class="block-grid-container cagrid caslider" data-columns="1">
      <div class="block-subcontent cagriditem grid-1"><div class="blocks2 camediaload" data-bgmedia="1" data-ext="jpg" data-base="https://cdn/x/" data-media="a.jpg"></div></div>
      <div class="block-subcontent cagriditem grid-1"><div class="blocks2 camediaload" data-bgmedia="1" data-ext="jpg" data-base="https://cdn/x/" data-media="b.jpg"></div></div>
    </div></section></div>`;
  const [band] = parseGridBands(html);
  const row = band!.root;
  expect(row.kind).toBe("row");
  if (row.kind !== "row") return;
  expect(row.slider).toEqual({ columns: 1 });
});

it("a plain cagrid row carries no slider marker", () => {
  // reuse any existing non-slider grid fixture snippet from this file
  // assert row.slider is undefined
});

it("a .caslider without a valid data-columns still marks the row (no columns)", () => {
  // same fixture as above minus the data-columns attr → expect row.slider to equal {}
});

it("captures the media holder's inline min-height", () => {
  // camediaload holder with style="min-height: 80vh; background-size: cover;"
  // → media.minHeight === "80vh"
});
```

- [ ] **Step 2: Run to verify failures** — `pnpm vitest run tests/blux/grid-parse.test.ts`.

- [ ] **Step 3: Implement.** In `src/blux/grid/types.ts`, extend the row variant:

```ts
| {
    kind: "row";
    cells: Cell[];
    /** Present when the source grid is a `.caslider` — a JS slider showing
     * `columns` slides at a time (data-columns). The signature does NOT
     * encode this (classification is guarded by unit tests instead) so
     * Grid-fallback drift comparisons stay stable. */
    slider?: { columns?: number };
  }
```

In `src/blux/grid/parse-grid.ts` `parseContainer` (the `isGrid || tokenCount >= 2` branch, ~lines 159-162), attach the marker when `hasClass(el, "caslider")`; parse `data-columns` with `Number(...)`, only set `columns` when a positive integer (`exactOptionalPropertyTypes` — build the object conditionally). In `src/blux/grid/leaf.ts`, capture the holder's inline `min-height` via the existing `cssProp` helper into `Media.minHeight` alongside the existing background-fit capture for `data-bgmedia` holders; add `minHeight?: string` to `Media` in `types.ts` with a one-line doc comment.

- [ ] **Step 4: Run** `pnpm vitest run tests/blux/grid-parse.test.ts tests/blux/grid-golden.test.ts`. The structural-signature golden (`grid-golden`) must be **unchanged** — the marker is deliberately not part of the signature. If `leaf` tests cover media fields, extend `tests/blux/grid-leaf.test.ts` accordingly.

- [ ] **Step 5: Commit** `feat(blux): parse .caslider slider marker + media min-height`.

### Task A2: CarouselSpec + classifier rule

**Files:**

- Modify: `src/blux/grid/slice-spec.ts`, `src/blux/grid/classify-band.ts`, `src/blux/grid/index.ts`
- Test: `tests/blux/grid-classify.test.ts`

- [ ] **Step 1: Failing tests** — flip the regression at `tests/blux/grid-classify.test.ts:183` from Grid to Carousel and add unit cases:

```ts
it("a captioned media slider (band 8) → Carousel with per-slide captions", () => {
  // parse the fixture, classify band 8:
  // spec.slice === "Carousel"; spec.slides.length === 3; spec.columns === 1
  // spec.slides[0].caption → { html: "a place to sit and breathe", level: 5, role: "text5" }
});
it("a slider row with an unrecognizable slide falls back to Grid", () => {
  // hand-built band: row.slider set, one cell is a heading-only stack → Grid
});
it("a single-slide slider is not a Carousel", () => {
  // row.slider set, 1 media cell → falls through (Grid/MediaFull as today)
});
it("an unmarked row of captioned media stays Grid", () => {
  // band 8 shape WITHOUT row.slider → Grid (the pre-existing behavior)
});
```

- [ ] **Step 2: Verify failures.**

- [ ] **Step 3: Implement.** In `slice-spec.ts`:

```ts
/** One slider slide: its media plus the caption text-block nested inside the
 * holder (band-8 archetype: a single h5.block-title per slide). */
export type CarouselSlide = {
  media: Media;
  caption?: { html: string; level: number; role?: string };
};

/** A source slider (.caslider): media slides shown `columns` at a time.
 * The export encodes no autoplay/duration/dots — deliberately absent. */
export type CarouselSpec = SpecBase & {
  slice: "Carousel";
  slides: CarouselSlide[];
  columns?: number;
};
```

Add to the `SliceSpec` union and re-export from `src/blux/grid/index.ts`. In `classify-band.ts`, refactor `topRow` so the row NODE is reachable (e.g. `topRowNode(root)` returning the row, with `topRow` delegating), then add the rule immediately BEFORE the Gallery branch:

```ts
// Carousel: a source slider row (.caslider) whose every cell is a media
// slide, optionally captioned (stack[media, heading]). Anything richer
// falls through to the faithful Grid fallback.
const rowNode = topRowNode(root);
if (rowNode?.slider) {
  const slides = carouselSlides(rowNode.cells);
  if (slides) {
    const spec: CarouselSpec = { slice: "Carousel", ...base(band), slides };
    if (rowNode.slider.columns !== undefined) spec.columns = rowNode.slider.columns;
    return spec;
  }
}
```

`carouselSlides(cells)` returns `CarouselSlide[] | null`: a cell qualifies as `{kind:"media"}` (bare slide) or `{kind:"stack"}` whose children are exactly `[media, heading]` (captioned slide — caption from the heading's html/level/role, set only when present); any other cell shape → `null`; require `>= 2` qualifying slides.

- [ ] **Step 4: Run** `pnpm vitest run tests/blux/grid-classify.test.ts`. Expect OTHER suites to now fail compilation (exhaustive switches) — that's Task A3.

- [ ] **Step 5: Commit** `feat(blux): CarouselSpec + slider-row classification`.

### Task A3: The five emit paths + golden regeneration

**Files:**

- Modify: `src/blux/emit/grid-slice.ts`, `src/blux/emit/grid-plan.ts`, `src/blux/emit/presentation.ts`, `src/blux/emit/convert.ts` (only if resolver plumbing needs it), `src/blux/emit/validate-layout.ts`, `src/blux/emit/rewrite-manifest.ts`
- Test: `tests/blux/emit/grid-slice.test.ts`, `tests/blux/emit/grid-plan.test.ts`, `tests/blux/emit/presentation.test.ts`, `tests/blux/emit/validate-layout.test.ts`, `tests/blux/emit/rewrite-manifest.test.ts` (match existing file names), goldens

- [ ] **Step 1: Failing unit tests first** (one per path):
  - grid-slice: extend the `it.each` slice→slice_type table with Carousel → `carousel`, and assert items = per-slide `{caption}` (stripTags'd) with `{}` for an uncaptioned slide.
  - grid-plan: a Carousel spec's slide media lands in `plan.assets` (mirror the Gallery case test).
  - presentation: a Carousel spec fills `bp.carousel.slides` (resolved media incl. `minHeight`, caption `{level, role}` only), `columns` passthrough; unresolved media drops the slide.
  - validate-layout: `sourceLabel` says `Carousel(3)`; a manifest missing a slide yields a finding (mirror the Gallery media-count check at ~lines 150-161).
  - rewrite-manifest: carousel slide urls get rewritten CDN→Prismic (mirror the gallery walk test).

- [ ] **Step 2: Implement all five cases.** `grid-slice.ts`:

```ts
case "Carousel":
  return {
    slice_type: "carousel",
    variation: "default",
    items: spec.slides.map((s) =>
      s.caption ? { caption: stripTags(s.caption.html) } : {},
    ),
    primary: { band: spec.index },
  };
```

`grid-plan.ts` `collectPlanAssets`: `case "Carousel": spec.slides.forEach((s) => add(s.media)); break;` — do NOT leave it to `default: break`. `presentation.ts`: add the contract types above (`carousel` on `BandPresentation`, `minHeight` on `RenderMedia`) and the case:

```ts
case "Carousel": {
  const slides = spec.slides.flatMap((s) => {
    const media = deps.resolveMedia(s.media);
    if (!media) return [];
    const slide: { media: RenderMedia; caption?: { level?: number; role?: string } } = { media };
    if (s.caption) {
      const caption: { level?: number; role?: string } = { level: s.caption.level };
      if (s.caption.role !== undefined) caption.role = s.caption.role;
      slide.caption = caption;
    }
    return [slide];
  });
  if (slides.length > 0) {
    bp.carousel = spec.columns !== undefined ? { slides, columns: spec.columns } : { slides };
  }
  break;
}
```

Check `resolveMedia` passes `minHeight` through (mirror how `fit`/`position` pass). `validate-layout.ts`: `sourceLabel` case → `` `Carousel(${spec.slides.length})` ``; completeness check comparing `bp.carousel?.slides.length` to `spec.slides.length` (finding on mismatch/absence), styled after the Gallery check; the `never` guard then compiles. `rewrite-manifest.ts` `walkBand`: walk `band.carousel?.slides` media like `gallery`.

- [ ] **Step 3: Golden updates.** `tests/blux/grid-classify-golden.test.ts` `summary()` gains a Carousel case (e.g. `` `${s.index} Carousel(${s.slides.length}${s.columns ? `,cols:${s.columns}` : ""})` ``). `tests/blux/grid-validate-golden.test.ts`: `gridBands` 11 → 10; rewrite the band-8 drift test to drop a carousel slide from the manifest and expect the carousel completeness finding (use `"band" in f && f.band === 8` narrowing — the finding union has band-less variants). Then regenerate snapshots: `pnpm vitest run tests/blux/ -u`. **Review the snapshot diff by hand:** classify-golden band 8 → Carousel; convert-golden slice sequence band 8 `gallery`→`carousel` — wait, it is currently `grid_band` → becomes `carousel`; page-doc band-8 items carry the 3 caption strings; presentation band 8 swaps `tree` for `carousel`; `minHeight` appears on media that had inline min-height (verify each looks export-derived); ALL OTHER BANDS byte-identical.

- [ ] **Step 4: Full gate** — `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:dist`. Also check `tests/cli/blux-command.test.ts` still passes (it exercises convert end-to-end).

- [ ] **Step 5: Changeset + commit.** `.changeset/blux-carousel-slice.md` — package name **`"@reddoorla/maintenance": patch`** (NEVER `reddoor-maintenance`), describing: slider bands classify as Carousel; slides+captions+columns only (export encodes no autoplay); new manifest `carousel` payload + `RenderMedia.minHeight`; captions Prismic-editable via items. Commit `feat(blux): Carousel slice type — slider bands emit slides + editable captions`.

# Half B — the-pointe (branch `feat/blux-carousel`, repo `/Users/tuckerlemos/Documents/GitHub/pointe-plan7`)

Gate before push: `pnpm exec prettier --check . && pnpm exec eslint . && pnpm check && pnpm build && pnpm test` (`pnpm build` is the /#8 prerender gate — CI runs it, the local vitest gate does not).

### Task B1: Mirror the contract + CarouselFrames

**Files:**

- Modify: `src/lib/blux/presentation.ts`
- Create: `src/lib/blux/CarouselFrames.svelte`
- Test: `src/lib/blux/CarouselFrames.test.ts`, extend `src/lib/blux/presentation.test.ts` if it pins types

- [ ] **Step 1:** Add to `presentation.ts`: `minHeight?: string` on `RenderMedia`, and the `carousel` field on `BandPresentation` — byte-identical doc comments to the upstream contract block above.

- [ ] **Step 2: Failing component test** for `CarouselFrames` (jsdom; `vitest-setup.ts` already polyfills IntersectionObserver/matchMedia): renders an APG region (`role="region"`, `aria-roledescription="carousel"`), one `figure` per frame, caption text in `figcaption` with the `txt-role-*` class from `role`, `min-height` style from `media.minHeight`, arrows present, **no dots**, no autoplay (no pause button rendered).

- [ ] **Step 3: Implement** `CarouselFrames.svelte` — a thin wrapper over the existing `$lib/components/Slider.svelte`:

```svelte
<script lang="ts">
  import Slider from "$components/Slider.svelte";
  import Media from "./Media.svelte";
  import type { RenderMedia } from "./presentation";

  /** One rendered slide: manifest media + caption text (zipped from the
   * Prismic slice's items by the caller) + the caption's txt-role. */
  export type CarouselFrame = { media: RenderMedia; caption?: string; role?: string };

  let { frames, label }: { frames: CarouselFrame[]; label: string } = $props();
</script>

<!-- The source slider shows one full-bleed cover frame at a time with prev/next
     arrows and NO dots or autoplay (the export encodes none) — mirror exactly. -->
<Slider itemCount={frames.length} {label} showDots={false} class="w-full">
  {#snippet children({ index }: { index: number })}
    {@const frame = frames[index]}
    {#if frame}
      <figure class="relative w-full" style={`min-height:${frame.media.minHeight ?? "60vh"}`}>
        <Media media={frame.media} class="absolute inset-0 h-full w-full object-cover" />
        {#if frame.caption}
          <!-- The source caption card: white, centered on the frame, 15px/30px padding. -->
          <figcaption class="absolute inset-0 flex items-center justify-center">
            <span class={`bg-white px-[30px] py-[15px] text-center ${frame.role ? `txt-role-${frame.role}` : ""}`}>{frame.caption}</span>
          </figcaption>
        {/if}
      </figure>
    {/if}
  {/snippet}
</Slider>
```

Adjust import alias/props to repo conventions ($components alias may not exist here — check `svelte.config.js`; use the relative/`$lib`form the repo uses). Verify Slider's slide-mode track sizes correctly with`min-height` frames (fixed-height frames avoid the differing-aspect jump).

- [ ] **Step 4: Run tests, commit** `feat(blux): CarouselFrames — APG slider over manifest frames`.

### Task B2: Carousel slice (registered) + Gallery carousel mode

**Files:**

- Create: `src/lib/slices/Carousel/model.json`, `src/lib/slices/Carousel/index.svelte`, `src/lib/slices/Carousel/Carousel.test.ts`
- Modify: `src/lib/slices/index.js`, `customtypes/page/index.json`, `prismicio-types.d.ts` (match however grid_band added its generated types — check `git log -p` on that file), `src/lib/slices/Gallery/index.svelte` + its test

- [ ] **Step 1: model.json** — SharedSlice id `carousel`, name `Carousel`, variation `default`; primary: `band` (Number, "band (index from the Blux export)" — copy Gallery's), `label` (Text, "Accessible name for the slider region"); items: `caption` (Text, "Slide caption (order matches the manifest slides)").

- [ ] **Step 2: Failing slice test** — renders nothing without a manifest entry; with `context.presentation` band carrying `carousel`, renders `<section id={band}>` (SectionBand) wrapping the slider region; captions zip from `slice.items` by index; falls back to label default when `primary.label` empty.

- [ ] **Step 3: Implement** `Carousel/index.svelte` following Gallery's structure (bandFor + SectionBand):

```svelte
const band = $derived(bandFor(context.presentation, slice.primary.band ?? null));
const frames = $derived(
  band?.carousel
    ? band.carousel.slides.map((s, i) => {
        const caption = slice.items?.[i]?.caption || undefined;
        return { media: s.media, ...(caption ? { caption } : {}), ...(s.caption?.role ? { role: s.caption.role } : {}) };
      })
    : null,
);
```

Template: `{#if frames && frames.length > 0}` → `<SectionBand {band} sliceType={slice.slice_type} sliceVariation={slice.variation}><CarouselFrames {frames} label={slice.primary.label || "Photo slideshow"} /></SectionBand>{/if}`. Register in `src/lib/slices/index.js` (`carousel: Carousel`) and add the `carousel` choice (`{"type": "SharedSlice"}`) to `customtypes/page/index.json`. Types: extend `prismicio-types.d.ts` the same way grid_band's types were added (hand-authored if that's what PR #6 did).

- [ ] **Step 4: Gallery carousel mode.** In `Gallery/index.svelte`, ahead of the captioned-grid check: when `band?.carousel` exists, render `CarouselFrames` with frames built from `band.carousel.slides` zipped with the **gallery** payload's captions (`band.gallery?.[i]?.caption`) — transition glue, commented as such:

```
<!-- Transition: the live Prismic doc still types band 8 as `gallery` (see
     37310f0 — the /#8 prerender anchor needs this slice rendering id=8).
     When the manifest carries the carousel payload, render the true slider
     here; caption text comes from the coexisting gallery frames. Once the
     doc is migrated to the carousel slice type, this mode and the gallery
     payload can be dropped. -->
```

Update Gallery's test: carousel payload present → slider region rendered (and still id=8 section); no carousel → existing captioned-grid/full-bleed modes unchanged.

- [ ] **Step 5: Manifest + page-slices data.** `src/lib/blux/blux-presentation.json` band `"8"`: KEEP `gallery` as-is, ADD `carousel` — 3 slides with `media` `{kind:"image", url:<same prismic urls>, alt:<same>, minHeight:"80vh"}` and `caption` `{level:5, role:"text5"}`; plus `columns: 1`. `src/lib/blux/page-slices.json` entry 8 → `{"slice_type":"carousel","variation":"default","items":[{"caption":"a place to sit and breathe"},{"caption":"a calm escape right outside your door"},{"caption":"a building with a view"}],"primary":{"band":8}}` (so `/dev/blux-page` exercises the real slice).

- [ ] **Step 6: Full gate** — prettier/eslint/`pnpm check`/`pnpm build` (the /#8 prerender MUST pass — `/` still renders gallery with id=8)/`pnpm test`. Visual: `pnpm vite:dev`, screenshot `/dev/blux-page` band 8 via the Playwright shot tool (`tests/blux-page.spec.ts`), compare against www.thepointeburbank.com at 1440px. **Kill the dev server afterwards.**

- [ ] **Step 7: Commit** `feat(blux): carousel slice — band 8 renders as a true APG slider`.

## Follow-ups (explicitly out of scope here)

- Slice Machine push of the `carousel` model + custom-type choice to the live Prismic repo, and the operator `blux migrate` re-run — operator steps.
- Starter promotion (separate plan) picks up `CarouselFrames` + the Carousel slice.
