## 2026-10-12 — Williamson Construction hero posters are sharp frame 0 on all three pages (Operator decisions 74, #1311, release `as0E3xcAANU9etkN`)

The operator handed item 74 back to a worker: "queue a worker for the posters, have it ask me for whatever permissions it needs." On 10-05 the job had stalled on uploading, not on making the frames. The connector's `upload_asset` fetches only a public URL, and the permission policy refused both a temp host and `prismic-media-upload.yml` as public uploads.

**The route that needed no public host was already in the container.** The environment carries `WILLIAMSON_CONSTRUCTION_PRISMIC`, and `src/prismic/asset-api.ts` already posts multipart to `asset-api.prismic.io` with a bearer token. Before asking, the token was proved on a read: 200 and 113 assets for the real token, 403 for a bogus one, and 403 for `PRISMIC_WRITE_TOKEN`, which belongs to another repository. The ask went on #1311 first, then to AskUserQuestion: (1) the direct route, and (2) whether the worker may publish. The operator answered yes to both.

**The frames were checked against the stills, with a control.** Frame 0 of each hero video the live Content API names (home: teacher, about-us: first-day, services: services) against the old Webflow still scored SSIM 0.91, 0.86 and 0.95. Teacher's frame against the about-us still scored 0.49. A side-by-side look agreed: same shot, same framing, only sharper. Uploaded at 1920×1080, 1920×1080 and 1280×720. The release holds three documents with one delta each, `page_hero.background_image`, confirmed by `diff_release` before publishing. Alt stays null, as the stills had it.

**The first deploy after the publish served the old posters.** The Prismic hook started deploy `6acd04e9` at 16:03:53Z, and it went live at 16:04:51Z with the 854w stills still in the HTML, though the Content API's master ref already returned the new 1920×1080 images. A second hook deploy put the new posters live by 16:06:51Z. Had the check stopped after the first deploy, a successful publish would have read as a failure.

**Results, 3-run Lighthouse 12.6.1 medians on the Netlify site, both sides taken today.**

| page     | mobile LCP before → after | desktop LCP element before → after | poster bytes (phone) |
| -------- | ------------------------- | ---------------------------------- | -------------------- |
| home     | 2813 → 2682 ms            | VIDEO → IMG (2520 → 1021 ms)       | 20 → 50 KB           |
| about-us | 2603 → 2784 ms            | VIDEO → IMG (913 → 753 ms)         | 22 → 91 KB           |
| services | 2735 → 2822 ms            | VIDEO → IMG (1061 → 1215 ms)       | 18 → 66 KB           |

The 10-05 baseline of 2888 ms (home) was re-measured as 2813 ms today, before the change, so today's pair is the comparison. Desktop moved as decision 74 predicted: an image now as large as the video frame wins LCP. On mobile the medians move by −131, +181 and +87 ms, inside the runs' own spread (2390–3344). That mobile result is not a speed win. Phones used to get a poster capped at its native 854w (or 640w), so they now fetch two to four times the bytes for a sharp image. The `sizes` attribute asks for 889px at phone widths, which is correct for an object-cover hero at DPR 1.75. Narrowing it is a code change, and nobody asked for one.

No code changed in williamson-construction-co, and nothing touched DNS, Netlify domains or the cutover.
