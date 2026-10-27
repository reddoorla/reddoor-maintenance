# Blux → Reddoor conversion: faithful grid slices — design

**Goal:** Replace the lossy 4-archetype page mapping with a faithful grid-based
renderer, so a converted Blux site (starting with the-pointe) reproduces the
original page layout — the actual grid rows, column ratios, media placement, and
interactive widgets — instead of a flattened stack of generic bands.

**Architecture:** Parse the Blux **rendered `index.html`** (where Blux computes the
grids) into a recursive **grid tree**; classify each top-level band by its grid
signature to a small set of **pattern slices**, falling back to a generic recursive
**Grid** slice for anything unrecognized; detect **widget** bands (map, video) and
route them to dedicated slices. Emit pattern-slice content to Prismic (CMS-editable)
and the grid-tree layout to the code-side presentation manifest (render-faithful).
Reuse the existing asset pipeline, role/theme emit, block-style bands, Prismic
migrate, and `blux validate` unchanged.

**Tech stack:** TypeScript + tsx (`blux` command group in `reddoor-maintenance`),
`node-html-parser` (or the existing HTML parse path) for the grid-tree parser,
`@prismicio/client` Migration API for content emit, the-pointe's SvelteKit slice
library + `SectionBand`/`presentation.ts` runtime, Google Maps JS API for the map
widget, Playwright for the layout-fidelity check.

**Supersedes:** the page-mapping half of
`2026-07-05-blux-conversion-pipeline-design.md` (the `archetype.ts` classifier and
the 4 fixed archetype slices). Collections/Custom-Types, assets, theme/roles, and
the deterministic-core principle from that spec are unchanged and carry forward.

---

## Non-negotiable principle: still deterministic & reproducible

Same as the parent spec. The conversion core contains **no LLM/AI**: same Blux
export in → byte-identical grid tree, slices, and manifest out, every run. The only
human judgment is the final visual sign-off on rendered output. The grid tree is the
new snapshot/test surface (it replaces the archetype list as the page IR).

---

## Why replan: the fidelity gap

The current pipeline classifies every Blux block into one of four fixed slices
(`hero` / `media_text` / `section_grid` / `rich_text`). That mapping keeps the
_content_
(text, media, background bands) but **discards the actual layout**: which cells sit
in a row, their column ratios, media-vs-text placement, nesting, and the map/video
widgets. Result on the-pointe: the page has all the words but "looks nothing like"
the real site — a vertical stack of centered bands instead of the original magazine
grid.

Root cause: the archetype is a _lossy projection_. The fix is to stop projecting and
instead carry the layout through faithfully. Two facts make this tractable and
generic (verified against the-pointe answer key,
`~/Desktop/thePointe/index.html`):

1. **The rendered `index.html` is the layout source of truth.** Blux computes grid
   ratios at _render_ time; `site.json` does not store them. So we parse the rendered
   HTML for structure and use `site.json` only for content/asset/role resolution.
2. **The layout is a small, regular vocabulary.** Across the whole page there are
   only ~13 distinct grid class tokens, and they encode column count + ratio
   directly in the class name.

## The data we have (the-pointe answer key)

`~/Desktop/thePointe/index.html` — 135 KB, self-contained (one inline `<style>`, one
inline `initMap` script; only fonts are external). Measured facts:

**Grid vocabulary** (`grep -oE 'grid-[0-9a-z-]+'`), with the CSS the token maps to:

| Token                 | CSS                              | Meaning                                    |
| --------------------- | -------------------------------- | ------------------------------------------ |
| `grid-1`              | `width:100%`                     | full-width cell                            |
| `grid-2`              | `width:50%`                      | equal 2-col cell                           |
| `grid-4`              | `width:25%`                      | equal 4-col cell                           |
| `grid-2-r60` / `-r40` | `width:60%` / `40%`              | 2-col split, this cell's share             |
| `grid-2-r70` / `-r30` | `width:70%` / `30%`              | 2-col split                                |
| `grid-2-r80` / `-r20` | `width:80%` / `20%`              | 2-col split (also the icon/label stat row) |
| `grid-2-s50`          | `min/max-width:calc(50% - 25px)` | fixed-sized cell                           |
| `grid-1-s40`          | sized 40%                        | fixed-sized cell                           |
| `grid-any-s20`        | sized 20%                        | fixed-sized cell                           |

