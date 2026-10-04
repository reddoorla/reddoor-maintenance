# Plan: move the fleet off Slice Machine (October 2026)

Follows `docs/prismic-model-management-2026-10.md` (P1-29), which established
that Slice Machine is deprecated and that Prismic's replacement is the Type
Builder plus the `prismic` CLI. The operator asked on 2026-10-01 for the full
migration, "everything up to date", with an estimate of the operator's own
time. Measured 2026-10-01 between 17:00Z and 17:25Z (`date -u`). Nothing in
this plan has been executed yet.

## 1. What is in scope (measured)

**Source.** Turso `sites` (SELECT only, every non-archived row with a
`git_repo`), plus williamson-homes, williamson-construction-co and the two
starters. Each repo was shallow-cloned read-only at its current `main`.

**21 repos run Slice Machine**: 19 sites and both starters. Three maintained
sites have no Prismic at all (1836dig, la-homelessness-initiative,
la-homelessness-youth). domaru has no clonable repo yet.

| Repo                       | Prismic repository      | Slices | Types | `prismic-models.yml` | Notes                                               |
| -------------------------- | ----------------------- | -----: | ----: | :------------------: | --------------------------------------------------- |
| 29-navy                    | 29-navy                 |     14 |     2 |          ✓           |                                                     |
| alamo-anatomy              | alamo-anatomy           |      0 |     6 |          —           | slice library points at a missing directory         |
| beachfront-dentistry       | 48bb12d1                |     30 |     9 |          ✓           |                                                     |
| caltex-landing             | caltex-landing          |      4 |     2 |          ✓           |                                                     |
| data-dynamiq               | reddoor-wireframer      |      1 |     2 |          —           | shared wireframe repo: code only, no Prismic switch |
| erp-industrial             | erp-industrial          |      3 |     3 |          ✓           | `slice-machine-ui` ^1.26, `@prismicio/svelte` 1.5.0 |
| espada                     | espada                  |      1 |     2 |          ✓           |                                                     |
| gallerysonder              | gallerysonder           |      6 |    10 |          ✓           |                                                     |
| hedloc                     | hedloc                  |      4 |     4 |          —           |                                                     |
| medical-solutions-of-texas | msot                    |      1 |     2 |          ✓           |                                                     |
| reddoor-website            | reddoor-la              |     15 |    10 |          —           | slice index is already `index.ts`                   |
| revogen                    | revogen                 |      8 |     4 |          ✓           |                                                     |
| roalson-interests          | roalson-interests       |     13 |     5 |          ✓           |                                                     |
| the-pointe-burbank         | the-pointe-burbank      |     26 |     9 |          —           |                                                     |
| the-tower-burbank          | the-tower-burbank       |     26 |     8 |          —           |                                                     |
| vida-legacy-foundation     | vida-legacy             |     17 |     1 |          —           |                                                     |
| vineyard-custom-homes      | vineyard-custom-homes   |      2 |     7 |          ✓           |                                                     |
| williamson-construction-co | williamson-construction |     30 |     3 |          ✓           |                                                     |
| williamson-homes           | williamson-homes        |     21 |     3 |          —           | the drift in #1090                                  |
| reddoor-starter            | (placeholder)           |      9 |     2 |          —           | template for `/new-site`                            |
| reddoor-starter-blux       | (placeholder)           |     28 |     8 |          —           | template for `--track blux`                         |

That is **18 Prismic repositories** to switch and **21 code repos** to change.
Eight sites cannot deliver a model change through CI today (the "—" rows,
less the starters).

## 2. What each repo carries that has to change

Counted across the 21 clones:

- `slicemachine.config.json`, read at **runtime** in 10 repos
  (`src/lib/prismicio.*` imports it for the repository name) and at build time
  in 10 (`svelte.config.js`, the CSP's Prismic host).
- `src/routes/slice-simulator/+page.svelte` imports `SliceSimulator` from
  `@slicemachine/adapter-sveltekit/simulator` in **all 20** that have the
  route. The CLI's own SvelteKit template imports it from `@prismicio/svelte`,
  which exports it from 2.2.0 (2026-01-14). Every lockfile already resolves
  2.2.1 or 2.2.2 except erp-industrial (1.5.0).
- `package.json`: `slice-machine-ui`, `@slicemachine/adapter-sveltekit`, a
  `slicemachine` script, and `dev` running it under `concurrently`.
- Generated files: `src/prismicio-types.d.ts` and `src/lib/slices/index.js`.
- Docs: README, `CLAUDE.md`, `docs/STARTER.md`, `docs/NEW-SITE.md` in the
  starter lineage.

**Codegen parity, measured on a copy of williamson-homes** with a
hand-written `prismic.config.json` (`repositoryName`, `libraries`, `routes:
[]`) and the CLI 1.21.0, offline:

- `prismic gen types` produced the same **108** exported type names as Slice
  Machine's file. It differs in formatting (tabs), the header line ("Code
  generated by Prismic") and its **location: project root**, not `src/`.
- `prismic gen slice-index` produced the same 21-entry component map, written
  as `index.ts` beside the existing `index.js`.

So codegen is a drop-in once two paths are settled. `$lib/slices` resolves
either extension. Whether SvelteKit's generated tsconfig includes a root
`prismicio-types.d.ts` is **not yet verified** and is the first thing the
pilot checks.

> Corrected 2026-10-01 17:34Z by the pilot: reddoor-website already carries
> this exception (`CMS_FRAMED_ROUTES` in `src/lib/security/headers.ts`, live on
> reddoorla.com), added 2026-08-19 when its Page Builder previews broke. It is
> the only one of the 21 repos with it, and it is the pattern to port. The
> paragraph below is as written.

**The CSP blocks the Type Builder's live preview.** The Type Builder loads
slice previews from a deployed simulator URL, inside an iframe on
prismic.io. Slice Machine used `localhost:9999`. Every site sends
`frame-ancestors 'self'` (`BASELINE_CSP`, `src/configs/svelte.ts:122`) and
`X-Frame-Options: SAMEORIGIN` (williamson-homes sets it in both
`netlify.toml` and `hooks.server.ts`). The fix is a framing exception for
prismic.io on `/slice-simulator` only, in the shared config and each site's
overrides. That is a security-header change, so it gets the 3-lens review.

**Central repo.** `src/prismic/models/config.ts` and
`src/audits/util/site-config.ts` already read both config names, so nothing
goes dark mid-rollout. To change:

- `src/configs/baseline-versions.ts` pins `slice-machine-ui` and the adapter.
  It ships in `@reddoorla/maintenance`, so the change rides a release PR.
- The `prismic-ci` recipe and the new-site path.
- `fleet-prismic-drift.yml`, if Type Builder edits become sync PRs (decision
  D1).
- Nineteen test files mention Slice Machine; most are fixtures of the config
  name.
- The runbook's §11.

## 3. Decisions only the operator can make

**D1. Who is the source of truth once the Type Builder is on?**

Today the repo is, and the runbook says "Type Builder must stay OFF" for
exactly that reason. Prismic's route makes the browser a writer.

- **(a) Recommended.** Turn the Type Builder on, and keep the repo
  authoritative through a sync loop: a nightly job runs
  `prismic-models --pull` (already built and 🟢) and opens a PR when the
  remote changed. Code-first edits still go PR → merge → push.
- **(b)** Turn it on and leave edits in Prismic, with no sync.
- **(c)** Leave it off and use only the CLI. That is not "everything up to
  date".

**D2. Delivery: keep `prismic-models` + `prismic-ci`, or replace them with
`prismic push`?**

- Recommended: **keep** them for now. They are proven, comment on PRs,
  never delete, and already alarm on drift.
- `prismic push` without `--force` also refuses deletes. But its CI auth
  with a repository write token is unproven. Its `PRISMIC_TOKEN` is the
  CLI's session token.
- Revisit once a pilot proves the token.

**D3. Where generated files live.** Either move `prismicio-types.d.ts` to
the root and the slice index to `index.ts` (Prismic's layout), or
post-process back into `src/`. Recommended: Prismic's layout. Fighting the
generator costs more every release.

## 4. Phases

Each phase is per-repo PRs. A fleet-wide mutation is never a mass push
(`AUTONOMY.md`).

0. **Decisions** D1–D3.
1. **Close the delivery gap now.** This is independent of the migration and
   fixes #1090's drift. Roll `prismic-ci` to the 7 Prismic sites without it:
   alamo-anatomy, hedloc, reddoor-website, the-pointe-burbank,
   the-tower-burbank, vida-legacy-foundation and williamson-homes.
   data-dynamiq is skipped, because its repository is the shared wireframe.
   Each site needs a `PRISMIC_WRITE_TOKEN` secret, which only the operator
   can mint (🔴). It cannot be rolled out from a cloud session, because the
   secrets API is refused there.
2. **Pilot on reddoor-website** (reddoor-la, our own site, no client
   exposure). The change set:
   - drop the two packages;
   - write `prismic.config.json`;
   - point `prismicio.ts` and `svelte.config.js` at it;
   - swap the simulator import;
   - add `prismic gen` scripts and a CI step that fails when generated
     files are stale (`prismic gen types && git diff --exit-code`);
   - add the simulator framing exception.

   Then switch reddoor-la to the Type Builder and set its simulator URL, and
   check four things:
   - the types file is included by tsconfig;
   - a model PR still delivers through `prismic-ci`;
   - a Type Builder edit appears in the nightly sync PR;
   - live previews render in the Type Builder.

   This phase also answers the open unknowns in §6.

3. **Starters and central.** Apply the pilot's diff to reddoor-starter, then
   cherry-pick it to reddoor-starter-blux (never merge, per `CLAUDE.md`).
   Then update the central repo: baseline versions, the recipe, new-site,
   drift-to-sync, the CSP exception in `BASELINE_CSP`, tests and the
   runbook. That produces one release PR, which the operator merges.
4. **Fleet rollout, 18 more site repos.** Same diff, one PR each, serial CI,
   pilot order by risk: building sites first, maintained clients last. Each
   PR carries a regenerated-types diff that must be empty, apart from
   formatting. Two outliers:
   - **erp-industrial** needs `@prismicio/svelte` 1.5 → 2.x, a real
     upgrade with its own review.
   - **alamo-anatomy** first needs its slice library path fixed.
5. **Prismic-side switch**, after each site's PR is merged, never before. In
   each of the 18 Prismic repositories: "Switch to type builder", and set
   the preview and simulator URLs to the deployed site.
6. **Close-out.** Remove `slicemachine.config.json` support from the central
   readers once no repo ships one. Update the runbook. Write the journal
   entry.

## 5. Estimate

**Operator time, about 3½ hours, spread over two weeks in three sittings:**

| What                                                                | Count | Each   | Total   |
| ------------------------------------------------------------------- | ----: | ------ | ------- |
| D1–D3                                                               |     1 | 15 min | 15 min  |
| Mint `PRISMIC_WRITE_TOKEN` and set the secret (phase 1)             |     7 | ~5 min | ~35 min |
| Pilot sign-off: watch one Type Builder edit and one preview         |     1 | 20 min | 20 min  |
| Release PR for the central change                                   |     1 | 5 min  | 5 min   |
| Prismic dashboard: switch to Type Builder and set the simulator URL |    18 | ~3 min | ~55 min |
| Skim the per-repo PRs (agents land them on green plus review)       |   ~25 | ~2 min | ~50 min |
| Answer escalations (erp-industrial, anything the pilot surfaces)    |       |        | ~30 min |

The token rows shrink if some sites already hold a write token. The laptop
command `reddoor-maint prismic-models --fleet turso --tokens` answers that
read-only. The dashboard row can shrink if the CLI's `prismic preview
set-simulator` works under the operator's own login in one batch.

**Agent work, about 5–7 working days, so about two calendar weeks with
review rounds and serial CI:**

| Phase                 | Effort    |
| --------------------- | --------- |
| 1, delivery gap       | ½ day     |
| 2, pilot              | 1–1½ days |
| 3, starters + central | 1½ days   |
| 4, 18 site PRs        | 2–3 days  |
| 6, close-out          | ½ day     |

## 6. Unknowns the pilot must answer before phase 4

> Status 2026-10-01: the tsconfig question is answered. SvelteKit's generated
> `include` does not list a root `.d.ts`, but every consumer imports the types
> file by relative path, so svelte-check sees it (0 errors on
> reddoor-website#235). The rest stay open.

> **Pilot closed 2026-10-04 17:19Z, both directions proven on reddoor-website /
> `reddoor-la`.** Prismic to repo: an operator Type Builder edit was read back
> through the connector, diffed (the only difference in the type) and landed as
> reddoor-website#238. Repo to Prismic: #241's dry run reported "1 model(s)
> would be pushed; 24 already match" and changed nothing in Prismic (read back
> before and after); the merge to `staging` ran no apply; the promotion #242's
> apply job pushed "1/1 model(s) pushed. 24 already matched", and the connector
> then read the new value. The Type Builder preview renders against the
> deployed `/slice-simulator`. Answers to this section's questions:
>
> - **Reversible?** There is no toggle back, but the operator reports the old
>   builder is Slice Machine itself and both remain offered after the switch.
>   So Slice Machine can still push to a switched repository: the nightly drift
>   check is the guard until a site's Slice Machine packages are removed, which
>   its rollout PR does.
> - **Root types file:** answered above.
> - **Write token as `PRISMIC_TOKEN`:** not needed; D2 kept `prismic-models`.
> - **Renovate preset:** still open, checked in phase 3.

- Is "Switch to type builder" reversible? Can Slice Machine still push to a
  repository after the switch? This sets whether phase 5 may run before a
  site's code PR has landed. The plan assumes no on both, and so orders the
  code change first.
- Does SvelteKit's tsconfig include a root `prismicio-types.d.ts`?
- Does a repository's Custom Types write token work as the CLI's
  `PRISMIC_TOKEN`? This only matters if D2 changes later.
- Does the Renovate preset in `reddoorla/.github` group or pin the
  `@slicemachine/*` packages? A stale rule would keep raising them after
  removal.

## 7. Phase 3 brief (written 2026-10-04, after the pilot)

The pilot's diff is the template; reddoor-website#235 and its review fix
`40d5d81` are the reference. Three things the pilot taught that each later PR
must carry:

- **Grep every file type**, `.mjs` and `.cjs` included. #235's first sweep
  missed seven scripts that read `slicemachine.config.json`, and no test
  imports them.
- **A workflow-only PR never gets a `prismic-models` dry run**: the workflow is
  path-filtered to `customtypes/**` and slice `model.json`. Prove a site's
  delivery with a real model change, as #241 did, not by waiting for a comment.
- **`land-prs` squashes**, and a repo whose `main` ruleset allows only merge
  commits (reddoor-website does) refuses it. Those merges are the operator's
  until `land-prs` reads the branch's allowed merge methods.

Order: reddoor-starter, then a cherry-pick to reddoor-starter-blux (never a
merge); then central (`baseline-versions.ts`, the new-site path, the
`BASELINE_CSP` framing exception for `/slice-simulator` ported from
reddoor-website's `src/lib/security/headers.ts`, the drift nightly turned into
the D1 pull-sync PR, the runbook's §11), one release PR for the operator; then
the 18 site PRs, client sites before the Tower and Pointe Burbank proofs of
concept (not client work, operator 2026-10-04), with erp-industrial and
alamo-anatomy as the two outliers named in §4.
