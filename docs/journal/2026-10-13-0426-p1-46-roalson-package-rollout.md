## 2026-10-13 — P1-46: all 23 Roalson packages rebuilt with Matt Howard's comments; held for the operator's review, then Erik for Matt (roalson-interests #297, `eedf175`; Operator decisions 120, #1331)

The brief asked whether Land ID share pages need an account or an export step. Neither is needed. A plain `curl` of a share's `share.json` gets a 403. The share page itself, loaded in headless Chromium, makes the same call and gets a 200. That response holds every polygon the broker drew. For the hero I first tried the share's og:image, a 1920×1080 server render. Nine of the 23 shares had none (`preview: null`). The SPA route `/map-screenshot/<slug>` is the view that image is made from, so `fetch_landid.mjs` renders it at 1920×1080 itself. Before trusting it I compared the capture against Land ID's own image. On Cascade Caverns the two differed by 0.03/255, against 48/255 for a different site. Twelve more shares came in at 0.01 to 1.10. Menger Springs Road came in at 29.4: Mapbox has replaced the imagery under the same outline.

**The instrument nearly put a floodplain on a cover.** St. Mary's capture differed from Land ID's preview by 3.77 where the rest were near 0. Its render had a cyan band down the river that the preview did not have. The share's `shared_enabled_layers` was `["floodplain"]`, switched on by the broker since the preview was cut. A cover is a stand-in for a photograph, and a flood overlay there has no legend. The capture now rewrites `share.json` in the browser with the layers off, and it fails if that rewrite never fires. With the layers off, St. Mary's came in at 0.08. Parcels layers were also on at 5930 Bandera and IH 10 at Highway 46.

**Boundaries and the 10-08 flood rule.** `landid_compare.py` computes, for each listing, the Land ID outline against the stored boundary: acres, overlap, and the FEMA sentence each would print. Its area function agrees with the county's GIS acres to within 0.7% on all 18 parcels. Before reading any "changed" verdict I checked the comparison on the current boundaries, and it reproduced all 18 stored sentences exactly. On Matt's eight listings, five FEMA sentences moved:

- Hwy 46: 4% → 3%.
- IH 10 at Menger Springs: from "no share computed" to "about 5%". This agrees with the broker's own "south end of Tract 1".
- IH 10 East at 1604: to Zone X.
- Loop 1604 at 181: to Zone X.
- Menger Springs Road: to "along the edge". A 0.08% sliver produces it, and it contradicts the broker's "no floodplain".

The operator accepted four and sent Menger Springs Road to the broker. The other 15 covers showed Land ID outlines over county-parcel exhibits, with overlap from 57% to 98%. The operator moved the 11 whose sentence would not change, and the rerun of `flood_verdicts.py` changed none of them. Walzem, IH 35, Lookout and St. Mary's stay on county parcels for the broker.

**A critical defect, invisible until a reviewer looked at pages.** The first `maps.mjs` passes ran into USGS NAIP gateway timeouts. Specific tiles took 90 s and came back 504 every time; one came back after 87 s. When a tile gave up, the job's race rejected, but `render()` went on running on the same page. Playwright's `setContent` rewrites that page's document. So the failed job kept drawing its legend, counts and intersection ring onto the next job's map, and counted its tile failures against it. Review round 2 found Loop 1604 at 181's "Zone X" flood legend baked into Dove Canyon's traffic map. Dove Canyon is about 10% in the 100-year zone. That is a buyer-facing page stating the wrong flood status.

I reproduced the leak before fixing it. `NAIP_FAIL`, a test-only switch, fails the tiles whose URL matches it. The unfixed code put 181's counts, north arrow and second scale bar on Dove Canyon's location map, and failed Dove Canyon's traffic map, which uses no NAIP tile at all. After any failure the page is now closed and replaced, and the same control comes out clean. Every stamp was deleted and all 92 maps re-rendered; by then USGS had recovered and one pass finished in about 15 minutes. The first pass had taken 1 h 35 m for 69 maps.

**Matt's comments that did not map cleanly.**

- "Perrin Beitel: floor plan stays." Perrin Beitel is 2.172 ac of vacant land, and its package has no floor plan. Matt's list names 22 packages and leaves out 13810 Lookout Road, which has one. Either reading gives the same output, so it is answered in the change list, not asked.
- "HEB owned." I found it in Kendall CAD, as parcel 15300 owned by HEB Grocery Company LP, rather than guessing from the old aerial.
- The new HEB at IH 10 East and 1604 is not in OpenStreetMap yet. The operator chose a plain label, which sits on Bexar CAD parcel 619012.
- Hwy 46's live `package_pdf` is now the generated package. Its data file's page numbers describe the intake form, so `assemble.py` looked for the IABS form on page 6. It now finds the form by its text, on page 11.

**Review:** three rounds.

- Round 1 had a code lens and a fidelity lens. The code lens found minors, which were fixed. The fidelity lens found one major, Menger Springs Road, which went to the operator.
- Round 2 found the contamination critical and two label collisions; all were fixed.
- Round 3 checked all 23 and found minors only. They are filed as roalson-interests#294, #295 and #296.

**Delivered and not.** The operator has all 23 PDFs as download cards, then the 12 that changed after his answers, each with a page-by-page change list. Nothing is on Prismic and nothing is in Dropbox. Two things are next: the operator's review, then the set goes to Erik for Matt. The Menger Springs Road flood sentence waits for the broker.

**Session hygiene.** A pass loop running in the background outlived its `pkill` of the workers. The loop shell itself had to be killed, or it restarted them on the old code.