So a cell's layout is fully determined by its class token — **the parser reads the
token, never the CSS**. The general shape is
`grid-{cols}` optionally `-r{ratio}` (a share of a 2-col row) or `-s{size}` (a fixed
sized cell). Counts: 86 `.cagrid` rows, 73 `.cagriditem` cells.

**Cell contents** (`block-*` roles): `block-title` ×26 (heading), `block-body` ×17
(paragraph), `block-subtitle` ×4 (eyebrow), `block-media-holder` ×4 (image), plus
nested `.cagrid` rows. Roles (`text1`..`text11`) are **not** in the rendered HTML —
they come from `site.json` block styles, as they do today.

**Media** is not `<img>` (0 in the file) — images are `camediaload` lazy divs
carrying `data-media` (asset id), `data-base` (CDN prefix), `data-ext`, `data-size`.
There is 1 real `<video src="…​.mp4" controls playsinline>` tag. Band backgrounds are
the 3 `background-image` uses. All asset ids resolve through the existing pipeline.

**Widget:** one Google Map — `google.maps.Map` in `initMap`, pinned by 8
`google.maps.KmlLayer`s that reference a public Google My Map
(`google.com/maps/d/kml?mid=…&lid=…`), plus a custom muted-greyscale style JSON. The
KML layers and style are reusable for free; only the referrer-restricted API key must
be swapped for ours (`VITE_GOOGLE_MAPS_KEY`, already set on the-pointe's Netlify
site, all contexts).

---

## Locked design decisions

These were decided with the user before this spec:

