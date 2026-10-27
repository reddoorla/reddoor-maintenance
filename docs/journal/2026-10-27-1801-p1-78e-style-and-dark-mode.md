# 2026-10-27 — P1-78e: the Reddoor style guide across the cockpit, with dark mode

Landed in reddoorla/reddoor-maintenance#1827. The brief is the workspace's `briefs/2026-10-26-p1-78e-style-and-dark-mode.md`, and the plan is `plans/2026-10-26-cockpit-for-the-team/plan.md`, PR 5 of 8.

**Why.** The cockpit had a page-by-page palette:

- 320 raw hex values in 10 files;
- 34 `prefers-color-scheme` blocks, which a stored choice cannot override;
- green, amber and blue status colours;
- emoji as icons;
- the system font.

The guide has one red, used for "bad", and no status palette. Its brand faces are Pragmatica and Besley, its corners are square, and it uses no emoji. Red now means one thing in the cockpit: Broken.

**What changed.**

- **One token sheet,** `cockpit/src/lib/tokens.css`:
  - It holds the guide's colours, the two families, spacing and the 4px control radius.
  - The light ground is the guide's paper (`#f6f6f6`), so every contrast ratio is measured against paper, not white.
  - The dark theme is derived (the guide has none). Every pair is in the token comments and the PR body.
- **Theme.**
  - It follows the system by default.
  - The shell's toggle cycles system, light and dark, and stores the choice in `localStorage` under `cockpit-theme`.
  - An inline script in `app.html` applies the stored choice before any stylesheet, so nothing flashes.
  - The one media block left is in the token sheet, guarded by `:root:not([data-theme="light"])`, so a stored "light" beats a dark system.
- **The seven page sheets** name tokens only, and their 34 media blocks are gone.
- **State without colour.**
  - Red marks Broken only: the Broken pill, dot, chip and verdict.
  - Attention, Watch and the rest are ink, told apart by word, weight and outline.
  - A chip's red comes from its ladder level, not its severity.
- **Glyphs.** Emoji and glyph icons became words or a plain arrow. The home verdict's Broken class is `broken` (it was `warn`).
- **Fonts.** Pragmatica comes from the Adobe kit `noj4tji`, and Besley from Google Fonts. Both load without blocking first paint.

**Proved.**

- **Font on the cockpit's host.** Chromium served a probe page on `deploy-preview-1827--reddoor-maintenance.netlify.app` and on the production host, with the real origin and referer, and Pragmatica 300 loaded. A negative-control host loaded too, so the kit has no domain allow-list. The brief's stop condition did not apply.
- **Contrast, in a browser.** Every page and fixture case was rendered in the real shell, at four theme modes, 390 to 1280px, with a short and a 65-character email. The scan blended each text colour over its real background. Nothing visible is under 4.5:1. The lowest placeholder is 4.65:1 on paper.

**Five review rounds, three lenses each: correctness, tests and evidence, and what you see.**

- **Round 1:**
  - A stuck vulnerability, Attention on the ladder, drew a red chip in black on red at 4.05:1, because red came from severity.
  - The Broken verdict's meta line sat at 0.85 opacity (4.04:1).
  - Controls and links on the red band were grey or red on red.
  - The refusal test was vacuous: a `Storage.prototype` stub never fired under happy-dom.
- **Round 2:**
  - A control inherited the red band's white onto its white surface, so the "Reload" button was invisible.
  - A failing report check rendered red beside "advisory — never blocks".
  - The floated account block squeezed the nav into a column at 390px.
  - Nothing rendered a red Broken chip, because no fixture held a Broken item.
- **Round 3:**
  - The float still overlapped a long email at 700px; the header is now a wrap-reverse flex row.
  - Placeholders were 4.26:1 on paper.
  - The gate missed red arriving by alias, by `:not(.broken)`, or by `content:`.
- **Round 4:** only gate gaps (red on red and ink on ink passed). Every fill now sets its tested text partner, and the token set is closed. The toggle's own rule, dropped in round 3, is back; it measures 27.6px, not the 26px the round-4 commit message gave.
- **Round 5:** the correctness and operator lenses were clean; the tests lens's verdict is in the PR body.

The sidecar grew from the brief's 7 mutants to 72, every one red.

**Beliefs corrected on contact.**

- **"Red marks Broken only" is a rule about severity.** It is a rule about the ladder level. A critical vulnerability is Attention, and a failed deploy is Broken at warning severity.
- **"Text on a token fill is safe once both tokens pass."** A descendant rule's ink, or an inherited white, beats the pair. Every fill needs its partner set on the same rule.
- **"A grep for the red token finds every red."** Not when red arrives by alias, by a local custom property, through `:not(.broken)` or through `content:`. The gate now reads the token values and closes the set.
- **"Curl can test a font kit's domain list."** Curl got 200 from every referer, including the negative control. The browser probe on the real origin is the instrument.
- **"`?inline` CSS renders in an SSR test."** Under vitest it imports as an empty string. Every screenshot harness has to inject the sheets itself; one review round measured unstyled pages before this was found.

**Filed:**

- #1828: the site Reports table at 390px.
- #1829: the sign-in page is not on the tokens.
- #1831: Attention and Watch chips share a look.
- #1832: the /audits Goal select at 14.4px.
