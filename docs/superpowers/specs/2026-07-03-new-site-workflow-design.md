# New-client-site workflow — design

> Adopted from reddoor-starter on 2026-07-19 (clone-template hygiene — process
> docs don't ship in the template). This is the workflow spec the `new-site`
> skill hands off from.

Status: approved in discussion 2026-07-03 (slice strategy, build depth, and
bootstrap form factor each confirmed); this document is the written record.
Companion context: the fleet brief and gap list (operator-local `FLEET.md` /
`GAPS.md`), the 2026-07-03 fleet code harvest, and the Blux track (deferred).

## Goal

Take a site from **awarded** to **launched and on the maintenance loop** fast,
consistently, and so that every build compounds the fleet: the pipeline is
`rfp-analyze` (exists) → `/new-site` (bootstrap) → `/figma-slices` (build) →
`reddoor-maint launch` (exists). Two new operator skills plus one small CLI
helper; no new services.

Evidence this is needed: hedloc — the newest site — drifted from the template
at creation time (CI shim v1.0.0, Node 22, legacy lucide package) because the
README checklist is manual. The workflow makes the golden path the easy path.

## Decisions (locked)

1. **Slice reuse: hybrid.** The starter grows a library of _structural_ slices
   (model.json, fields, a11y, layout) with intentionally plain styling; each
   site restyles via Tailwind/tokens. Bespoke showpiece sections stay
   site-only. "Shared plumbing, bespoke presentation" (fleet roadmap M7.3).
2. **Build depth: full implementation.** The agent implements each slice from
   the Figma section end-to-end (model → mocks → component → tests → PR);
   the operator reviews deploy previews under the normal CI-green + review
   loop.
3. **Bootstrap form factor: skill + small CLI helper.** A `/new-site` skill
   orchestrates; `reddoor-maint ensure-site <slug>` (new, small) creates or
   verifies the Airtable Websites row so the site is in the fleet inventory
   from day one.

## Phase 1 — `/new-site <slug>` (bootstrap skill)

Scriptable steps, in order, idempotent (re-run resumes at whatever's missing):

1. `gh repo create reddoorla/<slug> --template reddoorla/reddoor-starter`
   (the starter is a template repo), clone, rename `package.json#name` to the
   slug (drives audit slug-matching), leave the Prismic sentinel until step 4.
2. CI caller: set `netlify-site` input; **enable branch protection with the
   `ci / ci` check required** (day-one; lesson from reddoor-maintenance which
   had none). `RENOVATE_TOKEN` needs nothing — org secret, all-repos.
3. `reddoor-maint ensure-site <slug>` — Airtable row with status
   `in development`, `url`, `point of contact`, `Git repo`; frequencies stay
   `None` until launch. This also makes the form-ingest slug resolvable.
4. Operator prompts (true dashboard steps, in order): create the Prismic repo
   (then the skill un-sentinels `slicemachine.config.json`, which re-arms
   loud-fail prerendering); create the Netlify site (name = slug); paste
   `FORMS_INGEST_URL`/`FORMS_INGEST_TOKEN` (+ optional
   `PUBLIC_TURNSTILE_SITE_KEY`) into Netlify env.
5. Verification pass before handoff: placeholder build green locally, CI green
   on the repo, Renovate dashboard issue present, Airtable row present,
   `robots.txt`/sitemap render. Print the not-yet-done list if any.

## Phase 2 — `/figma-slices <figma-url>` (build skill)

Prereq: Figma MCP (authenticated against the Reddoor Creative team).

**Stage A — inventory (one approval gate per site).** Pull file metadata +
per-frame screenshots; propose: the slice inventory (which design sections
become which slices, with variation notes), custom types + route map, and the
Figma-variables → Tailwind `@theme` token mapping. For each proposed slice,
mark **site-only vs upstream-candidate** (structural-generic). The operator
approves/edits the inventory; that decision also settles what gets upstreamed.

**Stage B — per-slice loop (full implementation).** For each slice:
`get_design_context` + `get_screenshot` + variables → `model.json` + `mocks`
→ Svelte component matching the design (starter conventions: runes, `class:
passedClasses`, motion via `$lib/transitions`, reduced-motion respected,
trapFocus where overlays appear) → colocated test + a11y-fixtures entry →
slice-simulator + build verification → PR in small batches. Deploy previews
are the operator's visual review surface.

**Upstream twin rule.** When a slice was marked upstream-candidate, a separate
starter PR carries its plain-styled twin (same model/fields/a11y, unopinionated
CSS). Target: ~8–12 proven slices in the starter after the next two builds;
the Worthe conversions consume exactly this library later.

## Phase 3 — launch (existing machinery)

Content authored in Prismic (or imported via `scripts/import` +
`docs/migration.md`); pre-launch checklist from `docs/security.md` (CSP report
sink!) and `docs/accessibility.md`; DNS cutover runbook (written once, shared
with the Blux track); then `reddoor-maint launch <slug>` — first audit, launch
email draft, lifecycle flip into the maintenance/report loop.

## Fleet-harvest track

Wave 1 (a11y/motion foundation, media/perf, widgets, routing/SEO) **landed
2026-07-03** — starter PRs #33/#34/#35/#36, 26 source bugs fixed during
porting, 19 adversarial-review findings folded. Wave 2 lands _during_ the next
build, driven by need: the unified Slider (replaces ~19 fleet copies),
`<Seo>` component, `<CountUp>`, FilterableGrid/FLIP (Roalson's listings), the
animateIn x-stagger option. Wave 3 stays a recipe shelf (slide decks, Rive).
Follow-through: per-repo migration PRs retiring legacy copies, tracked with
the M7.4 conformance work.

## Blux forward-compatibility

The import track (deferred until the maintenance system is proven) plugs into
Stage A as an alternate content source: the inventory pass reads the Blux
export census (block types → slice mapping, `htmlAsRichText` fallback) instead
of a fresh Figma. Phases 1 and 3 are unchanged. Nothing in this design needs
rework for it.

## Verification & first run

- `ensure-site` gets TDD in reddoor-maintenance (fake Airtable base tests).
- Both skills get `--dry-run` walkthroughs and end-state verification steps.
- **First production run: Roalson Interests** — its listing/filter/map work
  is the first big upstream contribution and the pilot for the whole pipeline.

## Out of scope (deliberately)

Prismic repo creation via API (no public API for it), Netlify site creation
via API (possible with PAT — revisit if the manual step chafes), fully-styled
theme-able shared slices (rejected: fights bespoke design), Blux importer
implementation (own spec when its time comes).
