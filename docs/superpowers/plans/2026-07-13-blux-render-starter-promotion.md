# Blux Faithful Render → reddoor-starter Promotion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the-pointe's faithful-grid Blux render (`src/lib/blux/` + the band slices) into reddoor-starter so future Blux conversions clone it, and retire the starter's dead pre-faithful manifest layer (#46).

**Architecture:** Two PRs in reddoor-starter. PR A lands `src/lib/blux/` as a namespaced, generalized port of the-pointe's render (contract, Grid walker, SectionBand, BandContent, BandTitle, Media, LocationMap, CarouselFrames) plus the seven band slice types registered in the page custom type, and a hermetic `/dev/blux-page` fixture route. PR B removes the old index-keyed presentation-manifest layer (`src/lib/presentation.ts` + stub JSON + slice context plumbing), whose producer no longer exists (emit was backported to the faithful format in #392), and renames the old `SectionBand` shell to kill the name collision.

**Tech Stack:** Svelte 5 runes, SvelteKit, Tailwind v4, Slice Machine models, vitest (jsdom), fleet reusable CI v1.2.0.

**Prerequisite:** the carousel PRs (reddoor-maintenance `feat/blux-carousel-slice`, the-pointe `feat/blux-carousel`) are merged — port from the-pointe **main** after merge.

**Generalization rules (what changes on the way in):** the-pointe's live-tuned behavior does NOT port as-is (memory decision rule). Three deliberate divergences from the-pointe source, each with a comment naming the-pointe's deviation:

