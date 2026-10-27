## Worker brief — OD7-P2c: Williamson Construction HD background video, content half and fleet follow-ups

**Item.** Operator decision 63 · williamson-construction-co#12, #13 (merged) · 🟡 YELLOW · effort M
The site serves Webflow's 480p/360p transcodes at under 1.5 Mbps for all six
background videos [M, ffprobe on the live files]. The Dropbox masters are 1080p
(services 720p), matched to each clip by duration and frame [M]. The operator
asked for better quality, settled the hosting question (self-host from Prismic,
keep Vimeo for content videos and review), and wants this on its own session.
The research and the measurements are in the 2026-10-01 journal entry
"Vimeo or our own player" in this repo.

**Verify first.** `curl -s https://williamson-construction-co.netlify.app/ | grep -o 'prismic.io/[^"]*transcode[^"]*' | head -3`
Expect: the Webflow `-transcode.mp4/.webm` URLs; the HD assets are not yet
referenced by any published document.

**Start here.**

- **Already on `main` (#13, `40dfd58`):** `src/lib/components/BgVideo.svelte`
  plays within 200px of the viewport, pauses off screen, keeps a visitor's
  pause, and takes `mobileMp4` as the first `<source media="(max-width: 767px)">`.
  The `video_mp4_mobile` Link-to-media field exists on `PageHero` and
  `VideoBand`; the model push to Prismic ran green on `main`.
- **PR #12** (`claude/prismic-media-upload`): a `workflow_dispatch` job that
  fetches files from a URL and posts them to the Prismic Asset API with the
  repo's `PRISMIC_WRITE_TOKEN`. Three review rounds; the third found nothing
  blocking and three should-fixes (an expired token gives a bodiless 500, a
  redirect read as success, retried bodies glued together), all applied and
  simulated locally against a stub server in eight modes. The landing session
  lands it on green CI, or it is already on `main` by the time you read this:
  check `gh api repos/reddoorla/williamson-construction-co/pulls/12 --jq .merged`.
- **Staged files:** Netlify draft deploy `6abea219d245ed5434aa0ded` on site
  `7e2831e2-1a1b-4184-8399-981d0f6361c1`, base URL
  `https://6abea219d245ed5434aa0ded--williamson-construction-co.netlify.app/video/`,
  21 files, each verified byte for byte: for `wc-teacher`, `wc-doctor`,
  `wc-school`, `wc-first-day`, `wc-scan`: `<name>-1080.mp4`, `<name>-1080.webm`,
  `<name>-phone-720.mp4`; for `wc-services`: `-720.mp4`, `-720.webm`,
  `-phone-720.mp4`; posters `wc-doctor-poster-1080.jpg`,
  `wc-school-poster-1080.jpg`, `wc-scan-poster-1080.jpg`. A draft deploy is not
  production and stays until deleted.
- **Already in Prismic (images, via the connector):** `wc-scan-poster-1080.jpg`
  = `jEhBaIPHyqL2ulxy`, `wc-doctor-poster-1080.jpg` = `dgc0pDrJr88QbPEE`,
  `wc-school-poster-1080.jpg` = `KQrQOe-O0Pj2QQFd`. The connector refuses video
  (`kind` must be image or document), which is why #12 exists.
- **Documents and slices to rewire** (repository `williamson-construction`,
  fields `video_mp4`, `video_webm`, `video_mp4_mobile`, and `poster` on video
  bands):
  - home `ar0oeRIAACoARR3-`: `slices[page_hero$dd412020-7dd9-42b4-8cf4-4f27e936303c]`
    = teacher; `slices[video_band$bf2d01f1-9426-4b20-93ec-d0e7762df85a]` =
    doctor; `slices[video_band$9c67332d-c281-4ba1-8580-90d5ad597914]` = school.
  - about-us `ar0odRIAAC0ARR3x`: `slices[page_hero$b9fc710e-c991-435e-bf92-2b568a83da62]`
    = first-day; `slices[video_band$c4bf7959-579e-411a-bb32-a31684d94c43]` = scan.
  - services `ar0odxIAACkARR33`: `slices[page_hero$85aa1e41-ecc9-4665-92b4-f6e96faa756c]`
    = services.
- **Encode recipe, unreviewed, no PR yet:** reddoor-maintenance branch
  `claude/video-encode-command` (`ad1a032`), `reddoor-maint video <input>
[--out] [--name] [--max-height] [--upload <prismic-repo>]`. 17 tests, four
  named mutations red, proven on a real ffmpeg run; `src/prismic/asset-api.ts`
  lifted out of `run-migration.ts`. It carries its own journal entry and a
  changeset. The `--upload` path was tested only against a fake fetch.
- `matching/LEDGER.md` in the site repo already has the three lines for this
  change (sources, posters, loading behaviour).

**Done when.**

1. All 18 video files are in Williamson's Prismic media library, each exactly
   once (the Asset API does not dedupe by name).
2. The six slices above point at the new mp4, webm and phone files, and the
   three video bands at the new posters, staged in a Prismic release, checked
   on the site's preview, then published. The site is pre-launch (Webflow
   serves `www` until 2026-10-19), so publishing affects only the Netlify site.
3. On production, measured with a Playwright page load, unscrolled, 8 s: under
   3 MB of video on a 390px viewport, and the hero playing with no interaction;
   zero `hydration_mismatch` in the served markup.
4. The matching gate on `home`, `about-us` and `services` shows the video
   regions no worse than r8 (the frozen first frame is the same shot, so only
   sharpness and the doctor band's missing bars move), with a LEDGER line for
   any region that changes class.
5. The recipe branch has a PR with its mutation table, a review, and lands.
6. BACKLOG decision 63's "goes well" line is filled in with the measured
   numbers, so the fleet rollout to the eight Vimeo sites is a reading, not a
   feeling.

**Mutations I will run** (each must turn a test red): the recipe's four are
already recorded on its branch; for any new test, name the mutation in the PR
before the code.

**Stop conditions** (beyond AUTONOMY.md's six):

- Do not re-run `src/lib/site-pages.js` (the Webflow seed) against the
  documents: it still writes the 480p transcodes and no `video_mp4_mobile`, so
  a re-seed would overwrite the HD sources. Fixing the seed is optional and
  separate.
- Do not create a new Netlify site or production deploy to host files; the
  draft deploy above already serves them.
- `williamson-homes` belongs to another session; never touch it.
- Two dirty review rounds → "Operator decisions", not a third round (the
  operator chose a third for #12 explicitly; that choice does not carry).

**Landing.**

1. `git fetch` the fresh `claude/*` and `fix/*` branches in both repos; if one
   under a day old touches these files and is not listed above, stop.
2. Worktrees from `origin/main` in both repos; never commit from a main checkout.
3. With #12 on `main`, dispatch
   `prismic-media-upload.yml` on `main` with the base URL and the 18 video
   names via the GitHub connector's `actions_run_trigger`; read the job log for
   the `UPLOADED <name> {id,url}` lines.
4. Rewire the slices with the Prismic connector (`get_document` for the
   version id, `update_document` into a release, `present_release`, then
   `publish_release`).
5. Measure (done-when 3 and 4), then the recipe PR, then BACKLOG 63 and the
   journal entries in both repos, landed before the session ends.
