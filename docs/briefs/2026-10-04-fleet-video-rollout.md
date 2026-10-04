## Worker brief — decision 63, rollout half: self-hosted background video for the Vimeo sites

**Item.** Operator decision 63 (BACKLOG) · williamson-construction-co#13, #12, reddoor-maintenance#1116 · 🟡 YELLOW · effort L
Williamson Construction now plays its six background videos from 1080p encodes
in Prismic through `BgVideo` [M, 2026-10-04 journal entries in both repos].
The operator's answer in decision 63 is to roll the same to the sites still
embedding Vimeo for background video, site by site, never as a sweep; on
2026-10-04 the operator asked for this session to do it. The sites are live
client sites, not pre-launch: a Prismic publish there changes production.

**Verify first.** The list of Vimeo sites is not written down anywhere in this
repo (decision 63 says "the eight Vimeo sites" without naming them). Your
first deliverable is that list with evidence: enumerate the fleet from the
Turso roster, attach and clone each pushable repo, and grep it for
`player.vimeo.com` / `vimeo` in `src/`. Record repo, the slice or component
that embeds Vimeo, the pages that use it, and the clip's Vimeo id, in the
rollout table (below) before touching any site. Expect: a handful of sites,
each with one to three background clips; Revogen, ERP, Espada and Vineyard
appear in decision 63's traffic line and are likely among them [I].

**Start here.**

- `williamson-construction-co:src/lib/components/BgVideo.svelte` and
  `BgVideo.test.ts` — the player to port: plays within 200px of the viewport,
  pauses off screen, keeps a visitor's pause, `<source media="(max-width: 767px)">`
  first for the phone mp4, `preload="metadata"`, no `autoplay` attribute.
