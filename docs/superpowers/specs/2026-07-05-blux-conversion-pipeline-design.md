# Blux → Reddoor-stack conversion pipeline — design

**Goal:** A reusable, deterministic pipeline that converts a Blux site export into
a Reddoor-stack site — Prismic page content, reusable Custom Types (from Blux feeds)
with their assets uploaded via the Migration API, and a SvelteKit theme
faithful-to-a-point to the Blux design — so the ~12 sites still on the sunsetting Blux
platform can be migrated onto our stack with only an end-of-line human "good enough"
sign-off.

**Architecture:** Blux export → deterministic parse → normalize + model-collections
into a stack-agnostic **Content IR** → fan out to `emit-prismic` (page docs + Custom
Types + collection docs + CDN→Prismic asset upload) and `emit-theme` (design tokens)
→ the `/new-site`-scaffolded SvelteKit app renders it → a screenshot review gallery
gates the sign-off. The IR is the reuse contract; the 12 exports are the test corpus.

**Tech stack:** TypeScript + tsx (in `reddoor-maintenance`, as a `blux` command
group), `@prismicio/client` Migration API + `@prismicio/migrate` (`htmlAsRichText`,
`createAsset(url)`), the reddoor-starter slice library + design tokens, Playwright
(or the existing browser-audit harness) for the review screenshots.

---

## Non-negotiable principle: deterministic & reproducible

The conversion core contains **no LLM/AI**. Every stage is pure, rule-based code:
same Blux export in → byte-identical IR out, every run. This is what makes the
pipeline testable (snapshot the IR), debuggable (diff the mapping), and safe to
re-run (idempotent emit). The only human judgment is the final visual sign-off,
which is a review gate on rendered output — never a step inside the pipeline. Any
future AI use is confined to optional, off-path _suggestions_ for flagged
low-confidence blocks and must never affect the reproducible output.

## Why this shape (rejected alternatives)

- **Direct HTML/CSS transcode** (pixel-faithful Svelte components from the exported
  `index.html`): rejected — produces a dead static snapshot with no content model,
  not client-editable, doesn't live "on our stack," and makes the eventual redesign
  _harder_. Wrong for a stopgap that becomes a redesign.