1. **Keep Prismic + faithful grid slices** (not "drop the CMS" and not "keep the
   lossy archetypes"). Pattern-slice content stays CMS-editable.
2. **Hybrid slice model:** a small set of **pattern slices** for recognized layouts +
   a generic recursive **Grid** fallback for everything else. Fidelity is guaranteed
   by the fallback; editability is provided by the pattern slices.
3. **Interactive pinned map**, reusing Blux's own map code (KmlLayer + style JSON),
   with our API key.
4. **CMS is a nice-to-have, not a requirement** for this stopgap. Consequence
   (below): the Grid fallback's layout tree lives in the code-side presentation
   manifest, not tortured into Prismic's flat model. Pattern slices remain fully
   Prismic-native.

---

## Architecture

```text
Blux export ─┬─ index.html ──► [1] grid-tree parser ──► Band[] (grid tree)
             │                                              │
             └─ site.json ──► (content/asset/role resolve) ─┤
                                                            ▼
                              [2] band classifier + widget router
                                                            │
             ┌──────────────────────────────────────────────┼───────────────┐
             ▼                        ▼                       ▼               ▼
       pattern slice            Grid fallback           widget slice     (band style
       (Hero, Split…)           (recursive tree)        (LocationMap,     manifest → all)
             │                        │                  VideoFeature)
             ▼                        ▼                       ▼
     [3] emit-prismic          [3] emit-manifest       [3] emit-config
     (page doc + custom        (grid tree keyed        (map/video config
      types + assets)           by slice index)         keyed by slice index)
                                                            │
                                                            ▼
                        the-pointe SvelteKit renders slices via SliceZone
                                                            │
                                                            ▼
                     [4] validate: content coverage + layout-signature check
                                    vs the answer key
```

### What is reused vs replaced

| Piece                                                    | Fate                                                |
| -------------------------------------------------------- | --------------------------------------------------- |
| `blux/archetype.ts` (4-way classifier)                   | **Replace** with grid-tree parser + band classifier |
| the-pointe `Hero/MediaText/SectionGrid/RichText` slices  | **Replace** with the new slice set                  |
| `blux/assets.ts` (resolve/probe/upload)                  | **Reuse** unchanged                                 |
| `blux/collections.ts` + `emit/custom-types.ts`           | **Reuse** unchanged (collections are orthogonal)    |
| `emit/theme.ts` role/theme CSS (`emitRolesCss`)          | **Reuse** unchanged                                 |
| block-style manifest → `SectionBand` + `presentation.ts` | **Reuse**; extend manifest to carry grid trees      |
| `emit/run-migration.ts` (Prismic push/migrate)           | **Reuse**; new slice models                         |
| `blux/validate.ts` (content coverage)                    | **Extend** with a layout-signature check            |
| Content IR for collections                               | **Reuse**; the grid tree becomes the _page_ IR      |

---

## Components

### [1] Grid-tree parser (`blux/grid/parse-grid.ts`)

**Input:** the rendered `index.html` string. **Output:** `Band[]`.

Parse the DOM and walk it into a typed tree. Node types:

```ts
type Band = {
  index: number; // position in the page = slice-zone index
  style: BlockStyle; // background-color, height, vertical-align,
  //   _max-content-width, text-align, padding
  //   (from site.json block styles, already captured)
  background?: Media; // band-level background image/video
  root: Node; // the band's content tree
};

type Node =
  | { kind: "row"; cells: Cell[] } // a .cagrid
  | { kind: "heading"; role?: string; level: number; html: string } // block-title
  | { kind: "body"; role?: string; html: string } // block-body
  | { kind: "subtitle"; role?: string; text: string } // block-subtitle
  | { kind: "media"; media: Media } // block-media-holder
  | { kind: "widget"; widget: Widget }; // map / video (see [2])

type Cell = { token: GridToken; node: Node }; // a .cagriditem
type Media = { assetId: string; kind: "image" | "video"; ext?: string; size?: number };
```

**Grid token parsing** — from the cell's `grid-*` class:

```ts
type GridToken = { cols: number | "any"; ratio?: number; sized?: number };
// grid-2      -> {cols:2}
// grid-4      -> {cols:4}
// grid-1      -> {cols:1}
// grid-2-r60  -> {cols:2, ratio:60}
// grid-1-s40  -> {cols:1, sized:40}
// grid-any-s20-> {cols:"any", sized:20}
```

Media resolution: read `data-media` (+ `data-ext`, `data-size`) from the
`camediaload` div, or `src` from a `<video>`. The asset id is handed to the existing
`assets.ts` resolver — the parser does **not** fetch or upload.

Role resolution: the rendered HTML has no roles; the parser matches each
`block-title`/`block-body` to its `site.json` block (by document order within the
band, the same correspondence the current manifest already relies on) to attach the
`text{N}` role.

The parser is pure and snapshot-tested: fixture HTML in → expected `Band[]` out.

### [2] Band classifier + widget router (`blux/grid/classify-band.ts`)

**Input:** one `Band`. **Output:** a `SliceSpec` (which slice + its props/content).

**Widget detection runs first** (short-circuits): a band whose content or script
references the map → `LocationMap`; a band whose only media is a video → `VideoFeature`.
The map is detected by extracting the `initMap`/`KmlLayer` config from the HTML script
(see the Map section); video by `media.kind === "video"`.

Otherwise, classify by the band's grid **signature** — the ordered tuple of its top
row's cell tokens + each cell's dominant node kind:

| Signature                                                           | Slice             | Props                                |
| ------------------------------------------------------------------- | ----------------- | ------------------------------------ |
| single full-bleed media + overlay text, tall `height`               | `Hero`            | media, overlay text, fallback height |
| centered title (+ optional subtitle), no media                      | `TitleBand`       | eyebrow, heading                     |
| one row, 2 cells `[media \| text]` (any ratio)                      | `SplitFeature`    | `ratio`, `mediaSide`, media, text    |
| one row, N cells each `[icon/number + label]` (r20 pairs or grid-4) | `StatGrid`        | items[]                              |
| one row, N media cells                                              | `Gallery`         | media[]                              |
| single media, full width                                            | `MediaFull`       | media                                |
| only rich text                                                      | `RichText`        | html                                 |
| **anything else / deeper nesting**                                  | `Grid` (fallback) | serialized `Node` tree               |

Every slice — pattern or fallback — also carries the band's `BlockStyle` so it renders
inside `SectionBand` (background band + content box), exactly as today.

The classifier is table-driven and pure; each row of the table is a unit test with a
real band fixture.

### [3] Emit

Three parallel outputs, all keyed by band/slice index so the runtime can line them up:

- **`emit-prismic`** (reuse `run-migration.ts`): pattern slices become Prismic slices
  with native fields (text → Rich Text, media → linked Prismic assets via the
  Migration API). This is the CMS-editable content.
- **`emit-manifest`** (extend `blux-presentation.json`): the **Grid fallback's**
  layout tree (and each pattern slice's style/role hints) go here, keyed by slice
  index. The fallback tree bakes its text as rich-text HTML strings — render-faithful,
  not individually CMS-editable. This is the accepted consequence of decision #4.
- **`emit-config`** (new, small): per-widget config (map: mid + lids + style JSON +
  center/zoom; video: asset id + poster/loop flags), keyed by slice index, read by the
  widget slice at render.

### Slice components (in the-pointe, promoted to starter later)

New/changed Svelte slices, all built on the existing `SectionBand` +
`presentation.ts`:

- `Hero`, `TitleBand`, `SplitFeature`, `StatGrid`, `Gallery`, `MediaFull`, `RichText`
  — pattern slices, straightforward props.
- `Grid.svelte` — **recursive** fallback: takes the serialized `Node` tree from the
  manifest and renders rows→cells→nodes, applying each cell's width from its
  `GridToken` (`ratio`% / `100/cols`% / sized calc) as inline style. This is the one
  component that guarantees fidelity for the long tail.
- `LocationMap.svelte` — the map widget (see below).
- Video is **not** a slice type — it is a media _kind_. `SplitFeature`, `MediaFull`,
  `Gallery`, and `Hero` render `<video>` when `media.kind === "video"`, `<img>`
  otherwise. (A `VideoFeature` alias exists only so the classifier has a name for a
  video-only band; it renders as `MediaFull` with a video.)

### The Map widget (`LocationMap.svelte`)

Steal Blux's own map, which is free to reuse except the key:

- **Config** extracted deterministically from the rendered HTML's `initMap` script by
  a `blux/grid/extract-map.ts` stage: the Google My Map `mid`, the 8 category `lid`s
  (Hotels, Food_And_Drink, Retail, Services, Entertainment, Office_Tenants, Studios,
  The_Burbank_Portfolio), the muted-greyscale `styles` JSON, and center/zoom.
- **Render:** load the Maps JS API with `VITE_GOOGLE_MAPS_KEY`, `new google.maps.Map`
  with the extracted `styles`, then add one `google.maps.KmlLayer` per `lid` pointing
  at `google.com/maps/d/kml?mid={mid}&lid={lid}`. The KML layers carry the pins and
  info windows — no per-pin data to migrate.
- **Risk:** the extracted `center` in `initMap` is Google's placeholder
  (`{lat:-34.397,lng:150.644}`); the real framing comes from the KML bounds. Render
  with `preserveViewport:false` on the first KML layer (fit to pins) or hardcode a
  Burbank center; verify visually. Flagged in Open Questions.

---

## Data flow (end to end)

1. `blux convert the-pointe` reads `index.html` + `site.json` from the export.
2. Parser → `Band[]`; classifier → `SliceSpec[]`; map/video extractors → widget
   configs.
3. Emit: Prismic page doc + custom types + uploaded assets; `blux-presentation.json`
   (style hints + fallback grid trees); widget config JSON.
4. the-pointe builds; `SliceZone` renders each slice, passing `context={{ presentation }}`;
   `Grid.svelte` reconstructs fallback bands; `LocationMap.svelte` mounts the map.
5. `blux validate --against <deployed-url-or-index.html>` runs content coverage +
   the new layout-signature check.

---

## Validation & testing

- **Grid-tree parser:** snapshot tests — fixture HTML fragments (one per grid token
  and nesting depth) → expected `Band[]`. The-pointe's full `index.html` is a golden
  fixture (parse → stable tree snapshot).
- **Classifier:** one unit test per signature row with a real band fixture, plus an
  "unrecognized → Grid fallback" test.
- **Content coverage** (`blux validate`, existing): unchanged mechanism, but expected
  to reach ~100% now that widget bands (map labels, hero overlay copy) are no longer
  dropped. The two known gaps at 81% (hero overlay + portfolio/map labels) are covered
  by the widget handling.
- **Layout-signature check** (new in `validate.ts`): parse both the answer key and the
  rendered converted page into grid trees and compare the **signature sequence**
  (ordered band signatures + per-row cell-token tuples). Report the first divergence.
  This catches "content is right but layout drifted" — the exact failure this replan
  fixes. It is a structural diff, not a pixel diff.
- **Component rendering:** the-pointe's existing Svelte test setup covers `Grid.svelte`
  recursion (tree in → expected DOM structure) and video-vs-image media rendering.

---

## Rollout / build order

1. Grid-tree parser + tree model (`parse-grid.ts`) — snapshot-tested against the-pointe
   `index.html`.
2. Slice set + components in the-pointe (pattern slices on `SectionBand`; `Grid.svelte`
   recursive fallback; media kind = image/video).
3. Video handling + `LocationMap.svelte` + `extract-map.ts`.
4. Band classifier + widget router (`classify-band.ts`) + the three emit paths.
5. `validate.ts` layout-signature check.
6. the-pointe migrate + verify vs the answer key (content coverage → ~100%, layout
   signature matches; visual sign-off).
7. Promote the generic pieces (slice set, `Grid.svelte`, `SectionBand` already there,
   parser stays in `reddoor-maintenance`) to `reddoor-starter`.

Each step is independently testable; steps 1–5 land in `reddoor-maintenance`, step 2/6
touch the-pointe, step 7 touches the starter.

---

## Non-goals (YAGNI)

- **No full CMS editability of fallback bands.** Grid-fallback content lives in the
  manifest; promoting a common fallback layout to a new pattern slice is the path to
  editability, done only when a real site needs it.
- **No pixel-perfect diffing.** Fidelity is judged by grid-signature match + human
  sign-off, not screenshot comparison.
- **No generalization beyond the observed vocabulary.** The parser handles the ~13
  tokens the fleet's exports actually use; an unseen token fails loudly (and the band
  drops to the Grid fallback) rather than being guessed.
- **No per-pin map data migration.** The public Google My Map KML layers are reused
  as-is.

---

## Open questions / risks

1. **Map framing** — confirm the map centers on Burbank (KML `fitBounds` vs the
   placeholder center in `initMap`). Verify visually on the preview deploy.
2. **Grid fallback in manifest vs Prismic** — decision #4 puts fallback trees in the
   manifest (not CMS-editable). Confirm this is acceptable for the stopgap, or promote
   more signatures to pattern slices if too many bands land in the fallback.
3. **Role ↔ node correspondence** — the parser attaches roles by document order
   between rendered HTML and `site.json`; verify this holds on a second site before
   relying on it fleet-wide.
4. **Token coverage on other sites** — the vocabulary was measured on the-pointe only;
   the next Blux site may introduce a new token. The loud-failure + Grid-fallback path
   is the safety net, but re-measure per site.