1. **BandTitle** reads roles from the manifest (`band.text.headingRole` / `headingLevel` / `subtitleRole`, emitted since #394) instead of the-pointe's hard-coded `text5/text12/text11`; no role → no `txt-role-*` class.
2. **Media** honors `fit`/`position` by default (`fit:"auto"` → `object-fit:none`, `position` → `object-position`) — the-pointe deliberately drops them because its live site hides the accent bands; that stays a the-pointe-local edit.
3. **`txt-role-*` CSS** is a documented convention block in the starter's `src/app.css` with neutral placeholder rules — real values are measured per-site from the live original.

---

# PR A — promote the render (branch `feat/blux-render`)

Repo: `/Users/tuckerlemos/Documents/GitHub/reddoor-starter`. Port source: `/Users/tuckerlemos/Documents/GitHub/pointe-plan7` (main, post-carousel). Gate: `pnpm exec prettier --check . && pnpm exec eslint . && pnpm check && pnpm build && pnpm test` (build prerenders — anchors must resolve; `/health` and the `/` footer smoke marker must be untouched).

### Task P1: `src/lib/blux/` core

**Files:**

- Create: `src/lib/blux/presentation.ts`, `Grid.svelte`, `SectionBand.svelte`, `BandContent.svelte`, `BandTitle.svelte`, `Media.svelte`, `CarouselFrames.svelte`, `LocationMap.svelte`, `maps-loader.ts`, `blux-presentation.json` (stub `{"bands":{}}`), and each component's colocated `*.test.ts`
- Modify: `vitest-setup.ts` (add the-pointe's `NoopIntersectionObserver` global polyfill — animateIn runs on every SectionBand; keep the existing matchMedia stub; per-file fakes still override)
- Modify: `src/app.css` (documented `txt-role-*` convention block)

- [ ] Port each file from the-pointe verbatim EXCEPT the three generalization rules above; `presentation.ts` keeps the full contract (including `carousel` + `RenderMedia.minHeight` + `caption`) and its stub import comment gains: "the starter ships an empty manifest; `blux convert` output replaces it per-site."
- [ ] BandTitle generalization: props stay `{heading?, subtitle?}` plus a new `text?: BandPresentation["text"]`; role classes derive from `text` (`txt-role-${role}` when set); heading level for the heading-only mode from `text.headingLevel ?? 2`. Update the Hero/TitleBand slices (Task P2) to pass `band?.text`.
- [ ] Media generalization: `fit`/`position` consumed into the style string; add test cases (auto → `object-fit:none`, position passthrough, absent → no style).
- [ ] Port tests, adapting to the starter's per-file IntersectionObserver convention only where a test drives IO explicitly.
- [ ] Run `pnpm test`, commit per component group (contract, walkers, media, map, carousel).

### Task P2: band slices + registration

**Files:**

- Create: `src/lib/slices/{GridBand,TitleBand,SplitFeature,Gallery,MediaFull,LocationMap,Carousel}/` (model.json + index.svelte + colocated test — port from the-pointe; note the-pointe's Gallery carousel-transition mode does NOT port: the starter Gallery renders captioned-grid / full-bleed modes only, and slider bands arrive as `carousel` slices from day one)
- Modify: `src/lib/slices/Hero/` (add the `band` variation from the-pointe), `src/lib/slices/RichText/` (band-aware SectionBand wrap, port from the-pointe), `src/lib/slices/index.js`, `customtypes/page/index.json` (add the seven new choices)

- [ ] Port each slice; adjust imports to starter aliases; keep `Content.*Slice` typing consistent with how the starter's existing slices type props (hand-extend generated types the way the-pointe did if needed).
- [ ] Register all ids in `index.js` + custom-type choices; run `pnpm check`.
- [ ] Commit per slice group.

### Task P3: hermetic `/dev/blux-page` fixture route

**Files:**

- Create: `src/routes/dev/blux-page/+page.svelte`, plus a small fixture manifest + slice list (either inline in the route or `src/routes/dev/blux-page/fixtures.ts`)

- [ ] Build a 4-band hermetic fixture (data-URI images, no network): a hero band (background + text meta), a grid_band with a real RenderNode tree (row/stack/heading/media), a carousel (2 slides with captions + minHeight), and a title_band. Render through the same `<SliceZone>` wiring as the-pointe's dev route but with the fixture data.
- [ ] This route feeds the CI axe audit (the reusable workflow audits /dev pages) — run `pnpm build` and `pnpm exec reddoor-maint audit --only a11y --fail-on-violations` locally if configured, else rely on CI.
- [ ] Commit, run the full gate, fix, push-ready.

# PR B — retire the dead manifest layer (branch `chore/retire-presentation-sidecar`, AFTER PR A merges)

- [ ] **Census first:** `gh api 'search/code?q=org:reddoorla+filename:blux-presentation.json' --jq '.items[].repository.full_name'` — any repo whose file is NOT the literal `[]` stub converts this PR into a per-site migration first (none expected; the-pointe uses the new format).
- [ ] Delete `src/lib/presentation.ts`, `src/lib/blux-presentation.json` (the `[]` stub at lib root — NOT the new `src/lib/blux/blux-presentation.json`), `src/lib/presentation.test.ts`.
- [ ] Strip `index`/`context`/`roleClass`/entry plumbing from Hero, MediaText, RichText, SectionGrid (they already render Tailwind defaults when entry is undefined — pure dead-code removal; CollectionList's separate `context.collections` wart stays as-is).
- [ ] Rename `src/lib/components/SectionBand.svelte` → `ContentBand.svelte`, dropping `block`/`bandStyle`/`contentStyle`; update its four consumers. `src/lib/blux/SectionBand.svelte` becomes the only SectionBand.
- [ ] Update both route files to plain `<SliceZone slices={...} {components} />` (drop `pagePresentation`).
- [ ] Full gate + a11y fixtures page still passes (it imports the four old slices).

## Out of scope

- Migrating the four old slices (Hero default/MediaText/SectionGrid/CollectionList) onto RenderNode trees — they serve hand-authored Prismic content, not conversions.
- Back-porting the starter's generalized BandTitle/Media to the-pointe — do it opportunistically on the next the-pointe touch.
- Slice Machine pushes to any live Prismic repo (operator).
