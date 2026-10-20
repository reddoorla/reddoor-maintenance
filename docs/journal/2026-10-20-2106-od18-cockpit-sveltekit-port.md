# 2026-10-20 — OD 18 step 1a: the cockpit as a SvelteKit app, not yet served

**Where it landed:** this PR (reddoorla/reddoor-maintenance, branch `claude/od18-cockpit-sveltekit`), reopening #582 for the #672 rework. The operator's answers: the workspace's `reviews/2026-10-20-cockpit-brief-markup/markup.md`, `decisions/2026-10-20-1916-od18-cockpit-port-build-step.md` and `decisions/2026-10-20-1941-od18-cockpit-netlify-site.md`.

The operator chose a component port over module files plus DOM tests (Q5). The brief's first stop condition fired before any code was written. A spike with Netlify's own bundler (`@netlify/zip-it-and-ship-it`, Svelte 5.57.2) showed that a function importing a `.svelte` file fails with `No loader is configured for ".svelte" files`. A plain `.ts` control bundled, and the same component precompiled with `svelte/compiler` bundled and ran. A port therefore needs a compile step in the deploy, and PRs here get no Netlify deploy preview. He was offered a build step in the existing site's `netlify.toml` (my pick), TSX components with no build, or SvelteKit as its own site, and chose **SvelteKit as its own site**. Asked who creates the site, he answered that the session should, with its token.

So step 1 split in two:

- **1a, this PR.** The app at `cockpit/`, which nothing serves yet.
- **1b, the cutover.** The old site proxies its pages to the new one, and the string renderers go.

Merging 1a changes nothing a visitor sees.

**What is in it.**

- **One shell** (`cockpit/src/lib/Shell.svelte`): the nav Home · Sites · Inbox · Audits, the four style rules all five pages shared, and the signed-in fragment. Each page keeps its own stylesheet verbatim, including its old body width (720 to 1100px). `data-sveltekit-reload` on `<body>` keeps every link a full page load, as before: the pages share class names like `.filters` with different rules, and client-side navigation would carry one page's stylesheet onto the next.
- **The auth hook** calls the same `requireOperator` as the functions. It now also refuses a cross-site POST with 403 before auth, which matches the old order; a fork had first put that check after auth.
- **Shared data loading.** `src/dashboard/page-data.ts` holds each page function's data loading, moved verbatim, and the five functions now call it. The functions and the app read the same data through the same code, so there is no copy to drift until the cutover deletes the functions.
- **No markup decides anything it did not decide before.** The pure view builders call the old helpers on the server, so the browser bundle holds no server code. That was checked on the built bundle: the one grep hit for "resend" is the label "Resend ID".

**Instruments, and their proof.**

- **The parity harness** (`cockpit/tests/_helpers/parity.ts`) renders the old renderer and the new page from the same input and compares canonical lines: tag, sorted decoded attributes, decoded text with whitespace runs collapsed. Layout-insignificant whitespace is dropped (beside a block element, inside table and list structure); whitespace between inline elements is still compared. Each page's parity test also checks that a one-character change is seen.
  - The harness began too loose in one place and too strict in another. Svelte's `<!--[-->` markers split one whitespace run into several text nodes, so the middle ones escaped the block rule. Three forks each worked around this in their own markup until the harness merged adjacent runs; after that change all 94 parity tests still pass.
  - Parity caught two real defects the forks introduced, both from Svelte trimming whitespace at the edge of an `{#if}`: "Caltex —summary" in the Recently lane, and "~48m· view run" / "timed outrun" in the fleet-refresh rows (the latter caught by a DOM test).
- **DOM tests** mount each page in happy-dom, click, and assert the exact `fetch` (URL, method, headers, body) and the resulting DOM: approve, unapprove, override, withdraw, rerender, Trigger Renovate, the site-details editor, commentary, submission status, the bulk mark-read confirm, the audit run form, and the fleet audit with its polling and its resume-on-reload from localStorage. Mounted data goes through a JSON round trip first, which is stricter than SvelteKit's `devalue`.
- **Hand mutations.** Every behaviour test was turned red by a hand mutation: 17 on `/`, 18 on `/s/:slug`, 12 of 13 on `/submissions` and `/audits`. The one survivor was equivalent: trimming a `type=url` value the browser already trims.
- **The brief's three step-1 mutations** all went red:
  - approve posts to the wrong report id;
  - the submission-status click updates the DOM without `fetch` (10 tests across two pages);
  - a page renders without the shell's nav (7 shell tests red with the nav removed, 10 with the layout skipping the shell).

**How it was built.** I wrote the shell, hook, loaders, harness and the `/fleet` port. Three forks ported `/`, `/s/:slug`, and `/submissions` plus `/audits` in parallel, in one worktree, each in its own directories. Two of them each wrote a submission-row component; the one that decides every string on the server was kept, and `/submissions` now uses it. The kept component was re-proved under the `/submissions` tests before the other was deleted.

**What remains, deliberately.**

- **The old renderers and their inline scripts are still live** until 1b, which deletes them with the five HTML page functions. The confirm texts and two submission rules the app needs moved first to `report-confirm.ts` and `submission-rules.ts`, so the cutover deletes no module the app imports.
- **Two intentional differences from the old pages:**
  - The bulk mark-read form's inline `onsubmit="return confirm(…)"` is a Svelte handler with the same text.
  - The audit panel's Reload button's inline `onclick` is a handler.
- **SvelteKit's form-origin check** will refuse the proxied `/submissions` POST until 1b adds the dashboard origin to `csrf.trustedOrigins`.
