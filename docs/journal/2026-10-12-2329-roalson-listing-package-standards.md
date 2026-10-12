## 2026-10-12 — Roalson's package standards go into the listing-package generator; Hwy 46 rebuilt to them, not published (roalson-interests #293, `90c6d9e`; Operator decisions 118, 119)

Erik posted two sources in `#roalson-interests` at 21:29Z and 21:30Z. The first was his own notes on the Hwy 46 package. The second was a 14-page scan of the client's marked-up 116 Old San Antonio Road package, which the client called the "global standards" for every PDF. The scan made nine marks. The cover's "FOR SALE · LAND" loses its type "on all packages including improved projects". The contact block gets larger. The watermark shrinks off the boundary. "Investment" becomes "Price". The close area map and the close aerial are crossed out. "— Surrounding Area" is struck from the wide aerial. Traffic Counts becomes "Area Map with Traffic Counts" and moves to second place. The survey is crossed out: "we decided against providing surveys on most packages". Read against the markup, Erik's area-map notes (show the nearest major intersection, show the big businesses) can only apply to the traffic map, since the client deleted the plain area map. His Hwy-46-only aerial note turned out to be the same global mark.

**The brief's premise was wrong on contact.** It said the Land ID list "has not arrived". Matt Howard had sent all 23 links to Erik at 20:35Z, and Erik forwarded them to the operator at 21:35Z, before the session started. Erik's 21:36Z Discord line ("Just forwarded you the links") was the pointer. They are in `build/heroes.json` as data, and nothing was fetched. The operator chose to wait and do all 23 together.

**Proved before trusted.** The unchanged generator at `890a36c` rebuilt the live package (Prismic asset `HYml4N1QxhD7qB0P`) with zero text differences on 11/11 pages and pixel-identical at 40 dpi on 10/11. The eleventh is the survey, which the 10-08 session cut by hand from an embedded image, while `extract.py` re-cuts it from the page. A mismatched page pair scored 78.7 as the negative control. The Hwy 46 rebuild went from 11 pages to 8. The watermark is 262px against the old 372px, 70.4%; Erik guessed "maybe 70%". Its right edge sits within 0.5px of the wordmark's, measured from both SVGs' ink.

**Beliefs corrected on contact.**

- The brand style's POI layer shows no businesses on the traffic map. OpenMapTiles carries businesses only from z14, and that map renders at 13.4. The businesses now come from z14 tiles decoded in Python.
- The intersection finder first reported 1,290 m to IH 10 & SH 46. It multiplied the whole degree distance by cos(lat), and round 1 caught it: the true distance is 1,317 m.
- USGS's NAIP export answered 502 and 504 for minutes at a time (one tile took 55 s, the next 0.5 s), and MapLibre never retries a tile. The first two render runs simply hung; I measured 11 minutes with `date -u` before calling either one hung. Tiles are now cached with backoff, and a map with a tile that never arrived is neither written nor stamped.
- My first JPEG check, "ends with FFD9", failed every good tile, because USGS appends a 56-byte trailer after the end marker. I shipped the check before seeing it pass, which is exactly the rule in CLAUDE.md. Run against real data, it failed the positive control at once. The fix was proven on 19/19 good tiles and 0/57 truncated copies.
- A first "not stamped on failure" control hung instead of failing, because MapLibre keeps re-requesting aborted tiles. The job now ends as soon as a tile gives up.

**Review: three dirty rounds, each held to the operator.**

- Round 1: a failed tile left a broken image with a matching stamp, and a Land ID hero would have replaced broker photography on three listings. Fixed.
- Round 2: the flood caption on four pin-only listings told readers that tract boundaries "appear on the survey and exhibit pages", which no longer exist. My first replacement ("shown by a pin, not a boundary") was false for IH-10 at Menger Springs, which has a boundary plus extra pins. The sentence now says no share is computed.
- Round 3: five listings' own copy says "See Survey". The operator kept the survey on exactly those five, reading the client's "most packages" that way. That lasted half an hour (see below).

The minors are in roalson-interests#292.

**The email I did not see.** Erik forwarded Matt Howard's per-package comments at 22:12Z. My one Gmail search ran at about 21:40Z and found only the Land ID forward, and I never searched again. The operator asked "did you also see erik's emails?" at 23:10Z. Matt's list says "remove survey" for every listing that had one, including all five that decision 119 had just kept. The flags came out (roalson-interests `c485b74`), the four "See Survey" cross-references went into `build/corrections.json`, and #293's landing was stopped until they did. The lesson is mechanical: a source that has already delivered once in a session will deliver again. Erik's Discord line had promised "the links", and two emails followed. The rest of Matt's list (Land ID boundaries, copy edits, exhibit keeps and removes, an HEB logo on one site) is P1-46.

**Logos.** The operator asked for a research turn before choosing. Brandfetch's own guidelines say "Programmatic access to logo images is not permitted", so a logo cannot live in a PDF. logo.dev's free plan "must show a visible link to Logo.dev" on a public page and says nothing about print. The operator chose names and pins.

**Delivered and not.** The Hwy 46 draft went to the operator as a download card. It is not on the site and not in Dropbox. The other 22 packages are not rebuilt. The generator reached roalson-interests `main` in #293 (`90c6d9e`, 23:31Z), squashing the three stacked branches. The rollout to all 23 is P1-46. Its runbook still sits on reddoor-maintenance's unmerged `33e652b3`.

**Session hygiene.** `pkill -f maps.mjs` matched my own shell's command line and killed it mid-command. Narrow a pattern to the node process. The main checkout's HEAD was detached so the session branch could live in a worktree, per the never-commit-from-main rule.
