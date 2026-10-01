# How Prismic wants models managed, October 2026 (P1-29, #1090)

Research only. Nothing here was pushed to Prismic or changed in a site. Every
source below was read on **2026-10-01 between 16:41Z and 16:45Z** (`date -u`
in the session). The route to choose is the operator's: Operator decisions 57
in `docs/BACKLOG.md`.

## 1. Is Slice Machine deprecated? Yes, formally, since 2026-09-18

Four independent authorities say the same thing. Each one was read directly,
not through another.

| Source                                                    | What it says                                                                                                                                                                                                                                                                                                                                         | Dated                                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| npm registry, `npm view <pkg> deprecated`                 | `slice-machine-ui` 2.21.6, `@slicemachine/adapter-sveltekit` 0.3.99, `@slicemachine/init` 2.10.57 and `@slicemachine/manager` 0.27.6 all carry: "Slice Machine is replaced by the Prismic CLI and the Type Builder. Existing projects are still supported. To move a project, see https://prismic.io/docs/slice-machine#migrate-to-the-type-builder" | `slice-machine-ui` 2.21.6 published 2026-09-18T04:09Z; registry modified 04:11Z |
| Prismic docs, https://prismic.io/docs/slice-machine       | "A reference for existing Slice Machine projects. Slice Machine is deprecated. New projects use the Type Builder and the Prismic CLI." and "Existing projects still work. New projects must use the Type Builder."                                                                                                                                   | Page footer "Last updated September 2026"                                       |
| GitHub, `prismicio/slice-machine` `README.md` (git clone) | The README opens with the same replacement notice and points at the CLI and Type Builder docs                                                                                                                                                                                                                                                        | HEAD `6c25716`, 2026-09-18T04:00Z, "release: 9 new packages"                    |
| The new CLI's own code, `prismicio/cli` `init.ts`         | `prismic init` on a Slice Machine project deletes `slicemachine.config.json` and removes `slice-machine-ui` and every `@slicemachine/adapter-*` from `package.json`, commented "Slice Machine is replaced by the Type Builder and CLI, so its packages are no longer needed after migrating."                                                        | HEAD `c74832a`, 2026-10-01T02:12Z                                               |

**Negative control.** The same `npm view … deprecated` check prints nothing
for `@prismicio/client` 7.22.1, `@prismicio/svelte` 2.2.2,
`@prismicio/types-internal` 4.7.0 and `prismic` 1.21.0, so the instrument can
say "not deprecated". It also flags a package we might have reached for by
mistake: `@prismicio/cli` 0.0.3 is deprecated in favour of the unscoped
`prismic` package.

**What "deprecated" means here.** Not removed and not broken. Every source
says existing projects are still supported; nothing names a sunset date. It
corrects the runbook's wording (`docs/runbooks/prismic-model-delivery.md` §11,
"declared unmaintained on 2026-07-20 with no sunset date"): the status moved
from "unmaintained" to "deprecated, with a named successor and a migration
command" on 2026-09-18, with 2.21.6 as the release that carried it.

## 2. What Prismic recommends now

Two tools, one in the browser and one in the terminal:

- **Type Builder** (https://prismic.io/docs/type-builder, "Last updated
  October 2026"): "a cloud-based interface for content modeling directly in the
  Prismic web UI … Changes made in the Type Builder are saved directly to your
  Prismic repository." For agents it says: "point them to the Prismic CLI for
  content modeling instead."
- **Prismic CLI**, the npm package `prismic` (https://prismic.io/docs/cli,
  "Last updated October 2026"; 1.0.0 on 2026-03-11, 1.21.0 on 2026-09-30, a
  release roughly every week in `CHANGELOG.md`). Run with `npx prismic`, no
  install. The commands that matter for models, from `prismic --help` on
  1.21.0:
  - `prismic init`: connects or creates a repository, writes
    `prismic.config.json`, migrates a Slice Machine project, pulls models.
  - `prismic pull` / `prismic push`: "Remote models are the source of truth"
    / "Local models are the source of truth". **Both delete to match.** Push
    refuses a remote delete without `--force`; pull deletes local slice
    directories with `rm(slice.directory, { recursive: true })`
    (`src/adapters/index.ts:218`), which takes the slice's `index.svelte` and
    tests with it.
  - `prismic status`: local versus remote diff, read-only.
  - `prismic gen types` / `prismic gen slice-index`: what Slice Machine
    generated on save, now on demand.
  - `prismic type|slice|field …`: model edits from the terminal, meant for
    agents.
- The SvelteKit guide (https://prismic.io/docs/sveltekit, "Last updated July
  2026") already offers only those two: "Set up your project using the Type
  Builder, a tool for building by hand, or the Prismic CLI, a tool for AI
  agents."

So Prismic's **code-first route** is: models live as files in the repo
(`customtypes/<id>/index.json`, `src/lib/slices/<Name>/model.json`, the same
layout we use), edited by hand or with `prismic type|slice|field`, committed,
and sent with `prismic push`. The CLI insists on the commit: push refuses
while model files are dirty in git ("Prismic keeps model history in git.
Commit model changes before you push them.").

### Facts from the CLI source that bear on our gates

Read from `prismicio/cli` at `c74832a` and the published 1.21.0 tarball:

- **Auth.** `prismic login` opens a browser and stores a user session in
  `~/.config/prismic/credentials.json`. `PRISMIC_TOKEN` overrides it (added in
  1.10.0, 2026-06-03, "support PRISMIC_TOKEN env var to override stored
  token"). Push sends that token as `Authorization: Bearer` to
  `https://customtypes.prismic.io/bulk-update`, the same API and header shape
  `prismic-models` uses. **Unverified:** whether a repository's Custom Types
  API write token (what `PRISMIC_WRITE_TOKEN` holds) works as `PRISMIC_TOKEN`.
  Nothing in the docs says so, and push also calls other Prismic APIs. No test
  was run, because this item makes no Prismic call with a write credential.
- **Type Builder gate.** `init --repo` refuses a repository that "uses the
  Legacy Builder" unless its `quotas.sliceMachineEnabled` is true
  (`init.ts:160`). Slice Machine repositories pass it, so the fleet is not
  blocked.
- **Layout differences from ours.** `gen types` writes `prismicio-types.d.ts`
  at the project root (`src/adapters/index.ts:305`); our sites keep it at
  `src/prismicio-types.d.ts`. The slice index is `index.<js|ts>` chosen by
  `getJsFileExtension()`, so a TypeScript site may get `index.ts` where it
  has `index.js` today. Written models go through `canonicalizeSlice`, so the
  first pull or gen may reformat every `model.json`.
- **Config.** `prismic.config.json` replaces `slicemachine.config.json` and
  adds `routes`. `src/prismic/models/config.ts` and
  `src/audits/util/site-config.ts` already read both names, in that order, so
  our tooling does not go dark on a migrated site.

## 3. The options against the three routes we use today

Today's three routes (#1090):

1. **Slice Machine** on the laptop: author and push by hand
   (`pnpm slicemachine`). How williamson-homes's two missing fields finally
   got there.
2. **`prismic-models` + per-site `prismic-ci`**: the PR comment is the review,
   merge to `main` pushes through the Custom Types API, create and update
   only, never delete; a nightly drift sweep. williamson-homes has no
   `.github/workflows/prismic-models.yml` (its workflows are `ci.yml` and
   `renovate.yml`, read at `52812ea`), so nothing delivered its models.
3. **The Prismic MCP connector.** Its tools in this session are
   `list_custom_types`, `get_custom_type`, `list_shared_slices`,
   `get_shared_slice`, `get_field_shapes` and document tools. There is no
   model write. It can read and compare, and that is all.

| Option                                                                                                                                                                                                | Authoring                                                   | Delivery                                  | Fits AUTONOMY.md                                                                                                                                    | Cost                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Status quo, finished.** Keep Slice Machine for authoring; roll `prismic-ci` to every Prismic site, williamson first                                                                              | Slice Machine (deprecated, supported)                       | Route 2                                   | Yes; nothing changes                                                                                                                                | One per-repo PR each. Rides a deprecated tool, and Renovate will keep raising its bumps until Prismic stops publishing                                                                                        |
| **B. Swap the authoring tool, keep our gate.** Replace `slice-machine-ui` + adapter with the `prismic` CLI for `gen types`, `gen slice-index`, `status` and agent model edits; delivery stays route 2 | Hand-edited JSON or `prismic type/slice/field`; no local UI | Route 2. `prismic push` is never run      | Yes. Delete stays impossible in CI, git stays the gate                                                                                              | Starter change plus per-site PRs; the two path differences above; no visual editor for people (only the Type Builder, which is off); `prismic init` cannot be the migration step (it pulls, and pull deletes) |
| **C. Prismic's route in full.** Type Builder on, `prismic push` from CI with `PRISMIC_TOKEN`                                                                                                          | Type Builder in the browser, or the CLI                     | `prismic push` (deletes behind `--force`) | No, as written. The runbook's "Type Builder must stay OFF" holds: it saves straight to the repository with no PR. Push can delete, a 🔴 action here | Retire `prismic-models` and `prismic-ci`; CI auth unproven (above); our drift alarm would fire on every Type Builder edit                                                                                     |
| **D. MCP as a route**                                                                                                                                                                                 | n/a                                                         | none (no write tool)                      | n/a                                                                                                                                                 | Useful only as a read-only second authority for drift checks                                                                                                                                                  |

Every option leaves the williamson-homes gap with the same cause: the site
never received the `prismic-ci` workflow. A, B and the current runbook close it
the same way; C would close it by retiring route 2.

## 4. Pick

**A now, B next.** Roll `prismic-ci` to williamson-homes (and audit which other
Prismic sites lack it) so route 2 delivers every model change, then retire
Slice Machine in the starters by switching codegen to `prismic gen` behind our
own gate, never `prismic init` and never `prismic push`. C waits until
Prismic documents a CI token and a push that cannot delete.
