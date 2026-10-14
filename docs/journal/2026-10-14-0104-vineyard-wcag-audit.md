## 2026-10-14 — Vineyard's WCAG 2.1 AA check: 17 findings, two blockers, about 20 hours to fix (P1-49, #1365)

Vineyard asked whether their site is ADA compliant. The ADA names no technical standard for private websites, so the question answered here is how close vineyardconstruction.com is to WCAG 2.1 Level AA, the US working benchmark and the one DOJ wrote into the 2024 Title II rule. The report and the plain-language status are in reddoor-workspace `audits/2026-10-14-vineyard-wcag/`. Nothing on the site, its repo or its Prismic content was changed.

**Coverage.** There are 10 public pages, and `src/routes`, Prismic (1 published `page`, 6 published `project`) and `sitemap.xml` agree on them. The 404 page makes 11. axe-core 4.11 (wcag2a/2aa/21a/21aa, `ignoreLength` on contrast) ran on all 11 at 390 and 1440. Lighthouse accessibility ran on all 10 through `lighthouseAudit`'s deployed path, wrapped in a spawn that copies the `lhr-*.json` out as P1-44 did. A manual pass covered one page per template. All of it ran in this cloud container with no agents live.

**The instrument, proved first.** A local fixture with one `<img>` and no `alt` gave `image-alt` (1 node) at both widths. The same fixture with the alt restored gave nothing. Each run logged `innerWidth`, so 390 really ran at 390. On the live site the Lighthouse wrapper read `/` at 1.00, P1-44's verified result.

**What the automated tools found.** The light blue `#7ba0c4` on white (2.73:1) fails 1.4.3 on every page but home. P1-44 fixed only home, because Lighthouse only looks at home. About 50 project photos (59 axe nodes over `/gallery` and the six project pages) render with no `alt` attribute, because their Prismic alt fields are empty and `PrismicImage` then omits the attribute. That was the same mechanism as P1-44's Instagram tile, on a different page. Lighthouse read `/` 1.00, `/about` 0.85, `/contact` 0.93, `/gallery` 0.90 and every project page 0.84, identical across each page's three runs. `heading-order` fails on all nine non-home pages, a rule the nightly never sees because it audits only `/`.

**What only the manual pass found, and the source confirmed.**

- `LandscapeModal.svelte` blacks out the whole site on a phone in landscape ("Please Switch to Portrait Mode"). That fails 1.3.4 Orientation, and it is the one finding that locks a user out entirely.
- `/about`'s partner slider auto-advances every 5 s with no way to stop it. Its Pause button sits commented out in the component.
- Every Vimeo background loop plays forever with no control, and still plays under `prefers-reduced-motion`.
- The "From Our Clients" carousel triples its slides for looping without hiding the copies, so a screen reader reads each quote three times.

The keyboard pass was mostly good news. The order is logical, the focus ring is visible, and the mobile menu traps focus, closes on Escape and returns focus.

**Beliefs corrected on contact.**

- axe's `color-contrast` "incomplete, 1:1" on the nav links looked like a contrast failure on every page. It is axe failing to see the video behind the header. The screenshot shows white on dark. It is not a finding.
- One run showed Tab landing in an invisible Vimeo iframe at 390. The 1440 runs never did. The iframes have `tabIndex` 0, but Chromium skips a loaded background player's frame and stops on one that has not loaded yet. That makes it timing-dependent, so it went in as a minor with that caveat, not as a keyboard trap.
- The brief said to attach vineyard-custom-homes with read access. Read access is only git: the issues API and the GitHub connector both refuse a repo that is not attached with credentials. So #78 could not be read directly; its contents came from P1-44's journal entry. The findings could not be filed either until the `add_repo` push attach was approved. I asked with AskUserQuestion, the operator approved it, and the 12 findings not already in #78 went in as vineyard-custom-homes#79–#90. Reading #78 itself then corrected two things: it covers 5 of the rows, not 4, and its hover finding is `DefaultButton` and the Instagram icon, not the nav links.

**Honest accounting.** Rows 9–11 (#78's Instagram link names, filename-like alts and hover contrast) were not re-measured. They are carried from P1-44's review, with the source re-read where it could be. The manual pass used Chromium only, with no real screen reader, so the report says "strong indication", not "certification".

**Still the operator's:** whether to fix, and the brand-colour call in row 4 (navy, or `#547899`, which is ΔE_ok 13 from the brand blue).
