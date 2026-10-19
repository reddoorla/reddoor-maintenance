## 2026-10-14 — P1-47 roll-out: the kit 3 preview exit is on four sites' `staging`, and the promotions wait for the operator (vida#109, mantis#52, alamo#79, gallerysonder#125)

The brief named five kit 3 sites with the broken preview exit. Only four have one. **la-homelessness-youth has no Prismic at all**: no `@prismicio/*` in its `package.json`, its lockfile or `src`, and no `PrismicPreview`. The P1-47 Done entry had listed it from the kit 3 roster, not from a read of its layout.

In the other four, the starter's copy (reddoorla/reddoor-starter#188) went in as written. Each test needed adapting, and the adaptations are worth keeping because they are what a sixth site would need.

- **Vida's** layout pulls in `TurnstileWidget`, so the test mocks `$app/env/public` and `onNavigate`. Its data type also requires `publishedPages`.
- **Mantis's** `scripts/capability-index.test.ts` fails on any new component missing from `docs/COMPONENTS.md`, so the index was regenerated.
- **Alamo's** vitest config had no `resolve.conditions: ["browser"]`. Without it, the layout rendered through Svelte's server build and every test stopped on `lifecycle_function_unavailable`.
- **Gallerysonder** had no vitest at all. It gained vitest, jsdom and `@testing-library/svelte`, and `pnpm test` now ends in `vitest run`. It also mounts `PrismicPreview` from a cookie read in `onMount`, not from `data.isPreviewSession`, so its test sets the cookie and awaits a `tick()`. jsdom has no `Element.animate`, which the layout's `fade` calls, so that is stubbed.

The same three mutations went red in all four:

- upstream's `{ invalidateAll, noScroll }` options;
- `noScroll` added beside `reset: false`;
- the layout's import pointed back at `@prismicio/svelte/kit`.

A fourth, on gallerysonder only (mount whatever the cookie), turned its negative case red. One review round found only minors, filed as vida#110, mantis#53–54, alamo#80 and gallerysonder#126–127. Each staging PR was squash-merged on green CI with `land-prs.mjs`, since staging's ruleset needs no approval. The promotion PRs vida#111, mantis#55, alamo#81 and gallerysonder#128 are open, clean, and green on `main-gate`. Their bodies ask for a merge commit.

The browser check could be run live, which the brief had doubted. A hand-set `io.prismic.preview` cookie mounts the toolbar, and dispatching `prismicPreviewEnd` is what the toolbar's close button does, so nothing touches Prismic. On the three server-gated sites, the cookie alone mounts nothing on a prerendered page. It does on the `/preview/…` route, which is where `redirectToPreviewURL` sends real editors.

Measured with the page scrolled to 600, then the event:

- gallerysonder production: 600 → **0**, and its bundle carries `{invalidateAll:!0,noScroll:!0}`. Staging: 600 → **600**, and it still navigated (`history.length` 2 → 3).
- mantis `main--`: 600 → **0**. `staging--`: 600 → **600**.
- vida: inconclusive. Its sticky covers and smooth-scroll restore move the page on both deploys alike (`/preview` → `/` lands at y 1024 on `main` and `staging`).

**The belief corrected on contact: on alamo the component fix is necessary but not sufficient.** Its staging bundle carries `{refreshAll:!0,reset:!1}`, yet staging still lands at 0. Ending a preview always changes the pathname (`/preview/x` → `/x`), and alamo's root `afterNavigate` calls `scrollTo(0, 0)` on every pathname change. The starter's reproduction could not show this, because it ended a preview on an unprefixed path. The cause and a two-line patch are in alamo#82. Operator decisions 125 put the fork to the operator, who answered to fix the hook first.

alamo#83 now treats a `from` pathname with a leading `/preview` removed as the same page as `to`. Five mutations each turned a test red:

- the old check;
- an unanchored `replace("preview", "")`;
- no `/` fallback for a bare `/preview`;
- the `scrollTo` removed;
- the prefix stripped on both sides.

A sixth, removing the regex's `(?=\/|$)` lookahead, turned nothing red. It is equivalent: without the lookahead, `/previewer/x` becomes `er/x`, which can never equal a pathname. So the lookahead was dropped rather than kept as an untested assertion.

After the deploy (21:05Z), alamo's staging stays at 600 for `/preview` → `/` and for `/preview/about` → `/about`, and a plain `/about` → `/contact` click still lands at 0. The review minors are alamo#84–#86. #87 records an unverified read that a `/contact` submission during a preview may end on `/preview/thank-you`, which no route serves.

One process slip: the review agent edited gallerysonder's real `+layout.svelte` after a failed `cd`. It reverted the edit itself, and the four clones were confirmed clean at their pushed heads before anything merged.
