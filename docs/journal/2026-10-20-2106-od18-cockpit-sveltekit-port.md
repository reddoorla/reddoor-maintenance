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

- **The parity harness** (`cockpit/tests/_helpers/parity.ts`) renders the old renderer and the new page from the same input and compares two things.
  - **Structure:** canonical lines of tag, sorted decoded attributes, and decoded text with whitespace runs collapsed.
  - **Text flow:** the text a reader sees, with HTML whitespace collapsed across inline boundaries and a line break at each block boundary. Textarea and pre-wrap text is compared verbatim, and a no-break space stays distinct.

  Each page's parity test also checks that a one-character change is seen, and `cockpit/tests/harness/` proves the harness on 17 known-good and known-bad pairs.

- **The harness was wrong twice before it was right.**
  - Svelte's `<!--[-->` markers split one whitespace run into several text nodes, and the middle ones escaped the block rule. Three forks each worked around this in their own markup before the harness merged adjacent runs.
  - It trimmed whitespace at the edge of every element, inline ones included, so it could not see review round 1's first major. The submissions heading read "Form submissions (30)— showing 25 of 30": Svelte had dropped the space inside `<span class="muted"> — showing…</span>`. Keeping edge whitespace everywhere was too strict the other way: it failed on `inline-flex` clusters, and on a label's trailing space next to another space, neither of which renders. The text-flow comparison is the fix. It catches the lost space (proved by putting the bug back) and forgives the collapsing ones. The same round found that it collapsed textarea and pre-wrap text and treated `&nbsp;` as a space, both now covered by the self-test.
- **Parity caught two defects the forks introduced**, both from Svelte trimming whitespace at the edge of an `{#if}`: "Caltex —summary" in the Recently lane, and "~48m· view run" / "timed outrun" in the fleet-refresh rows (the latter caught by a DOM test).
- **DOM tests** mount each page in happy-dom, click, and assert the exact `fetch` (URL, method, headers, body) and the resulting DOM: approve, unapprove, override, withdraw, rerender, Trigger Renovate, the site-details editor, commentary, submission status, the bulk mark-read confirm, the audit run form, and the fleet audit with its polling and its resume-on-reload from localStorage. Mounted data goes through a JSON round trip first, which is stricter than SvelteKit's `devalue`.
- **Hand mutations.** Every behaviour test was turned red by a hand mutation: 17 on `/`, 18 on `/s/:slug`, 12 of 13 on `/submissions` and `/audits`. The one survivor was equivalent: trimming a `type=url` value the browser already trims.
- **The brief's three step-1 mutations** all went red:
  - approve posts to the wrong report id;
  - the submission-status click updates the DOM without `fetch` (10 tests across two pages);
  - a page renders without the shell's nav (7 shell tests red with the nav removed, 10 with the layout skipping the shell).

**How it was built.** I wrote the shell, hook, loaders, harness and the `/fleet` port. Three forks ported `/`, `/s/:slug`, and `/submissions` plus `/audits` in parallel, in one worktree, each in its own directories. Two of them each wrote a submission-row component; the one that decides every string on the server was kept, and `/submissions` now uses it. The kept component was re-proved under the `/submissions` tests before the other was deleted.

**Review round 1** (one manual pass: the lens agents could not be spawned from the review agent) found two majors, both fixed.

- **The lost space**, above.
- **The bulk mark-read form had no confirm until Svelte hydrated.** The old inline `onsubmit` held from first paint. A click before hydration, or with the script blocked, would have posted a fleet-bucket mark-read unconfirmed. The button is now server-rendered disabled and enabled on mount. Parity pins it (removing the guard turns it red). The audit Run button got the same guard, since a submit before hydration would have fallen back to a native GET carrying the prospect's URL.

Folded in from the same round:

- The commentary editor's baseline now normalises stored CR LF the way a textarea does. Before, a focus and blur with no edit reposted and rewrote stored CRLF text. A new DOM test was red before the fix.
- The db helper moved to `cockpit/src/lib/server/db.ts`, where SvelteKit refuses a client import.

**Review round 2** ran the wiring, defensive and cut lenses as three parallel agents. The wiring lens read both large view builders line by line against the old renderers and found no divergence. The round was still dirty.

- **Fixed:**
  - The two Trigger Renovate buttons were the same component twice; there is now one.
  - The site-details editor and the commentary textarea now carry the same pre-hydration guard as round 1's buttons. Before, an edit made before hydration was silently lost, with no ✓ or ✗, because the handlers did not exist yet. A small `mounted()` helper now backs all four guards.
  - The details editor normalises stored CR LF in its baseline, as the commentary editor does. A new test was red without the fix.
  - `/submissions` no longer ships every full row plus the bucket-wide facet reasons to the browser. The facets are tallied on the server, and rows are cut to what the list shows.
  - The minor cuts: a pass-through row wrapper, three file-local exports, and two default tsconfig options.
- **Deferred to the cutover,** since nothing serves the app yet:
  - SvelteKit's form-origin check needs the dashboard origin in `csrf.trustedOrigins`.
  - The five old page functions each carry a per-IP rate limit (60 a minute) that nothing in the cockpit site has yet.

**Review round 3** checked the round-2 fixes and found only minors, so the round is clean under the five-round rule. The test name and the line above were folded in.

**A gate the refactor would have blinded.** `tests/db/query-plans.test.ts` gates request-path queries by walking imports out from `netlify/functions/`. Its vacuity guard failed once the loaders moved, because `getSiteBySlug`'s importer became `page-data.ts`. The walk is transitive, so coverage held. The guard now names the real path, and the walk also starts from `cockpit/src/**/*.ts`, which after the cutover is a request path too.

**What remains, deliberately.**

- **The old renderers and their inline scripts are still live** until 1b, which deletes them with the five HTML page functions. The confirm texts and two submission rules the app needs moved first to `report-confirm.ts` and `submission-rules.ts`, so the cutover deletes no module the app imports.
- **Intentional differences from the old pages:**
  - The bulk mark-read confirm and the audit panel's Reload button are Svelte handlers, not inline attributes.
  - The mark-read and Run audit buttons stay disabled until those handlers exist. With JS blocked, they cannot submit at all, where the old Run form fell back to a GET and the old bulk form still asked.
  - The site-details editor and the commentary textarea also wait for their handlers. The one-click action buttons (Approve, Don't send, Unapprove, refresh preview, Send anyway, Trigger Renovate, the submission status buttons) do not: a click before hydration does nothing and can simply be repeated, whereas the old inline script was live from first paint. Review round 3 rated this minor, and it was accepted rather than guarded.
- **Two things the cutover must carry:**
  - SvelteKit's form-origin check will refuse the proxied `/submissions` POST until 1b adds the dashboard origin to `csrf.trustedOrigins`.
  - The old page functions' per-IP rate limit must be matched for the proxied pages before the old functions go.
