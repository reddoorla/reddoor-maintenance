## 2026-10-08 — Hwy 46 at Spencer Ranch's package rebuilt in the new template, live and in Dropbox (roalson-interests `890a36c` on `claude/listing-packages-spencer-ranch`; Operator decisions 81)

> Corrects in part 2026-10-08 — Roalson release `asP91BIAAH8K23X-` has its two files linked and is ready to publish. That entry said the live package "leaves the floodplain line out rather than stating anything false". The package now live has a FEMA page that states about 4% of the site is in Zone A.

The operator saw that the package published at 18:12Z "doesn't look nice like the new ones we made for them". It didn't. The 10-05 session had built it by copying the old Word-template letterhead from a package on Prismic. The 09-29 refresh had already moved all 22 packages to a new design: a garnet cover over a full-bleed aerial, Archivo and Atkinson Hyperlegible type, two spec pages, and generated location, area, aerial, traffic and FEMA maps.

**Why the generator looked missing.** It exists: `tools/listing-packages/` (66 files) on roalson-interests `claude/nifty-dirac-2zmegy`, four commits from 09-29 that never merged. Its runbook and journal entry sit on an unmerged branch of the same name here (`33e652b3`). My first search covered `main` in each repo, branch names matching pack/pdf/listing, and reddoor-workspace. It missed both. A commit-message search across every branch here found `33e652b3`, and that named the tool's path. One consequence holds beyond this listing: the live site still serves the old packages for the other 22. The refresh reached Dropbox (`2 - New Packages`) but never Prismic, and its review notes list questions marked "needs a decision before these go out".

**The rebuild.** The listing became the generator's 23rd. Its data file is a verbatim transcription of the 10-05 package. A script found all 18 values in both the old and the new PDF, and rejected two deliberately wrong values as a control.

- **Boundary.** The county parcel at the pin (StratMap 14916) is 74.91 acres, against 61.81 listed, so it is not the listing. The broker's own red outline was georeferenced instead. Its 4,000 ft scale bar measures 742 px, which gives 1.6431 m/px. NAIP Plus was exported at that scale, and FFT cross-correlation of the high-passed images put the match 11 standard deviations above the mean. The traced outline measures 61.41 acres, 0.6% under the stated area. On the imagery it follows Hwy 46 and Spencer Ranch Blvd.
- **Flood.** FEMA NFHL puts about 4% of that outline in Zone A, along the creek on the northwest edge. That agrees with the survey's own note. The runbook says a flood finding like this goes in front of the broker, and #264 already asks Erik about the floodplain.
- **Cover chip.** It reads "Available", not the schema's "For Sale" default. Sale or lease is still #264's question 1, and printing "For Sale" would assert it. The first attempt with "For Sale" was refused by the session's safety check, which made the point concrete.
- **Survey page.** The first build cut the survey from the old page, so it carried the old template's frame and header box. It now uses the embedded survey image (xref 125, 5400×3600), Matkin Hoover's "Tract 1, 61.81 AC".
- **Captions.** Two were wrong for this site. They credited the boundary to StratMap and gave FEMA's access date as "September 2026". `pkg.py` now takes per-site `boundary_note` and `accessed` overrides. No other site sets them, so their output is unchanged.

**Delivery.**

- **Dropbox.** The connector cannot upload, so the file went through a Dropbox file request filled by the 09-29 Playwright script. It landed as "Roalson Interests - Hwy 46 West and Spencer Ranch Blvd.pdf", 6,056,042 bytes, which matches the local file. The request (`jh6y6vw6vpc8u4ip4a71`) is still open, because the connector cannot close one.
- **Prismic.** `upload_asset` needs a public URL. A Dropbox single-use download link served, so the PDF went on no third-party host. The asset is `HYml4N1QxhD7qB0P`, sha256-identical to the local file.
- **Publish.** It went out in a one-document release (`asfvMBEAAFYKYEFd`) whose `diff_release` showed one delta, `package_pdf`. The operator chose "swap this one now". The live page linked the new PDF at 19:31:05Z, two polls after publishing, served inline as `application/pdf`.

An earlier attempt to push screenshots to a roalson-interests shots branch was refused as an out-of-place publication. The generator change itself was pushed, as a branch stacked on the unmerged one.

**Still open.**

- The generator and its runbook are unmerged in both repos.
- The other 22 packages are not on the site.
- Erik's answers to #264 may change this package. Rebuild it with `python3 build/pkg.py hwy-46-at-spencer-ranch-blvd`, then `print.mjs` and `assemble.py`, after editing `data/hwy-46-at-spencer-ranch-blvd.json`.