- **Assisted per-section mapping** (human confirms each block's mapping): rejected —
  puts the human in the middle of every site, contradicting the "approve only at the
  end" goal and not scaling across 12 sites. Ambiguity is handled by confidence
  scoring + fix-in-review instead.

## Architecture

```
Blux export dir ──parse──▶ raw Blux structures (pages/items tree, feeds, styles, media, nav/footer)
              ──normalize + model-collections──▶  SiteIR { meta, pages[], collections[], theme, assets[] }
                                             │
        ┌────────────────────┬──────────────┼──────────────────────┬────────────────────┐
   resolve-assets      emit-prismic     (custom types +        emit-theme          review
  (uuid→CDN URL         content docs +   collection docs)      (ThemeIR →          (screenshot
   union map;           assets uploaded  ── all via the         SvelteKit           gallery vs
   optional bucket      Blux CDN→Prismic  Migration API,        design tokens)      Blux original)
   archive)             via createAsset)  staging first             │                   │
                                             └── /new-site SvelteKit app + staging Prismic render ──┘
                                                          │
                                            human: "good enough" → promote / launch
```

The pipeline targets a site that `/new-site` has already scaffolded; it does **not**
scaffold the SvelteKit app itself.

## The Content IR (the reuse contract)

A normalized, source- and target-agnostic representation. Adding a 13th Blux site
just re-runs the pipeline; a future non-Blux source implements its own
`parse`+`normalize` to the same IR and reuses the entire back half.

```ts
type SiteIR = {
  meta: { name: string; domain: string; bluxSiteId: string };
  theme: ThemeIR;
  pages: PageIR[];
  collections: CollectionIR[]; // Blux feeds → Prismic repeatable custom types
  assets: AssetRef[]; // deduped across the whole site
  diagnostics: Diagnostic[]; // flagged low-confidence mappings, unresolved assets, unwired refs
};

type PageIR = { uid: string; title: string; description: string; sections: SectionIR[] };

type SectionIR = {
  sliceType: "hero" | "media_text" | "rich_text" | "grid" | "slider" | "collection_list";
  variation: string; // e.g. "default" | "imageLeft" | "imageRight"
  confidence: number; // 0–1; < threshold ⇒ Diagnostic + rich_text fallback
  fields: {
    heading?: RichText;
    body?: RichText;
    media?: AssetId;
    backgroundMedia?: AssetId;
    ratio?: string;
    columns?: number;
    align?: string;
    anim?: string;
  };
  // Set on collection_list (a block that renders a feed). wired:false ⇒ the collection
  // is imported but this link is a best-guess, Diagnostic-flagged to connect back later.
  collectionRef?: { apiId: string; mode: "all" | "items"; itemUids?: string[]; wired: boolean };
  children?: SectionIR[]; // containers (grid/slider) nest their items
};

// A Blux feed becomes a Prismic repeatable Custom Type + one document per item.
type CollectionIR = {
  apiId: string; // derived, e.g. "product" | "team_member" | "news_article"
  label: string; // Blux feed name ("Products", "Team", …)
  publishRoute: string | null; // Blux feed.publish ("products"/"news"); null = embedded-only
  fields: FieldDef[]; // deterministically derived schema (see modeling section)
  records: RecordIR[];
};
type FieldDef = {
  key: string;
  type: "text" | "richtext" | "image" | "group" | "date" | "boolean" | "number" | "link";
};
type RecordIR = { uid: string; values: Record<string, unknown>; mediaRefs: AssetId[] };

type ThemeIR = {
  colors: { role: string; value: string }[]; // Blux 7-slot palette → token roles
  fonts: { heading: string; body: string };
  textStyles: { role: string; size: string; weight: number; lineHeight: number }[];
  buttons: { role: string /* fill, radius, etc. */ }[];
};

type AssetRef = {
  id: AssetId; // Blux media uuid
  sourceUrl: string | null; // resolved CDN URL (null ⇒ unresolved, see diagnostics)
  name: string;
  mime: string;
  width?: number;
  height?: number;
  alt: string;
};
```

## Stages (each an isolated, independently-tested module)

**`parse`** — reads `site.json` + the rendered per-page HTML → raw Blux structures.
Pure, no network. `site.json` is the single source: page blocks live in
`content.pages[].items`, reusable collections in `site.json.feeds` (each feed
carries its own `items[]`). The loose top-level `<feed-uuid>.json` and `*.xml`
files on disk are redundant mirrors of those feeds — not read.

**`normalize`** — the block-mapping brain. For each block in `content.pages[].items`
(recursively), derives an archetype from its populated-field signature (heading =
`title`/`_title`; text = `body`/`_body`; `media`; `backgroundMedia`; `items` ⇒
container; `class` ⇒ grid/slides layout) and maps it to a `sliceType` + `variation`

- `confidence`. The census `archetype()` function is the seed. Emits page `SectionIR`s.
  Rich text (`_body`) is converted with `htmlAsRichText` at emit time; `normalize`
  keeps it as HTML in the IR. Blux `styles` → `ThemeIR`.

**`model-collections`** — turns each `site.json.feeds` entry into a `CollectionIR`
(→ a Prismic repeatable Custom Type + one document per item). Deterministic: see the
"Reusable content" section. Also detects feed-rendering blocks and sets their
`collectionRef` (best-try wiring; unresolved links → `wired:false` + Diagnostic).

**`resolve-assets`** — builds one global `uuid → known-good CDN URL` map using the
**union strategy**: (1) scrape every export's rendered HTML for real CloudFront URLs
(100% reliable for used assets — normalize away Blux transform segments like
`/w:96/from:jpg/` back to the proven original `<host>/<siteId>/<uuid>.<ext>`),
then (2) for library uuids not seen in any HTML, reconstruct + ext-probe
(`name`-ext → mime-ext → common exts). Unresolved uuids become `Diagnostic`s, never
silent drops. Image host `d3syaxnfm3oj0e.cloudfront.net`, video host
`dv4tl7yyk1zlp.cloudfront.net`. (Naive per-site reconstruction alone resolved only
~58% in probing — shared assets use a different owner `siteID` — which is why the
cross-site HTML union is required.)

**`emit-prismic`** — `SiteIR` → Prismic via the existing Migration API scaffold. Emits,
in order: (1) generated **Custom Type schemas** (`customtypes/*.json`) — the `page`
type plus one repeatable type per `CollectionIR`; (2) **collection documents** (one per
record); (3) **page documents** with their slices, linking `collectionRef`s to the
collection docs via content-relationship fields. Assets upload via
`createAsset(sourceUrl, alt)` (see "Asset migration"). Uses `htmlAsRichText` for prose.
Respects Prismic's 1 doc/sec limit; targets a **staging** repo first. Idempotent by
`uid`, so partial runs resume.

**`emit-theme`** — `ThemeIR` → the scaffolded site's design tokens (CSS custom
properties / Tailwind theme): map the Blux 7-slot palette to the starter's token
roles, set the font pair, and the text-style scale. "Faithful to a point": where a
Blux style has no simple token equivalent, snap to the nearest and let the review
gallery surface it.

