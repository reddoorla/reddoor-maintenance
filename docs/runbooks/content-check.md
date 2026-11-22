# content-check: hard-coded visitor-facing content (P1-120)

`reddoor-maint content-check` reads a SvelteKit site's `src/routes` and `src/lib` and reports what a visitor reads or sees that is written in code instead of coming from Prismic: copy, headings, button labels, images and their alt text, video IDs and posters, links, phone numbers, addresses, emails, hours, testimonials, team members, SEO titles and descriptions, and social links. The kinds are the phase-1 census's (workspace `audits/2026-11-21-p1-120-hardcoded-content-census/`).

## What it never reports

The operator's answers (workspace `decisions/2026-11-21-1841-p1-120-census-forks.md`):

- **Fallbacks behind a Prismic field.** `field || "x"`, `field ?? "x"`, a ternary whose test is about the value its other branch shows, an `{:else}` for the field its `{#if}` shows (or the `{#if !field}` branch whose `{:else}` shows it), `if (!x) x = "x"` and `x ||= "x"`, a prop default (`$props()` defaults, and `export let` in a component's instance script; never `export const`), media, links and `fallback…` props beside a `field=` prop (not `alt`: `<Img field alt="…">` may override the field; `fallbackAlt` is the fallback), an argument to a parameter named `fallback…`/`default…` (`text(d?.title, "Welcome")` where `text(value, fallback)`, across files), a call whose name ends in `Or`/`Fallback`/`WithDefault`, and a constant every read of which is one of those, in its own file or in any file that imports it.
- **Legal pages and `/dev/*` routes**, by route segment (route groups and `[[param]]` segments are skipped), and components named for a legal page.
- **Decorative labels**: fewer than two letters (`01`, `V`, `•`, `3/5`) or a roman numeral from II to XXXIX (`ID`, `MIX`, `MD`, `LLC` are words, and are reported).
- **Code SvelteKit's `dev` guards** (`dev && …`, `dev ? … :`, `{#if dev}`): no visitor reaches it, so nothing in it is reported and no read in it counts.
- Class names, styles, ids, `data-*` attributes, comparisons, types, import paths, `+server` endpoints, tests and `.d.ts` files.

## What makes two values "the same field"

A test and a branch are about the same field when they read the same value path (`doc.title` and `doc.title.text`, not `page.status` and `page.error`). A local is followed to what it was computed from only where it is read whole (`{#if title}`, with `const title = $derived(doc.title)`), never through a member (`page.layout` and `page.title` stay two fields of `page`), and only through the values it reads: never the function it calls (every `$state(…)` would share `$state`) and never a function's body (a submit handler is not the field it sets).

## Known limits

- Words built in script and shown through a call are followed only into the template, and only when they hold a space: `{upper("Welcome home")}` is reported, `const t = upper("Welcome home")` is not, and neither is `toLocaleDateString("en-US")`.
- A local constant with no content-shaped name is reported only when the template shows it directly (`const greeting = "…"; <h1>{greeting}</h1>`), in the same file.
- A barrel's re-exports (`export { SITE } from "./site"`, `export * from "./site"`) are followed one hop, not two.

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

An `ignore` entry wrapped in slashes is always a regex: `"/about/"` hides every literal containing "about", "Learn about us" included; write `"about"` for the exact string. Only the flags `i`, `m`, `s` and `u` apply; `g` and `y` are dropped, and anything else, or a pattern that does not compile, is exit 2.

Exit codes: 0 in warn mode whatever it finds; 1 in fail mode when there is a new literal; 2 when `content-check.json` or the baseline cannot be read as written. A file that does not parse is named in a `note:` line and skipped, never a failure; while it stays unparsed, any literal added to it goes unreported, so a `note:` line is worth fixing.

## Wiring a site

From the site's checkout, with the release that should run in its CI:

```sh
npx --yes --package=@reddoorla/maintenance@<version> -- reddoor-maint content-check --init
```

That writes `.github/workflows/content-check.yml`, which runs the check from that pinned version with `npx` (not the site's installed copy, which can be many minors behind), plus `content-check.json` in warn mode and the baseline. Re-running it from a newer release re-pins the workflow and keeps the site's settings and its baseline (add `--write-baseline` to re-record that too). It refuses to pin a release older than the first one with the command. One PR per site, to its base branch (`AUTONOMY.md` "Fleet-wide mutations").
