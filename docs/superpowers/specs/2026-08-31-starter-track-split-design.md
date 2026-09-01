# Starter track split — design

Status: approved in discussion 2026-08-31 (repo-per-track over branch-per-track,
snapshot-then-native-ize sequencing, Webflow needs no third template); this
document is the written record. First consumer: the Vida Legacy Foundation
build, the fleet's first `/new-site` clone.

## Goal

`reddoorla/reddoor-starter` is the GitHub template every new client site is
generated from, and it is also the render target of the Blux migration
pipeline (`reddoor-maintenance/src/blux`). Those two jobs pull the template in
opposite directions. The pre-clone review (2026-08-31) found that a fresh
clone today:

- deploys another client's homepage — `src/routes/dev/blux-frozen` and
  `dev/blux-pointe` prerender the-pointe's fixtures (`build/dev/blux-frozen.html`,
  96 KB) into every site, fenced only by a `robots.txt` hint;
- runs `tests/gate/frozen-fidelity.spec.ts` and `pointe-fidelity.spec.ts`
  (no skip guard; the shared Playwright config's `testDir` is `tests`) on every
  PR of every site, asserting facts about a Burbank apartment complex;
- offers the editor 12 `Blux*` slices whose fields are serialized converter
  output, plus 7 "generic" slices whose only field is `band:Number` (an index
  into an empty presentation manifest), plus 6 catalog custom types nothing
  native uses;
- carries 36 % of its vitest cases and 164 + 64 + 80 KB of `src/lib/blux*`
  for a render path a native site never takes;
- ships 632 KB of Blux planning docs under `docs/superpowers/` that
  `.git/info/exclude` was meant to keep out (they were re-added on feature
  branches after e398ea1).

Every one of those is correct for the Blux track and wrong for a native site.
Separate the tracks so each template is right for its job, and so the Blux
pipeline — proven push-button on the-pointe-burbank and the-tower-burbank —
keeps working exactly as it does today.

## Decisions (locked)

- **Repo per track, not branch per track.** `gh repo create --template`
  copies only the default branch, so a `blux` branch would push the new-site
  skill off the template path (clone-and-push instead); Renovate would need
  `baseBranches`; branch protection and PR bases would multiply; the fleet
  tooling (`ensure-site`, `self-updating`, rulesets) keys on repos. A second
  repo with **shared history** keeps `git merge` open between them.
- **Snapshot first, then native-ize.** `reddoor-starter-blux` is created by
  pushing today's `reddoor-starter` `main` (full history) — zero code change,
  so the migration path is preserved byte-for-byte. Only then does
  `reddoor-starter` `main` lose its Blux layer.
- **No Webflow template.** The Webflow work is a maintenance-side importer
  (`crawl → IR → Prismic docs`) that targets the native `page` type — that is
  how Beachfront was built. If a frozen-page approach is ever wanted for a
  Webflow site, it forks from the Blux repo, which already carries the frozen
  layer.
- **Native-ize is a real refactor, not a delete.** Both content routes and the
  sitemap import `blux-catalog`/`blux-frozen`; the layout, `Nav` and `Footer`
  type their chrome from `$lib/blux/site-config`; 14 of the 16 generic slices
  import `$lib/blux/presentation` + `SectionBand`. Native needs plain Prismic
  loaders, chrome types of its own, and slices that render without a
  manifest.
- **i18n and a `settings` custom type are NOT part of this split.** They are
  built in the VLF repo against real content and upstreamed as twins (the
  new-site workflow's upstream-twin rule). Their absence in the native
  template is a known gap, not a regression.

## Repo topology

```
reddoorla/reddoor-starter        template · native sites · default for /new-site
reddoorla/reddoor-starter-blux   template · Blux migrations · /new-site --track blux
```

Merge direction is **starter → starter-blux only**. Shared improvements
(a11y, media, forms, CI, deps) land in `reddoor-starter` and are pulled into
the Blux repo with `git merge starter/main` (add the native repo as a remote
named `starter`). Blux-only changes stay in the Blux repo. Nothing merges
back the other way; if a Blux-side improvement is generic, it is re-applied
to native as its own PR.

Conflict surface after native-ize: the files native rewrites (routes, chrome
types, the 9 kept slices, `svelte.config.js`, `package.json` name, README).
Expected to be small and localized; the first forward-merge after this split
is the proof, and it is part of verification below.

## Native-ize scope (`reddoor-starter` `main`)

### Delete

| What                                                                                          | Why safe                                                                                          |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/lib/blux/`, `src/lib/blux-catalog/`, `src/lib/blux-frozen/`, `src/blux-theme.css`        | render layer for the Blux track only, once the imports below are rewritten                        |
| `src/lib/slices/Blux*` (12)                                                                   | converter-emit targets, unusable by an editor                                                     |
| `src/lib/slices/{Carousel,Gallery,GridBand,LocationMap,MediaFull,SplitFeature,TitleBand}` (7) | `band:Number` is their only (or only meaningful) field — nothing to edit natively                 |
| `src/lib/slices/CollectionList`                                                               | reads Blux `collection_type` entity docs                                                          |
| `src/routes/dev/blux-frozen`, `dev/blux-pointe`, `dev/blux-page`                              | the-pointe fixtures; the a11y fixtures spec drops its `/dev/blux-page` entry                      |
| `src/routes/products/[slug]`, `ProductDetail.svelte`, `ProductListing.svelte` (+ tests)       | Blux product catalog                                                                              |
| `src/routes/blux-{skeleton,emit-breadth,collection-emit}.test.ts`                             | emit contract tests                                                                               |
| `tests/gate/frozen-fidelity.spec.ts`, `tests/gate/pointe-fidelity.spec.ts`                    | the-pointe gates                                                                                  |
| `customtypes/{product,collection_item,project,event,news_article,person}`                     | catalog entity shells; would push 6 junk types into every native Prismic repo                     |
| `docs/superpowers/` (19 tracked files), `scratchpad/regen-types.mjs`, `scripts/import/`       | process docs / Blux tooling; `git rm --cached` so local copies survive, matching e398ea1          |
| `docs/migration.md`                                                                           | Blux-migration doc — verify content before deleting; move to the Blux repo if it is Blux-specific |

### Rewrite

| File                                                                                                             | Change                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/[[preview=preview]]/+page.server.ts` and `[uid]/+page.server.ts`                                     | plain `client.getByUID("page", uid)` (+ `getAllByType("page")` for `entries()`), keep the placeholder-repo short-circuit and 404 handling; drop `resolveFrozen`/`loadCollections`/`catalog_page` probing                                                                                                                            |
| `[[preview=preview]]/+page.svelte`, `[uid]/+page.svelte`                                                         | drop `FrozenPage` and presentation context; render `<SliceZone>` only                                                                                                                                                                                                                                                               |
| `src/routes/sitemap.xml/+server.ts`                                                                              | drop `frozenUids`; native `page` docs only                                                                                                                                                                                                                                                                                          |
| `src/lib/blux/site-config.ts` → `src/lib/site-config.ts`                                                         | move `NavItem`/`FooterSocial`/`FooterItem`/`FooterColumn`/`SiteConfig` types + `loadSiteConfig`/`footerColumns`; the JSON stub moves with it. (The VLF build replaces this with a Prismic `settings` doc; until then the stub stays the chrome source.)                                                                             |
| `src/routes/+layout.svelte`, `Nav.svelte`, `Footer.svelte`                                                       | import from the new location; drop the `page.data.frozen` bare-render branch; keep the page-data-over-config precedence (harmless, and Blux merges stay easier)                                                                                                                                                                     |
| 9 kept slices — Hero, MediaText, SectionGrid, RichText, TextColumns, Accordion, LeadText, Testimonial, CtaBanner | remove the `band` variation / field from `model.json`, replace `SectionBand`/`BandContent`/`BandTitle` wrappers with a plain `<section>` + `ContentWidth`; regenerate `mocks.json`; delete the `*Band.test.ts` cases and keep/extend the default-variation tests; add `mocks.json` where missing (TextColumns, Accordion, LeadText) |
| `src/lib/slices/index.js`, `customtypes/page/index.json`                                                         | 9 slice entries / choices                                                                                                                                                                                                                                                                                                           |
| `svelte.config.js`                                                                                               | drop `isFrozenSite` and the Maps-CSP wildcard branch (a native site that needs Maps adds the hosts per project, per the "extend per project" comment); keep the placeholder-repo prerender tolerance; `handleMissingId` becomes the plain fail-loud form                                                                            |
| `src/lib/prismicio.ts`                                                                                           | drop `isFrozenSite` and `frozenArtifacts`; keep the routes-free client and its rationale                                                                                                                                                                                                                                            |
| `src/app.css`                                                                                                    | keep `blux-layout.css` contents where the kept slices depend on them (rename to `layout.css`), drop the `blux-theme.css` import; add `--font-heading` / `--font-body` placeholders under `@theme` with a comment on the loading pattern; make the 3-identical-values placeholder palette distinct placeholders                      |
| `src/lib/seo.ts`                                                                                                 | keep `SITE_NAME`/`SITE_LOCALE`/`DEFAULT_OG_IMAGE` but mark them `// per-site` at the top of the file; the new-site skill gains a step to set them                                                                                                                                                                                   |
| `tests/a11y/fixtures.spec.ts`                                                                                    | remove the `/dev/blux-page` entry                                                                                                                                                                                                                                                                                                   |
| `README.md`                                                                                                      | split: thin client-facing README in the template; the stack/agency notes move to `docs/STARTER.md`; fix the duplicated Layout/UI bullets                                                                                                                                                                                            |
| `lighthouserc.json`                                                                                              | keep `/dev/a11y-fixtures` and add `/` so a site gets a real-route signal once it has content                                                                                                                                                                                                                                        |
| `package.json`                                                                                                   | `name` stays `sveltekit-prismic-starter-t-lemos` (the new-site skill renames it); no dependency changes expected — verify `svelte-gestures`/`@zerodevx/svelte-img` are still imported by kept code before pruning                                                                                                                   |

### Keep (native, verified used)

`src/lib/components/*` except Product*, `src/lib/actions`, `src/lib/utils`,
`src/lib/transitions`, `Seo.svelte` + `seo.ts`, `contact/` form + Turnstile,
`health`, `robots.txt`, `sitemap.xml`, `api/preview`, `api/csp-report`,
`slice-simulator`, `dev/a11y-fixtures`, `dev/animate-in`, `tests/smoke`,
`tests/a11y`, `docs/accessibility.md`, `docs/security.md`,
`docs/recipes/datepicker.md`, `pnpm-workspace.yaml` (overrides + allowBuilds).

### Definition of done (native)

- `grep -ri blux src customtypes tests` returns nothing (comments included).
- `pnpm install && pnpm build` green on the placeholder repo; `pnpm test:unit`
  green with the Blux suites gone; `pnpm lint` green; `pnpm check` green.
- CI green on `main`.
- `git ls-files docs/superpowers scratchpad scripts/import` empty.
- A throwaway `gh repo create --template reddoorla/reddoor-starter` clone
  builds green and `build/` contains no `dev/blux-*` output. (Delete the
  throwaway afterwards.)

## Blux repo bootstrap (`reddoor-starter-blux`)

1. `gh repo create reddoorla/reddoor-starter-blux --public --description
"Reddoor site template — Blux migration track (frozen + catalog render)"`.
2. From the `reddoor-starter` checkout at the pre-split `main` SHA:
   `git push https://github.com/reddoorla/reddoor-starter-blux.git main:main`
   (full history). Record the SHA in the changelog below.
3. `gh repo edit reddoorla/reddoor-starter-blux --template`.
4. One commit on the new repo: `package.json#name` →
   `sveltekit-prismic-starter-blux`; README banner ("Blux migration track of
   reddoor-starter — merge `starter/main` forward, never back"); `.github/
workflows/ci.yml` `netlify-site: "reddoor-starter-blux"` (the input only
   builds the deploy-preview comment URL; a Netlify site of that name is
   optional and can be created later for previews).
5. Branch protection via the recipe (`node dist/cli/bin.js self-updating
<checkout>` from reddoor-maintenance), after the bootstrap push per the
   new-site skill's ordering note.
6. Maintenance repointing (one PR): the three `src/blux/emit/*` "render mirror
   is reddoor-starter" comments → `reddoor-starter-blux`; `CLAUDE.md` gets a
   Blux-track pointer; the Blux pipeline spec (`docs/superpowers/specs/
2026-07-05-blux-conversion-pipeline-design.md`) gets a dated note at the
   top. Historical plans are not rewritten. `src/prismic/models/config.ts`
   (one starter reference) is checked for track-awareness during planning.
7. Local: `git remote add starter https://github.com/reddoorla/reddoor-starter.git`
   in the Blux checkout; first forward-merge after native-ize as the
   verification step.

## Skill changes

- `new-site`: `--track native|blux` (default native) selects the template
  repo; add the de-brand step (seo.ts `SITE_NAME`/`SITE_LOCALE`, favicon,
  `og-default.png`, `<html lang>`) and the CSP reminder ("extend per project"
  for fonts/video/donation hosts). The skill file lives in `~/.claude/skills`,
  which is write-denied in the sandbox — edit unsandboxed with the operator's
  go-ahead, or hand the diff over.
- `figma-slices`: unchanged (it already assumes the native library).

## Sequencing with VLF

1. This spec → plan → Blux snapshot (steps 1–5 above, one sitting).
2. Native-ize PR on `reddoor-starter` (subagent-driven; small batches:
   routes+chrome, slices, config+docs).
3. Maintenance repointing PR + `new-site --track`.
4. `/new-site vida-legacy-foundation` from the clean template; VLF gets its
   own design spec (i18n `/es`, `settings` type, donation pre-form → LGL
   prefill, slice inventory from Figma).

## Out of scope

i18n, the `settings` custom type, slice screenshots for the Prismic picker,
a Webflow render track, Node engine alignment (`>=20` vs the `24` pins) —
each noted in the review and tracked separately.

## Risks

- **Silent Blux-side drift.** Once the repos diverge, a fix landing only in
  the Blux repo is invisible to native. Mitigation: the merge-direction rule
  above and a line in the Blux README; revisit if the twins drift.
- **Kept-slice rewrites change rendering.** The 9 kept slices lose their
  `SectionBand` wrapper; any fleet site that consumed them via upstream twins
  (none yet — the library is new as of PR #103) would be affected. Verified
  none before deleting.
- **`docs/migration.md` and `scripts/import/`** may be native-relevant
  (generic Prismic import). Read before deleting; keep if generic.

## Changelog

- 2026-08-31 — spec written and approved. Pre-split `reddoor-starter` `main`
  is `82d93b0` (Merge PR #103); the Blux snapshot SHA is recorded here when
  step 2 runs.
