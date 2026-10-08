## 2026-10-08 — Roalson release `asP91BIAAH8K23X-` has its two files linked and is ready to publish (Operator decisions 81)

A worker brief from item 81. The new listing `hwy-46-at-spencer-ranch-blvd` was staged on 10-05 with an empty `package_pdf` and `feature_image`, because the Prismic connector fetches only public URLs. The two files had been sitting on the public roalson-interests branch `claude/pr-shots-1005` all along, under `new-listing/`, so `upload_asset` could fetch them from raw.githubusercontent.com. `search_assets` for "spencer" found nothing before the upload, and "hwy-46" found only the other Highway 46 listing's two files, so there was no duplicate. The uploads are `PdZtQfQJVpiQ5wti` (the PDF, 4,365,280 bytes) and `XInzKwHTlKH1BMzH` (the aerial, 1546×2000). The listing's new version is `asfb-BEAACkAYCSW`. The other 14 documents in the release kept their version ids, read before and after with `diff_release`. The release is not published; that is the operator's.

**The release holds 15 documents, not 23.** Item 81 and the 10-05 entry both say 23. `diff_release` lists 15: 14 crops, 8 of which also move a pin, plus the listing. The 10-05 count seems to have added the 8 pin moves to the 14 crops as if they were separate documents, plus the listing. The brief, read at 17:00Z, already said 15.

**The PDF matches #264.** It has 6 pages: the listing text, the aerial, the survey, the disclosure, and the two-page IABS. Its text is the intake form's, and it has no floodplain line and no demographics, as #264 says it left them out.

**The crop moved 5 px.** The 10-05 session chose (0, 688, 900×710). The source's first five columns are the PDF page's white margin: their mean grey reads 254, 254, 254, 254, 245, then 56 at column 5. Wherever a frame shows the full crop width (the detail photo at every width, and the card at 390 and in the List view), that put a white line down the photo's left edge. The first round of screenshots showed it. The staged crop is (5, 685, 895×710). The 3 px move up centres the outline vertically, which the social card needs (below).

**How the crop was checked.** The outline was detected as saturated red pixels in the map area. Its bounding box in the source is x 191–684, y 806–1274. For each frame, the check takes the centred `object-cover` view of the crop and measures the smallest margin between the outline's box and the view's edge. The frames were measured in Chromium, not taken from the CSS:

| Where                                                        | Width          | Frame aspect | Margin (crop px) |
| ------------------------------------------------------------ | -------------- | ------------ | ---------------- |
| Detail photo                                                 | 1440, 834, 390 | 1.583        | 48.7             |
| Land carousel card                                           | 1440           | 1.391        | 87.6             |
| Land carousel card                                           | 834            | 0.763        | 9.3              |
| Land carousel card                                           | 390            | 1.583        | 48.7             |
| List view card                                               | 1440           | 1.093        | 121              |
| List view card                                               | 834            | 0.893        | 55.4             |
| List view card                                               | 390            | 1.583        | 48.7             |
| Homepage band (computed; the listing is not on the homepage) | —              | 1.71         | 27.7             |
| Social image, `w=1200&h=630&fit=crop` (computed)             | —              | 1.905        | 0.9              |

The narrowest frame is now 0.763, the 834 Land card, not the 0.81 the 10-05 session measured. Since then the Land view has moved onto the site grid (roalson-interests#278). The outline still fits with 9 px to spare. Any crop of this aerial that fits 0.763 is tight, because the outline is 493 px wide and 468 px tall. The social image was not on the brief's list. The 900-wide crop clipped the outline's top tip by about 1 px there; the 3 px move up fixes that.

**Preview, and what it can and cannot show.** The release ref is private: the public `/api/v2` lists only `master`, and the environment has no Prismic read token for roalson. So the preview is not Prismic's. It is the site at roalson-interests `456296e`, run under `vite dev`, with a local, never-committed wrapper on the Prismic client's `fetch`. The wrapper adds the listing, in API shape, to every `property` query. The API shape was copied from a published sibling and filled in from the release version that `get_document` read. The wrapper first broke hydration, because it read `process.env` at module scope in code the browser also loads. The link then rendered on the server and not in the browser, which is how it showed. Results:

- **The package link** reads "PROPERTY PACKAGE (PDF, opens in a new tab)" and has `target="_blank"`. A click opened a popup on `roalson-interests.cdn.prismic.io/…/PdZtQfQJVpiQ5wti_hwy-46-at-spencer-ranch-package.pdf`, and the listing tab stayed on the listing. The CDN serves that file as `application/pdf` with `Content-Disposition: inline`.
- **The aerial** shows the whole outline in every frame in the table, at 1440, 834 and 390.

The proof stops at the content: what the real site does with this listing. It does not prove that Prismic's release ref serves exactly this JSON; the shape was copied from a sibling, not read from the release. The other 14 documents in the release were not previewed. They are as the 10-05 session left them.

**Screenshots** went to the operator as download cards: the 1440 detail page, and a contact sheet of the 1440 detail, the 834 Land card, the 390 detail and the 1440 List card. They are not in this repo, which is public and takes no images. Pushing them to a roalson-interests shots branch, as `claude/pr-shots-1005` was, was refused in this session as a publication outside the brief.

**Publish now, rebuild the package after if Erik corrects it.** The operator is sending Erik the PDF on 10-08, and #264 lists 9 questions. The floodplain is the likeliest correction: the intake form says none, and the survey shows part of the tract in flood zone A. The live package leaves the line out rather than stating anything false, so publishing does not put a wrong claim live. A corrected PDF is a new asset and a one-document release. Hold publishing only if Erik changes the listing itself: Tract 2 (25.22 acres on the survey) would change the 61.81 acres in the title. The PDF was not rebuilt.

**Published.** The operator answered AskUserQuestion with "publish now", and the release was published through the Prismic connector at about 18:12Z. By 18:14Z roalson-interests.netlify.app served the listing, with no deploy step to wait on. The same browser script, pointed at the live site, measured the same frames and margins as the preview, to the tenth of a pixel. The package popup opened the same CDN URL. A sibling's crop (IH 10 at Highway 46, `rect=450,267,1100,929`) is live too, which shows the whole release went out, not only the listing. roalson.com is still the old site and 404s on both listings.
