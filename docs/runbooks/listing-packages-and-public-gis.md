# Runbook — listing packages, public GIS, and getting files into Dropbox

Written 2026-09-29 after rebuilding Roalson Interests' 22 commercial listing packages in a cloud
session. The reference implementation is `reddoorla/roalson-interests` →
`tools/listing-packages/` (README, `build/all.sh`). Read this before building maps, site
outlines, traffic or flood exhibits for any other real-estate site in the fleet. Every endpoint
below was reached from a cloud container on that date.

## Data sources that worked, and their traps

| Need                     | Source                                                                                                                                  | Trap                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aerial imagery           | USGS NAIP Plus `imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage` (public domain, 0.3 m HRO in metros) | Beat Esri's World Imagery tile cache on the same block downtown, and has no licence strings. Esri's `export` endpoint answers 500 (cache-only service). TxGIO's StratMap imagery host timed out and its alternates returned 502. Past z18 the imagery is visibly upsampled. The source has no-data scan lines in places (Seguin): patch them at a measured position. A generic dark-line detector also matched scale-bar edges and legend rules.          |
| Parcel outlines (Texas)  | `feature.geographic.texas.gov/…/Parcels/stratmap_land_parcels_48_most_recent/MapServer`                                                 | `query` answers "not supported"; `identify` (point or envelope, `returnGeometry=true`) works. Attribute keys come back UPPERCASE. KML/CMS pins are often a parcel away, so match by situs address, then exact `LEGAL_AREA`, then same-owner combinations within ~450 m. Check every match against the broker's own drawn outline. GIS area can be 25% off legal area.                                                                                     |
| Traffic counts           | TxDOT `services.arcgis.com/KTcxiTD9dsQw4r7Z/…/TxDOT_AADT_Annuals_(Public_View)/FeatureServer/0/query` (distance query)                  | A station id ending `NBSR`/`SBSR`/`EBSR`/`WBSR` is a **frontage road** with the freeway's name ("IH 35"). Deduplicating by road name labels frontage counts as the mainline. At Wonderworld this printed 11,773 where the mainline carries 122,403. Some `ON_ROAD` values are codes (`PA1502`, `FC0000`, `-`); drop them from labels.                                                                                                                     |
| Flood zones              | FEMA NFHL `hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?f=geojson`                                              | Classify `FLD_ZONE`/`ZONE_SUBTY` yourself: floodway, A/AE/V, shaded X (0.2%). Overlaps under ~3% of a parcel are usually parcel-to-FIRM misalignment. Round percentages when boundaries are approximate. A package that states no flood line can gain a flood disclosure this way, so put it in front of the broker; do not ship it silently.                                                                                                             |
| Brand-styled vector maps | The site's own `static/map-style.json` (OpenFreeMap tiles) in MapLibre GL 5 (UMD build) in headless Chromium                            | v6 is ESM-only with a separate worker, so use v5's `dist/maplibre-gl.js`. Launch with `--use-angle=swiftshader --enable-unsafe-swiftshader`. **Scale bars must use `78271.51696 · cos(lat) / 2^zoom`**: MapLibre zoom assumes 512-px tiles, and the 256-px constant (156543) draws every bar at 2× the true distance. DOM markers do not collide with map labels; add invisible symbol "blockers" under each tag, and place callouts by collision search. |

## Getting binary files into Dropbox from a cloud session

The connector can make folders, move, delete and list, but it cannot upload binaries. Use a
Dropbox **file request**:

1. `create_file_request` with the destination folder. It returns `https://www.dropbox.com/request/<id>`.
2. Drive the page with Playwright: `tools/listing-packages/build/frbatch.mjs` (roalson-interests).
   It builds a `DataTransfer` of `File` objects in the page and dispatches
   `dragenter`/`dragover`/`drop` on the drop zone. `setInputFiles` on the hidden input does
   nothing, and clicking "Add files" never raises a file chooser. It then fills name and email
   (`UPLOADER_EMAIL`) and clicks Upload.
3. The page shows no completion state a script can read. Wait ≈5 s per MB in batches of five
   (`build/upload.sh`), then verify every file's byte size with `list_folder`. Re-running a
   batch whose files already landed makes `(1)` duplicates.
4. Files arrive named `<uploader name> - <file name>`. Pick the uploader name to serve as the
   label ("Original", "Roalson Interests"), or rename afterwards with `move`.
5. Ask the operator to close the file request (Dropbox → File requests). The connector has no
   close.

## Traps in a site repo

- **The starter's `.gitignore` ignores every directory named `build`.** A tool whose code lives
  in `tools/<name>/build/` never reaches the branch, and nothing warns you: the commit looks
  complete from inside the checkout. roalson-interests shipped two commits like that before a
  fresh clone showed it. Re-include with `!build/` in the tool's own `.gitignore`, anchor its
  other patterns with a leading `/`, and prove any "reproducible" claim by cloning fresh and
  running the pipeline.
- `pkill -f <pattern>` inside a Bash tool call matches the calling shell's own command line
  and kills it (exit 144). Find the PIDs first, and exclude the shell.

## QA that found what spot checks did not

Two agents each compared every page of 11 rebuilt packages against their originals: text
diffed token by token, the scale bars measured against parcels of known width, QR codes
decoded. They found the 2× scale bars, the frontage-road mislabels, a pin ~120 ft off its
site, a garbled table and two near-empty pages. The builder's own contact-sheet checks had
passed all of them. Budget for that pass on any batch of client-facing documents. Also ask the agents for their
findings as text in their reply: both QA agents' report-file writes were refused by the harness,
even though the transcription agents' data-file writes in the same session went through.
