## 2026-10-26 — SvelteKit 3 on the last six repos on kit 2: Revogen, MSOT and Roalson through `staging`; blux, canvas-starter and md-pdf straight to `main`

Landed in the PR that carries this file. The brief is the home base's `briefs/2026-10-24-kit3-remaining-repos.md`.

**Site PRs:**

- reddoorla/revogen#108 (`b91a6d6`, into `staging`), with promotion PR reddoorla/revogen#110;
- reddoorla/medical-solutions-of-texas#91 (`0343a63`, into `staging`), with promotion PR reddoorla/medical-solutions-of-texas#93;
- reddoorla/roalson-interests#306 (`b75e331`, into `staging`), with promotion PR reddoorla/roalson-interests#311.

**Straight to `main`:**

- reddoorla/reddoor-starter-blux#51 (`550adea`);
- reddoorla/canvas-starter#44 (`9dc6ac3`);
- reddoorla/reddoor-md-pdf#25 (`618039c`).

**Decision files** in the home base's `decisions/`:

- `2026-10-24-2002`, `2026-10-24-2047`, `2026-10-25-1554`, `2026-10-25-1655` and `2026-10-25-1941` (Roalson's rounds 6 to 9);
- `2026-10-26-1522` (blux: staging or `main`);
- `2026-10-26-1613` (canvas-starter: migrate or archive);
- `2026-10-26-1717` (md-pdf: the merge is a deploy).

Renovate's kit 3 security PR (GHSA-27mw-82g8-phjj) broke `ci / ci` on every repo still on kit 2. The operator chose to migrate these six and leave the non-maintained sites alone.

**The three sites took the staging flow**, Operator decisions 113. On each:

- the migration merged into a new `staging` branch;
- the Netlify `allowed_branches` PATCH was the only `build_settings` change;
- staging's `/health` matched production byte for byte.

The promotion PRs wait on the operator, who must first create each `staging` ruleset. A worker never merges into `main` there.

**Revogen and MSOT** followed P1-53's factory recipe (`createKitConfig`) and needed two review rounds each. MSOT's first round found that maintenance 0.109 skips an absent `/dev/animate-in`, where 0.95 had scanned the 404 page by accident. That fixture, the 404 page, now has its own axe test.

**Roalson cost nine review rounds, and every one of them was about scroll.** The site sets `html { scroll-behavior: smooth }`, and kit 3 changed when and how kit scrolls. Each fix closed the case it measured and exposed the neighbouring one:

| Round | Case                                                                   | Fix                                                                                |
| ----- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1     | Back to a page saved at the top glided 863→0                           | the layout flushes layout before kit's scroll                                      |
| 2     | Reload glided up from 0                                                | no smooth scrolling until hydration                                                |
| 3     | That reload then drifted 112px                                         | scroll anchoring followed hydration shrinking `/properties` from 14212px to 2487px |
| 4     | The re-apply snapped back a visitor who scrolled during a slow load    | —                                                                                  |
| 5     | Anchoring off moved a first visit's text 24–72px on a font swap        | —                                                                                  |
| 6     | The navigation-type hold missed a same-URL load                        | —                                                                                  |
| 7     | —                                                                      | hold on kit's own restore condition                                                |
| 8     | With site storage blocked, kit 3.1 restores nothing                    | hand the restore back to the browser                                               |
| 9     | That hand-back cost the page's foot in Chromium and misfired in WebKit | —                                                                                  |

The operator stopped the chase at round 9 and landed `420c67d`. The storage-failing cases were filed:

- reddoorla/roalson-interests#310 for the site's scroll cases;
- this repo's #1722 for kit 3.1.0's own `capture_scroll` crash. With storage blocked or full, Back then Forward leaves the old page on screen. That is in every kit 3 site.

With storage working, round 9 measured every case at parity with kit 2 or better: 378 `/properties` runs in three engines. Belief corrected on contact: that each round was converging. It was walking a boundary drawn by kit itself, and the cost was in the operator's attention, nine questions for one site's smooth scrolling.

**The three non-site repos went straight to `main`, each on the operator's word.**

- **Blux:** the native starter's #187 and #188 were cherry-picked. Blux's own CSP (frozen site, Google Maps) was kept exactly, typed `const` because kit 3 types each CSP source as a literal.
- **canvas-starter:** the operator had said on 10-20 to archive it, and chose to migrate it anyway. It forked from the starter so early that a cherry-pick conflicted in 25 files, so it was ported by hand.
- **md-pdf:** a Render service. The merge was first refused by the session's classifier as a production deploy, and was merged on the operator's explicit say.

**The md-pdf merge did not deploy, and neither had anything since September.** Production's `_app/version.json` is a 2026-09-30 build. #19 and #20 (a vite security fix) never reached production either, and twenty minutes after #25 it still served kit 2. `autoDeploy: true` in `render.yaml` is not firing, or Render's builds fail. This session had no Render access, so reddoorla/reddoor-md-pdf#27 holds the evidence for the operator. Belief corrected on contact: that the merge was the deploy, which is what made it red-tier. It deployed nothing.

**Defects these three found, each from the same root.** Kit 2's `prerender.origin` baked the production origin into every read of `page.url`; kit 3 has no such option, and `paths.origin` would also become the only CSRF origin. The starter's `siteOrigin` covers Seo, and the other readers had to be found one by one:

- **Blux and canvas-starter:** `ProductDetail`'s share links shared `http://sveltekit-prerender/...` in static HTML.
- **canvas-starter:** robots.txt and sitemap.xml are still prerendered there, unlike the starter (#140). Production's robots.txt would have advertised the placeholder sitemap.
- **md-pdf:** the same move bit from the other side. adapter-node 6 stopped reading the `ORIGIN` variable that `render.yaml` set in April to stop a production CSRF 403. Its origin is `paths.origin` now.
- **md-pdf's image:** kit 3.1 needs Node ≥22.17, and the image pinned `node:22.13-slim`. CI's floating `node-version: 22` would never have shown it.

Each origin reader got a prerender test, and each test was mutated red. The brief's prerender-origin mutation needed real content on blux, whose placeholder repo prerenders nothing, so it ran against 29-navy's public Prismic repository.

**An incident.** The canvas-starter reviewer was told local form submits were fine. The container carries the real `FORMS_INGEST_URL` and `FORMS_INGEST_TOKEN`, so two local `POST /contact` requests (about 9:27am PT, sourceUrl `http://localhost:4691/contact` and `:4692/contact`) very likely reached the central ingest as leads. They are the operator's to delete. Every later reviewer brief said to unset both variables first. A worker brief that permits a "local" form submit must say what the container's environment points at.

**Honest accounting.**

- Most of the review value was outside the brief's two named mutations. The CSP mutation had no target on canvas-starter or md-pdf, and the prerender-origin script would not run on a template.
- The real findings came from comparing each head with base, built and served the same way, in three browsers.
- Filed along the way:
  - reddoorla/reddoor-starter-blux#52 (blux config branches untested);
  - reddoorla/canvas-starter#45 (the build-origin define is untested);
  - reddoorla/reddoor-md-pdf#26 (non-Latin-1 filenames 500, pre-existing);
  - reddoorla/reddoor-md-pdf#27 (Render has not deployed `main` since 2026-09-30).