**`review`** — renders the converted site (SvelteKit + staging Prismic) and captures
one screenshot per page, side-by-side with the Blux original (the exported
`index.html`, or a screenshot of the live URL), into a single gallery. Lists all
`diagnostics` (flagged blocks, unresolved assets) for quick attention. This gallery
is both the acceptance test and the sign-off surface.

## Prerequisite: target slices (built first, in reddoor-starter)

The pipeline emits into these; they are a hard dependency and the plan sequences
them first. Census-scoped, cover the whole fleet:

- **Hero** — `backgroundMedia` + heading/text (+ `loadEffect`); extends the
  starter's `HeroBackgroundImage`.
- **MediaText** — image/video + rich text, side-by-side, `ratio` + reverse variation
  (the 569-count workhorse archetype).
- **Section/Grid** — N-column container holding child slices (`class` = column
  count); the nesting primitive (corpus max depth 4).
- **CollectionList** — renders items of a linked repeatable Custom Type (grid/list/
  carousel variation); the `collection_list` slice a feed-rendering block maps to.
- **RichText** (exists) and **Slider** (exists, PR #39) — reused as-is.

## Code homes

- **reddoor-maintenance** — the pipeline: `blux` command group (`parse`, `normalize`,
  `model-collections`, `resolve-assets`, `emit`, `review`), the IR types, the corpus
  fixtures + snapshot tests. Reuses the existing CLI (cac), tsx, credential loading,
  and `ensure-site` (each converted site needs its Airtable Websites row).
- **reddoor-starter** — the 3 new slices + the theme-token conventions `emit-theme`
  writes into. Shipped in the template so every scaffolded site has them.

## Reusable content: Blux feeds → Prismic Custom Types

Blux has an explicit **feed** = a reusable, structured collection authored once and
referenced across pages. The corpus has **18 feeds / 1,789 records**, and their shapes
are regular enough to model deterministically — the part you flagged as maybe-too-hard
turns out to be tractable for the _type + records_; only the _reference wiring_ needs a
fallback.

**Schema derivation (deterministic).** A feed's field schema comes from `feed.fields`
(Blux's own declared custom fields, e.g. Products declares `category`/`sub_category`/
`dimensions`) unioned with the keys observed across `feed.items`, typed by a fixed rule:
`title`→Text, `body`/`description`→Rich Text, `media`→Image (Asset), `tags`/`items`→
repeatable Group, `date`→Date, `featured`/`disabled`→Boolean, `url`/`link_*`→Link,
everything else→Text. This is pure and snapshot-tested — the same feed always yields the
same `customtypes/<apiId>.json`.

**Record emission (deterministic).** Each `feed.items[i]` → one Prismic document of that
type; its `media` refs flow through the asset pipeline like any other asset.

**apiId derivation.** From `feed.name` slugified + singularized (Products→`product`,
Team→`team_member`, News→`news_article`). The recurring corpus archetypes (person/team,
media-card, article/news, product, project, simple-list) inform sensible shared naming
but each feed still gets its own type (faithful over-normalization is cheap).

**Reference wiring (best-try + fallback — the hard part).** A page renders a feed via a
feed-display block (and `feed.publish` names a route, e.g. `products`→`/products`).
`model-collections` wires the obvious cases: a block whose feed is identifiable →
`collection_list` slice with `collectionRef.wired = true`; a `publish` route → a listing
page of that type. Where the linkage is implicit or a block curates specific items we
can't resolve deterministically, we **still import the type and all its records
faithfully**, emit a `collection_list` with `wired: false`, and raise a `Diagnostic` so
you/the designer connect it back in Prismic later — no data lost, just the last-mile link
deferred. Exactly the "map it in and connect later" escape hatch.

**Known corpus quirks handled:** malformed declared fields (tosa Events' blank-key
field) are skipped with a Diagnostic; junk feeds ("DO NOT USE THIS") import but flag;
`disabled`/`disable_publish` records import with a status field so they can be filtered,
not silently dropped; cross-site feeds (tbpfit holds equipment grids for several Worthe
properties) are modeled on the owning export and referenced where used.

## Asset migration to Prismic

Media never touches our disk in the conversion path — it moves **Blux CDN → Prismic
asset store** via the Migration API. For every `AssetRef` (page-block media _and_
collection-record media alike), `emit-prismic` calls
`migration.createAsset(asset.sourceUrl, asset.alt)`, which makes Prismic fetch the bytes
from the resolved CloudFront URL, store them in the repo's asset library, and dedupe by
source (so a shared image referenced by many blocks/records uploads once). The returned
asset reference is what gets set on the document field. `resolve-assets` guarantees every
`sourceUrl` is a proven-good original URL before emit; unresolved assets are skipped with
a Diagnostic rather than failing the run. Blux media refs also carry `crop` data — v1
ignores it (our imgix layer handles sizing/cropping on render); if a specific crop proves
load-bearing for fidelity it surfaces in the review gallery and becomes a per-asset
Diagnostic. (The separate bucket archive is unrelated to this path — that mirrors the
full library for preservation; this uploads only what a converted site references.)

## Validation — the 12 exports as a corpus

- **Snapshot tests**: `parse`, `normalize`, and `model-collections` outputs are
  snapshotted per corpus site — including the generated `customtypes/*.json` schemas —
  so any mapping or schema change surfaces as a reviewable diff.
- **Coverage metric**: `normalize` reports the % of blocks mapped at/above the
  confidence threshold, and `model-collections` reports feeds modeled vs. records with
  unwired references. Census predicts high block coverage (~4 archetypes cover the
  fleet); a drop on a new site signals a real gap, not a silent miss.
- **Acceptance**: the review gallery — human "good enough" per site.

## Error handling / degradation (all explicit, never silent)

- Low-confidence / unmapped block → `rich_text` fallback carrying its text + a
  `Diagnostic`. Content is never dropped.
- Unresolved asset → `sourceUrl: null` + a `Diagnostic` listing uuid/name for manual
  sourcing; the import proceeds without it.
- Unwired feed reference → collection type + records still import; the page link is a
  `collection_list` with `wired: false` + a `Diagnostic` to connect back in Prismic.
- Malformed/junk feed data (blank field keys, "DO NOT USE" feeds, disabled records) →
  imported-and-flagged or status-tagged, never silently dropped.
- Prismic partial failure / rate-limit → resumable; re-run is idempotent by `uid`.
- Staging-first is mandatory: diff + eyeball in Slice Simulator and the review
  gallery before any promotion to a production repo.

## Rollout

1. Build the 3 slices in the starter.
2. Prove the whole chain end-to-end on **one** site — `thePinnacle` (3 pages, clean
   Worthe design) — and tune the mappers against its review gallery.
3. Generalize: run the remaining Worthe cluster (shared design → near-free), then the
   4 independents.
4. Each site: `ensure-site` row → convert → review → sign-off → launch via the
   existing flow.

## Out of scope (related, tracked separately)

- **Media preservation archive** (bucket mirror of all ~4,175 library assets) —
  defensive, decoupled, time-sensitive; its own task. `resolve-assets` shares the
  URL-mapping logic but the pipeline does not depend on the archive.
- **The eventual redesigns** — these conversions are a stopgap; redesigning each site
  as a fresh project is future work the clean Prismic model sets up.
- **DNS cutover, redirects, form re-wiring to central ingest** — per-site launch
  tasks, handled by the existing launch flow, not the conversion pipeline.
- **Last-mile reference wiring** — where feed↔page links can't be resolved
  deterministically, the type + records import faithfully but the final linking is a
  manual Prismic step (flagged by Diagnostics), not automated. (Collection modeling
  itself — including compositionHospitality's 552-product feed — is now _in_ scope, via
  the "Reusable content" section.)

## Corpus reference (as of 2026-07-05)

12 exports on `~/Desktop`: the 6 Worthe/Burbank sites (theBurbankPortfolio,
thePinnacle, theTower, thePointe, oceanAvenueProject, mediaStudios) + fitHealthClub
(Worthe-adjacent) + independents (strategyAdvantage, xcoSite, compositionHospitality,
williamsonHomes, tosa). Full census: `reddoor-starter/BLUX-CENSUS.md`. ~1,700
content blocks fleet-wide collapse to 4 archetypes; **18 feeds / 1,789 records** →
candidate Custom Types; ~4,175 media-library assets (~661 rendered/used).