- `williamson-construction-co:src/lib/slices/PageHero/model.json`,
  `VideoBand/model.json` — the fields: `video_mp4`, `video_webm`,
  `video_mp4_mobile` (Link to media), `poster` (Image). Set each Link field's
  placeholder to say what belongs in it ("H.264 mp4, 1080p or less, from
  `reddoor-maint video`"); editors see nothing else.
- `williamson-construction-co:.github/workflows/prismic-media-upload.yml` —
  the dispatchable upload (fetches files from a public HTTPS directory, posts
  them to the Asset API with the repo's own `PRISMIC_WRITE_TOKEN`). Port it
  as is. The Prismic connector refuses video, so this is the only upload path
  from a cloud session.
- `src/cli/commands/video.ts`, `tests/cli/video-command.test.ts` (this repo,
  #1116) — `reddoor-maint video <input> [--out] [--name] [--max-height]
[--upload <repo>]`. Run it from this checkout with `pnpm reddoor-maint
video …` (or `node dist/…` after `pnpm build`); it is not released to the
  sites yet. `--upload` has never run live; the first live run is to be read
  (README "Video renditions").
- `docs/workJournal.md` 2026-10-01 "Vimeo or our own player", 2026-10-04
  "Williamson plays HD from Prismic", and the site's `docs/workJournal.md`
  and `matching/LEDGER.md` entries of 2026-10-04 — the measurements, the two
  instrument errors (a byte counter that overcounted cancelled range
  requests; a test page without a viewport meta), and the gate method.
- Masters. Williamson's were in Dropbox (`WC_website 2020/08_Art/`); for the
  other sites the originals are wherever the operator uploaded them to Vimeo
  from. Look in Dropbox first (connector). Vimeo's own "download original"
  needs the operator's login, which is not yours.

**Step 0, before any other site: the phone cap.** Decision 63's reading:
Williamson's about-us downloads 5.9 MB and services 6.4 MB at 390px in 8 s
because the phone rendition is capped at `-maxrate 2200k`; a 20 s clip is
6 MB. Lower the phone cap in `planRenditions` to `-maxrate 1200k -bufsize
2400k` (keep `-crf 24`), re-encode Williamson's `wc-first-day` and
`wc-services` masters with it, upload the two new phone files under new
names (`-phone-720-v2.mp4`: the Asset API does not dedupe and the recipe
refuses a same-name different-size file as STALE), rewire the two
`video_mp4_mobile` fields, publish, and measure about-us and services at
390px. Done when both read under 3 MB with the hero playing. Record the
numbers in decision 63. If 1200k visibly degrades the picture on a phone
(check a frame at 390×844 against the 2200k file), stop at 1600k and write
the comparison down instead of guessing.

**Per site, in this order, one PR at a time:**

1. Fetch the fresh `claude/*` and `fix/*` branches of the site repo; if one
   under a day old touches the video slices or `BgVideo`, stop on that site.
2. Masters: find them (Dropbox, the site repo, the operator's Drive). None
   reachable → one line per site under Operator decisions naming the clips by
   Vimeo id and page, and move to the next site; never encode from a Vimeo
   stream capture.
3. Encode with `reddoor-maint video`, stage the outputs on a Netlify draft
   deploy of the site (`netlify deploy` without `--prod`, as Williamson did;
   a draft deploy stays until deleted and is not production), check each
   file byte for byte, and dispatch the ported `prismic-media-upload.yml`
   on the site's `main`. The repo needs its own `PRISMIC_WRITE_TOKEN` secret;
   minting one is RED, so a repo without it gets an Operator decisions line
   and waits.
4. Port `BgVideo`, its test, and the fields in one site PR; the model reaches
   Prismic from CI on merge (`prismic-models.yml`). Replace the Vimeo embed
   in the slice with `BgVideo` reading the new fields, keeping the old Vimeo
   path rendering when the new fields are empty, so the live site does not
   go blank between the merge and the content publish.
5. Rewire the slices in a Prismic release with the connector, check the
   deploy preview, measure on it, then publish. Measure again on production.
6. Journal entry in the site repo; a line in the rollout table here.

**Done when.** For every site in the list: either the rollout table in
decision 63 carries its production readings (video bytes at 390px unscrolled
in 8 s, hero playing with no interaction, console errors, Best Practices),
or one line says why it stopped (no masters, no token, another session). The
readings are taken with the CDP instrument below, never by summing response
bodies, and the control is run first.

**The instrument.** Playwright against production, viewport 390×844,
`isMobile`, `Network.enable` on a CDP session, sum `encodedDataLength` from
`Network.dataReceived` for requests whose url ends in `.mp4`/`.webm`, read
`video.currentSrc/paused/currentTime` after 8 s from navigation, count
`hydration_mismatch` in the served HTML, collect console errors. Prove it on
a control page first: one `<video preload="auto" autoplay muted>` of a file
whose size you know must report that size. Lighthouse through
`node_modules/.bin/lhci collect --url=… --settings.preset=desktop`.

**Mutations I will run** (each must turn a test red):

1. Recipe: raise the phone `-maxrate` back to `2200k` → the test pinning the
   phone rendition's argv goes red.
2. Each site's ported `BgVideo.test.ts`: remove the `IntersectionObserver`
   pause branch → the "pauses off screen" test goes red; drop the mobile
   `<source media>` → the "phone source first" test goes red.
3. Each site's slice: empty the new fields → the Vimeo fallback renders (a
   test pins it); fill them → `BgVideo` renders and no Vimeo iframe is in
   the markup.

**Stop conditions** (beyond AUTONOMY.md's six):

- Minting or copying a Prismic write token is RED. A repo without
  `PRISMIC_WRITE_TOKEN` waits on the operator.
- No sweep: one site PR at a time, merged and published before the next
  site's PR opens. A codemod across repos is a RED fleet mutation.
- `williamson-homes` is another session's until its fresh branches are a day
  old; check before touching it.
- A site whose Vimeo clip is content (a talking-head video with sound, a
  player with controls) is not in scope: decision 63 keeps Vimeo for those.
- Two dirty review rounds on any PR → Operator decisions, not a third round.
- Do not delete Vimeo videos or cancel anything on Vimeo.

**Landing.** Worktrees from `origin/main` in every repo; never commit from a
main checkout; `node scripts/land-prs.mjs <pr> --repo <owner/repo>` to land;
journal entries in each site repo and one here, landed before the session
ends; the rollout table in decision 63 updated in the same PR as each site's
central journal line.

**Rollout table** (fill in decision 63, one row per site):

| site | clips | masters | token | PR | published | 390px MB | hero | console | BP | note |
