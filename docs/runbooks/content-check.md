# content-check: hard-coded visitor-facing content (P1-120)

`reddoor-maint content-check` reads a SvelteKit site's `src/routes` and `src/lib` and reports what a visitor reads or sees that is written in code instead of coming from Prismic: copy, headings, button labels, images and their alt text, video IDs and posters, links, phone numbers, addresses, emails, hours, testimonials, team members, SEO titles and descriptions, and social links. The kinds are the phase-1 census's (workspace `audits/2026-11-21-p1-120-hardcoded-content-census/`).

## What it never reports

The operator's answers (workspace `decisions/2026-11-21-1841-p1-120-census-forks.md`):

- **Fallbacks behind a Prismic field.** `field || "x"`, `field ?? "x"`, a ternary whose test is about the value its other branch shows, an `{:else}` for the field its `{#if}` shows, a prop default, media beside a `field=` prop, an argument to a parameter named `fallback…`/`default…` (`text(d?.title, "Welcome")` where `text(value, fallback)`, across files), a call whose name ends in `Or`/`Fallback`/`WithDefault`, and a constant every read of which is one of those, in its own file or in any file that imports it.
- **Legal pages and `/dev/*` routes**, by route segment (route groups and `[[param]]` segments are skipped), and components named for a legal page.
- **Decorative labels**: fewer than two letters (`01`, `V`, `•`, `3/5`) or a roman numeral.
- **Code SvelteKit's `dev` guards** (`dev && …`, `dev ? … :`, `{#if dev}`): no visitor reaches it, so nothing in it is reported and no read in it counts.
- Class names, styles, ids, `data-*` attributes, comparisons, types, import paths, `+server` endpoints, tests and `.d.ts` files.

## A site's two files

| file                          | what                                                                                                                                                     | who changes it                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `content-check.json`          | `mode` (`"warn"` or `"fail"`), `exempt` (globs), `ignore` (literals, or `/regex/`), `fallbackHelpers` (call names whose literal arguments are fallbacks) | the site's PRs; `"mode": "fail"` only on the operator's word |
| `content-check.baseline.json` | the literals in code when the check arrived, counted per file, kind and text                                                                             | `--write-baseline`, when phase 3 moves literals into Prismic |

Only a literal beyond its baseline count is reported. Lines are not in the key, so moving code inside a file reports nothing; renaming a file reports its literals as new until `--write-baseline` re-records them. When the code holds fewer than the baseline, the run says how many entries are stale.

## Commands

```sh
reddoor-maint content-check                   # report NEW literals (CI runs this)
reddoor-maint content-check --all             # every literal, baseline ignored: phase 3's worklist
reddoor-maint content-check --write-baseline  # re-record the baseline
reddoor-maint content-check --init            # write the workflow, content-check.json and the baseline
```

Exit codes: 0 in warn mode whatever it finds; 1 in fail mode when there is a new literal; 2 when `content-check.json` or the baseline cannot be read as written. A file that does not parse is named in a `note:` line and skipped, never a failure.

## Wiring a site

From the site's checkout, with the release that should run in its CI:

```sh
npx --yes --package=@reddoorla/maintenance@<version> -- reddoor-maint content-check --init
```

That writes `.github/workflows/content-check.yml`, which runs the check from that pinned version with `npx` (not the site's installed copy, which can be many minors behind), plus `content-check.json` in warn mode and the baseline. Re-running it from a newer release re-pins the workflow and keeps the site's settings. One PR per site, to its base branch (`AUTONOMY.md` "Fleet-wide mutations").
