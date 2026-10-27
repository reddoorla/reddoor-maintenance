## 2026-10-12 — Hedloc easy-wins pass: Executive Team goes to Lighthouse a11y/SEO 100, the 404 shows its header, and the list of what is left (hedloc#56, #57, #58, `25d6fa3`, `9c6e972`, `e3aa5db`)

The operator asked for "another pass at the site, any easy improvements". The pass measured production first, shipped the fixes that were small, local, needed no design call and needed no client content, and left the rest as the list at the end of this entry.

**Instruments, proved before use.**

- Lighthouse 12.6.1, the CLI bundled in this repo's `node_modules`: `example.com` scored 100/100/100 on all three mobile runs.
- axe with every WCAG 2.2 AA and best-practice tag, run through Playwright: a `data:` page with `<img src=x.png>` was flagged `image-alt` at 1440 and at 390.
- The screenshot pixel diff: injecting `.h4{letter-spacing:2px}` produced a bbox around one name, so a pixel-identical result means something.
- The hedloc smoke suite: 25/25 on `main` before any edit.

`pnpm exec reddoor-maint audit` does not resolve from the main checkout until `pnpm build` has made `dist/`. The fleet CLI also runs Lighthouse once and on mobile only, so the three-run, two-preset medians came from the bundled Lighthouse CLI directly.

**Production before, 2026-10-12 ~14:30Z.** Medians of 3 runs, P/A/BP/SEO:

| route             | mobile         | desktop        |
| ----------------- | -------------- | -------------- |
| `/`               | 94/100/100/100 | 96/100/100/100 |
| `/executive-team` | 90/90/100/92   | 97/90/100/92   |
| `/contact`        | 93/100/96/100  | 96/100/96/100  |

Mobile FCP was 2.4–2.6 s everywhere. The best-practices 96 on `/contact` is `errors-in-console`: Cloudflare Turnstile's `600010` in headless Chrome. That code reads as a bot verdict, so it is probably the instrument and not the site. It is unverified and has no fix here.

axe found the defects below; `/` and `/contact` were clean.

- `/executive-team`:
  - a hero `<img>` with **no alt attribute at all**, because the About hero image has an empty alt in Prismic and `ScreenWidthImage` never set a fallback;
  - `heading-order`: the member names were `h4` directly under the `h2`;
  - `page-has-heading-one`.
- The 404 page had three landmark violations, because `+error.svelte`'s `<main>` sat inside the layout's `<main>`. It was also titled "404 — Reddoor".

**Shipped.** Each PR had a red test first, CI green, and one three-lens review round. All were landed with `land-prs.mjs`.

- **hedloc#56:**
  - `fallbackAlt=""` on the hero.
  - Names became `h3.h4` and titles `p.h5`. A mutation showed why the titles had to stop being headings: an `h5` after the new `h3` is still flagged.
  - The error page uses a `div` and is titled "Hedloc | 404".
  - The pixel diff of `/executive-team` and `/contact` at 1440, 1024 and 390, plus the open-bio state, was identical.

  The review then found what axe could not: on every 404 and 500, the layout's absolute white header sat over the error page's white panel, so the logo and both nav links were invisible. axe reports overlapping colour as "incomplete", not as a violation, so a clean axe run said nothing about it. Confirmed by screenshot of production and fixed in the same PR with a 6rem top margin; the test asserts the geometry, panel top ≥ header bottom.

- **hedloc#57:** `autocomplete` tokens on name, email and phone. The review read the ingest screen in `@reddoorla/maintenance` 0.97.0 and found that autofill cannot defeat it. Chrome skips the `display:none` honeypot, and the 800 ms fill-time floor still applies because the required message is typed by hand.
- **hedloc#58:** preconnects for `use.typekit.net` (with `crossorigin`, for the fonts) and `p.typekit.net` (for the `@import`ed CSS).

**After.** Production, 15:00Z: `/executive-team` scores A 100 and SEO 100 on both presets. axe is clean at 1440, 768 and 390 on all four routes, except `page-has-heading-one`, which was left on purpose.

