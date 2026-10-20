# 2026-10-20 — OD 18 step 1b: the dashboard site serves the SvelteKit cockpit

**Where it landed:** this PR (reddoorla/reddoor-maintenance, branch `claude/od18-cutover`), the cutover after step 1a (#1568). Reopens #582 under #672. The operator chose one site (workspace `decisions/2026-10-20-2240-od18-cockpit-one-site-or-two.md`).

**What changes for a visitor:** nothing in what the pages show, which the snapshots and render tests below pin. The difference is that they are now SvelteKit pages: one nav bar on every page, no inline scripts, and the same URLs. Sign-in, the session cookie and every `/api/*` and `/auth/*` endpoint are untouched: they remain Netlify functions.

**How the site builds it.**

- `netlify.toml` builds `pnpm cockpit:build` and publishes `cockpit/build`.
- The SvelteKit config moved to the repo root (`svelte.config.js`, pointing `files.src` at `cockpit/src`). The Netlify adapter writes `.netlify/` relative to the build's working directory, and Netlify collects the functions from the root. Built inside `cockpit/`, the page functions landed in `cockpit/.netlify/`, where Netlify never looks.
- The adapter runs with `split: true`. That gives one function per page, each with its own paths (`/`, `/fleet`, `/s/:param1`, `/submissions`, `/audits`), instead of a single function on `/*`. A catch-all function for unknown paths remains, and it excludes every page path. Whether it could shadow an endpoint function was not assumed: the deploy preview answers it, below.
- `svelte-check` now runs with `--workspace cockpit` and an explicit `include`. Run from the root, it had swept the repo's old test fixtures, which are deliberately Svelte 4. A planted type error proved it still catches errors.

**What went, and what replaced its evidence.**

- **Deleted:** the five HTML page functions, the seven string renderers and their inline scripts, `resolveSlug`, and the old `renderAuthChrome`. `renderSiteDashboardHtml` and `renderCockpitHtml` were exported from the package only so the dist smoke test could find them, and a minor changeset records their removal.
- **The 98 parity tests became 66 snapshots.** Before any renderer was deleted, every parity case also recorded its canonical markup as a snapshot, written while the parity assertion against the old renderer still passed (commit "freeze each page's canonical markup as a snapshot, verified by parity"). Each snapshot is therefore what the old page rendered. The test names are unchanged, because the snapshots are keyed on them, and the per-page controls that compared against the old renderer went with it.
- **370 old render tests still run, now against the new pages.** A shim (`cockpit/tests/legacy/render.ts`) keeps the old renderers' signatures, answered by server-rendering each page inside the real layout, with the data its load returns. Of the moved tests, 56 failed at first. All 56 were one of:
  - **Svelte's hydration comments.** The shim strips them; they are invisible.
  - **Escaping style.** Svelte escapes `<`, `&` and `"` but not `>`, so `&lt;script&gt;` became `&lt;script>`. That is equally inert. Every "no live tag" assertion stayed, so the check is still that nothing executes.
  - **Assertions on inline script text,** about 20. The scripts are gone, and their behaviour is executed by the DOM tests that step 1a proved with hand mutations.
  - **The two links the shell replaced.**
  - **Layout-insignificant whitespace** in three regexes.
- **The rate limit moved to the edge.** The five page functions each carried `rateLimit: { windowSize: 60, windowLimit: 60, aggregateBy: ["ip"] }`, and the adapter's page functions take no such option. `netlify/edge-functions/cockpit-rate-limit.ts` carries the same limit on the page paths. Its test reads the cockpit's route directories, so a new page cannot ship unlimited.
- **A runbook citation followed the feed.** `continuity.md` cited `renderNeedsYouFeed` in `fleet-render.ts`. The runbook-anchor test failed, as it should, and the citation now points at the page's `needs-you` section.

**Beliefs corrected on contact.**

- **The repo root was the published site.** With no `publish` set, the dashboard site published its whole repo root as static files. Setting `publish` ends that. No code links a static file on that domain: every use is the bare base URL, and every path built from it is a function.
- **An unknown path changes answer.** It used to get Netlify's 404 page. It now reaches the SvelteKit catch-all: a redirect to sign-in when signed out, and SvelteKit's 404 when signed in.
- **A rebase was the only clean way onto `main`.** Merging `main` into this branch conflicted, because 1a landed as a squash. The branch was rebased onto `main` instead. The deny list refuses a force-push, so the rebased history went to a new branch, `claude/od18-cutover`. The first branch, `claude/od18-cockpit-cutover`, is stale on the remote, and the proxy refuses branch deletes.

**What the deploy preview showed** (deploy `6ad7f7e3`, built from this branch's head).

- **Every function deployed.** There are 25: the six page functions (`sveltekit-index`, `-fleet`, `-s-_param1`, `-submissions`, `-audits`, `-catch-all`) and all 19 endpoint and clock functions that production has. The rate-limit edge function is there too.
- **The same 19 requests, signed out, against production and the preview.** 17 answer identically, with the same status, content type, `Location` and body:
  - the five pages and `/fleet?sort=perf` redirect to sign-in with the right `returnTo`;
  - `/auth/*` are unchanged, and the login page is byte-identical apart from the banner Netlify injects on previews;
  - each `/api/*` health and error body matches byte for byte.

  So no endpoint function is shadowed by the catch-all.

- **The two that differ are the unknown-path change named above.** `/nope` was Netlify's 404 page and is now a redirect to sign-in. `/favicon.ico` was never ours: production served Netlify's fallback icon behind a 404 (`fwd-status=404`). Every page, and the login page, declares its own icon inline, so no browser requests that path.
- **Not checked:** the pages signed in. That needs a session cookie, and minting one means reading the site's signing secret, which this session did not do. The snapshots and the moved render tests stand in for it.
