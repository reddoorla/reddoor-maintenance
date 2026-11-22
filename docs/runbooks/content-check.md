# content-check: hard-coded visitor-facing content (P1-120)

`reddoor-maint content-check` reads a SvelteKit site's `src/routes` and `src/lib` and reports what a visitor reads or sees that is written in code instead of coming from Prismic: copy, headings, button labels, images and their alt text, video IDs and posters, links, phone numbers, addresses, emails, hours, testimonials, team members, SEO titles and descriptions, and social links. The kinds are the phase-1 census's (workspace `audits/2026-11-21-p1-120-hardcoded-content-census/`).

## What it never reports

The operator's answers (workspace `decisions/2026-11-21-1841-p1-120-census-forks.md`):

- **Fallbacks behind a Prismic field.** `field || "x"`, `field ?? "x"`; a ternary or `{#if}` branch shown only when a value is empty, whose other branch shows that value (the next section); `if (!x) x = "x"` and `x ||= "x"`; a component's prop default (`$props()` or a Svelte 4 `export let`, never `export const`) when every file that renders the component passes that prop; media, links and `fallback…` props beside a `field=` prop (not `alt`: `<Img field alt="…">` may override the field; `fallbackAlt` is the fallback); an argument to a parameter named `fallback…`/`default…` (`text(d?.title, "Welcome")` where `text(value, fallback)`, across files); a call whose name ends in `Or`/`Fallback`/`WithDefault`; and a constant every read of which is one of those, in its own file or in any file that imports it.
- **Legal pages and `/dev/*` routes**, by the route's first segment (route groups and `[[param]]` segments are skipped: `/privacy`, `/legal/terms`, not `/services/accessibility`), and components named for a legal page without ambiguity (`PrivacyPolicy`, `TermsOfService`; not `Disclaimer`).
- **Decorative labels**: fewer than two letters (`01`, `V`, `•`, `3/5`) or a roman numeral from II to XXXIX (`ID`, `MIX`, `MD`, `LLC` are words, and are reported).
- **Code SvelteKit's `dev` guards** (`dev && …`, `dev ? … :`, `{#if dev}`): no visitor reaches it, so nothing in it is reported and no read in it counts.
- **Fixtures**: `**/fixtures/**` and `*-fixture.ts` / `*.fixture.ts` (and `…fixtures`), the data tests and `/dev` pages feed components.
- Class names, styles (a `style:` value is never copy, though a `url(…)` image in a style is an image), ids, `data-*` attributes, comparisons, the string a method matches against (`href.startsWith("tel:")`), a constant read only in `class` or `style` (unless it is an image), types, import paths, `+server` endpoints, tests and `.d.ts` files.

## When a branch is a fallback

A branch of a ternary or an `{#if}` is a fallback only when all of these hold:

1. **The test asks whether a value is empty**: a value path (`doc.title`), `isFilled.*(…)`, `asText(…)`, `x.length > 0`, `x != null`, `!x`, `x.length === 0`, `T ? x : null`, and `&&`/`||` of those, where **every** side of the `&&` or `||` is one: `slice.variation === "video" && slice.primary.vimeo_id` is a choice. A local stands for what it was computed from only when its initialiser is itself such a test (`const has = $derived(isFilled.keyText(doc.title))`); `const isMobile = $derived(w < 768)` stands for itself. A comparison with a literal (`theme === "dark"`, `status === 404`) is a choice, never an emptiness test.
2. **The other branch shows that value**: in its text, a component's props, or the HTML attributes a visitor reads (`alt`, `title`, `aria-label`, `placeholder`, `src`, `href`, `content`, `value`, `label`, `poster`). Never an event handler, `bind:`, `class`, `style` or `aria-expanded`: a menu toggle's other branch is not a fallback. Each side of an `&&` test must be about a value the branch shows: `{#if video && playing}` waits on `playing` too, so its `{:else}` is a choice.
3. **An `{#if}` branch is a leaf substitute** (the ternary's value is one by its nature): one run of text, or one element holding one (a heading, a paragraph, an image, a `<picture>` or `<video>` with its sources), perhaps inside plain wrappers. A link, a button, a form, a `<nav>`, a list, a nested `{#if}` or `{#each}`, a component or a second element makes it an alternate template, and its words are reported: the starter `Nav`'s `{:else}` is the whole site-config menu. An `{:else if}` arm is its own block, judged by its own test.

## Known limits

- **An empty-state message reads as a fallback.** `{#if rows.length === 0}<p>Nothing to show yet</p>{:else}{#each rows …}{/if}` is shown only while `rows` is empty, which is the shape of a fallback, and the check cannot tell whether `rows` is a Prismic field or computed data. reddoor-website's report pages carry several of these (`SiteHealth.svelte:40`, `ScoreBars.svelte:79`).
- **A component nothing renders reports its prop defaults**, as dead code reports its text: with no call site, the default is all there is. A component also read by name anywhere but as a tag (`<svelte:component this={Hero} />`, `const C = Hero`) counts as rendered once with no props.
- **A link or a button standing in for an empty list is reported.** `{#if links.length}…{:else}<a href="/contact">Contact us</a>{/if}` is a fallback in intent, but the leaf rule cannot tell it from a whole alternate menu, so it goes in the baseline.
- **A returned literal is named by its function** (`get title() { return "…" }`, `function heading() { return "…" }`, `const subtitle = () => "…"`), and reported when that name is content-shaped. One returned from an unnamed callback, or from a function named for something else (`format()`), is not.
- A `{@render card("…")}` argument is reported when it holds a space and the snippet, if it is in the same file, shows that parameter rather than only styling with it.
- Words built in script and shown through a call are followed only into the template, and only when they hold a space: `{upper("Welcome home")}` is reported, `const t = upper("Welcome home")` is not, and neither is `toLocaleDateString("en-US")`.
- A local constant with no content-shaped name is reported only when the template shows it directly (`const greeting = "…"; <h1>{greeting}</h1>`), in the same file.
- A barrel's re-exports (`export { SITE } from "./site"`, `export * from "./site"`) are followed one hop, not two.
- A prop passed through a spread (`<CtaBand {...props} />`) counts as passed.

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

Exit codes: 0 in warn mode whatever it finds; 1 in fail mode when there is a new literal; 2 when `content-check.json` or the baseline cannot be read as written, including a baseline count that is not a whole number above 0 (`--write-baseline` never writes one; an entry whose literals are gone is dropped, not set to 0). A leading byte-order mark in either file is read past. A file that does not parse is named in a `note:` line and skipped, never a failure; while it stays unparsed, any literal added to it goes unreported, so a `note:` line is worth fixing.

## Wiring a site

From the site's checkout, with the release that should run in its CI:

```sh
npx --yes --package=@reddoorla/maintenance@<version> -- reddoor-maint content-check --init
```

That writes `.github/workflows/content-check.yml`, which runs the check from that pinned version with `npx` (not the site's installed copy, which can be many minors behind), plus `content-check.json` in warn mode and the baseline. Re-running it from a newer release re-pins the workflow and keeps the site's settings and its baseline (add `--write-baseline` to re-record that too). It refuses to pin a release older than the first one with the command. One PR per site, to its base branch (`AUTONOMY.md` "Fleet-wide mutations").