**Honest accounting on the preconnect.** Lighthouse estimated 280–310 ms. Two interleaved preview-against-preview A/Bs of 5 mobile runs each, #57 without the preconnect against #58 with it, measured −135 ms FCP on `/` (2947 → 2812 ms). On `/executive-team` the effect was flat, because LCP there is the hero image. A production-only before/after taken an hour apart showed desktop FCP _worse_ (835 → 1093 ms on `/`). An interleaved same-minute run then put production ahead of the no-preconnect preview (1035 against 1316 ms), so that hour-apart comparison measured network drift, not the change. Time-separated Lighthouse runs on this site move by ±300 ms; only interleaved runs are evidence. The larger font cost is `font-display: auto` in the Adobe kit, which no code change reaches.

**Not done, deliberately.**

- Hedloc's own `docs/workJournal.md` was not touched, because the operator's open hedloc#53 edits it. The entry went to `docs/autonomy-journal.md` instead (hedloc#59).
- Nothing was submitted through the contact form, test mode included.
- `netlify.toml`'s comment says CSP is "emitted per-response by SvelteKit (see `kit.csp`)". No `csp` is configured anywhere, so the comment is stale. If the fleet `BASELINE_CSP` is ever switched on, its `font-src 'self' data:` will block Typekit.

### What is left, for the operator

Content. Prismic is not writable from here (the MCP is not activated for `hedloc`), so these are field and value pairs. They were read from the published master ref of the public CDN API at 15:10Z:

1. **About** (drives `/executive-team`):
   - `meta_title` reads "Hedloc Investing About". Suggest "Executive Team | Hedloc Investment Co".
   - `hero_image` alt is empty. It now renders as decorative, which is correct if it stays empty.
2. **Contact**: `meta_title`, `meta_description` and `meta_image` are all empty, so the page borrows all three from About, including "Hedloc Investing About". Suggest "Contact | Hedloc Investment Co".
3. **Home and About**, the two singles Contact borrows from:
   - `meta_image` is `Z3womJbqstJ98y40_logoFull.svg`. Facebook, LinkedIn, X and iMessage do not render SVG share images, so links share with no picture. Upload a 1200×630 PNG or JPG.
   - `meta_description` is the same sentence on all three pages.
4. **Home** (the `home` single): `meta_title` reads "HEDLOC Investing Home", and the browser title is just "Hedloc".

Design or copy calls:

5. **`/executive-team` has no `h1`**, the one remaining axe rule. Options:
   - make `team_header` the `h1`, a visible size change unless it is restyled as the `h2`;
   - add a visually hidden "Executive Team" `h1`, with no visual change;
   - leave it.
6. **Autofilled contact fields will show Chrome's pale fill on the dark form.** This was already true through Chrome's heuristics; #57 makes autofill likelier. A `:-webkit-autofill` rule, or `color-scheme: dark` on the form, would keep the design.
7. **Typekit `font-display`**: the kit serves `font-display: auto`. Setting it to `swap` in the Adobe Fonts kit settings removes invisible text during load. That is a dashboard change, not code, and a visible FOUT trade-off.

Needs the launch domain (DNS is the operator's):

8. **No `<link rel="canonical">`, no `og:url`, and no `sitemap.xml`** (it returns 404), and `robots.txt` names no sitemap. All of them need the final domain, which hedloc does not have yet.

Small and not worth a PR on its own:

9. Lighthouse puts the home page's responsive-image savings at 42 KiB on mobile and 116 KiB on desktop, from `sizes` hints wider than the slots. They are worth folding into the next change that touches those slices.

Hedloc's `CLAUDE.md` says to use `pnpm test:smoke`, which runs `playwright install chromium`. In the cloud image the pinned Playwright wants `chromium_headless_shell-1243`, and only `chromium-1234` is present. The suite runs with a local, uncommitted config that sets `launchOptions.executablePath` to `$CHROME_PATH`.
