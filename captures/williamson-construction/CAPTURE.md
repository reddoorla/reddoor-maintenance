# Webflow capture: https://www.williamson-construction.com

Captured 2026-09-30T00:42:41.227Z by `scripts/webflow-capture/capture.mjs`. Webflow site id `646d47bfeb53b0308e8d4379`.

Every page reachable by same-origin links from `/`, and every file those pages load, recursively
(stylesheet `url()`s, runtime script loads, Lottie images), byte for byte and unrewritten.
`manifest.json` maps each URL to its file with its sha256. Re-prove it offline with
`node scripts/webflow-capture/check.mjs <this directory>`.

**14 pages, 333 files, 143.1 MB. 12 excluded, 0 failed to download. Check: PASS (333 present, 0 failures).**

## Pages

| path                                                              | bytes |
| ----------------------------------------------------------------- | ----- |
| `/`                                                               | 25026 |
| `/about-us`                                                       | 14075 |
| `/contact`                                                        | 8740  |
| `/join-the-team`                                                  | 11346 |
| `/projects`                                                       | 19460 |
| `/projects/cedars-sinai-beverly-hills`                            | 10094 |
| `/projects/cedars-sinai-pro-building-cooling-tower-refurbishment` | 17492 |
| `/projects/mbm-hospitality`                                       | 22226 |
| `/projects/providence-express-care`                               | 11784 |
| `/projects/providence-hospital-little-company-of-mary`            | 9066  |
| `/projects/providence-saint-johns`                                | 10817 |
| `/projects/torrance-high-school`                                  | 10397 |
| `/projects/west-high-school`                                      | 11831 |
| `/services`                                                       | 26755 |

## Files by type

| type  | files |
| ----- | ----- |
| jpg   | 170   |
| jpeg  | 70    |
| woff2 | 30    |
| png   | 24    |
| svg   | 16    |
| js    | 8     |
| mp4   | 6     |
| webm  | 6     |
| css   | 2     |
| pdf   | 1     |

## Files by host

| host                          | files |
| ----------------------------- | ----- |
| cdn.prod.website-files.com    | 296   |
| fonts.gstatic.com             | 30    |
| d3e54v103j8qbb.cloudfront.net | 4     |
| ajax.googleapis.com           | 1     |
| fonts.googleapis.com          | 1     |
| use.typekit.net               | 1     |

## Excluded (not vendored, on purpose)

- `https://cdn.embedly.com/widgets/media.html?src=https%3A%2F%2Fplayer.vimeo.com%2Fvideo%2F1138278406%3Fapp_id%3D122963&dntp=1&display_name=Vimeo&url=https%3A%2F%2Fvimeo.com%2F1138278406%3Fshare%3Dcopy%26fl%3Dsv%26fe%3Dci&image=https%3A%2F%2Fi.vimeocdn.com%2Fvideo%2F2084562618-f45c3d4ad575590722904d0994329ed9831b187ac50615f3a9853268664f865d-d_1280%3Fregion%3Dus&type=text%2Fhtml&schema=vimeo` (from /projects/cedars-sinai-pro-building-cooling-tower-refurbishment): a video-platform embed: the video is hosted by the platform (the embed URL names it), not by Webflow, so it survives the cancellation.
- `https://use.typekit.net/af/442215/000000000000000000010b5a/27/` (from files/use.typekit.net/htt1asl.js): Adobe Fonts binaries are licensed to the kit owner and served only to the kit's allow-listed domains; they are not redistributable in a repo, and Adobe serves them independently of Webflow (plan D8). The kit's CSS is captured, so the family, weight and style list survives.
- `https://use.typekit.net/af/3df5fe/000000000000000000010b5b/27/` (from files/use.typekit.net/htt1asl.js): Adobe Fonts binaries are licensed to the kit owner and served only to the kit's allow-listed domains; they are not redistributable in a repo, and Adobe serves them independently of Webflow (plan D8). The kit's CSS is captured, so the family, weight and style list survives.
- `https://use.typekit.net/af/1709eb/000000000000000000010b60/27/` (from files/use.typekit.net/htt1asl.js): Adobe Fonts binaries are licensed to the kit owner and served only to the kit's allow-listed domains; they are not redistributable in a repo, and Adobe serves them independently of Webflow (plan D8). The kit's CSS is captured, so the family, weight and style list survives.
- `https://use.typekit.net/af/65fc7d/000000000000000000010b61/27/` (from files/use.typekit.net/htt1asl.js): Adobe Fonts binaries are licensed to the kit owner and served only to the kit's allow-listed domains; they are not redistributable in a repo, and Adobe serves them independently of Webflow (plan D8). The kit's CSS is captured, so the family, weight and style list survives.
- `https://use.typekit.net/af/ba2099/000000000000000000010b58/27/` (from files/use.typekit.net/htt1asl.js): Adobe Fonts binaries are licensed to the kit owner and served only to the kit's allow-listed domains; they are not redistributable in a repo, and Adobe serves them independently of Webflow (plan D8). The kit's CSS is captured, so the family, weight and style list survives.
- `https://use.typekit.net/af/1ece10/000000000000000000010b59/27/` (from files/use.typekit.net/htt1asl.js): Adobe Fonts binaries are licensed to the kit owner and served only to the kit's allow-listed domains; they are not redistributable in a repo, and Adobe serves them independently of Webflow (plan D8). The kit's CSS is captured, so the family, weight and style list survives.
- `https://use.typekit.net/af/8dd886/000000000000000000010b5c/27/` (from files/use.typekit.net/htt1asl.js): Adobe Fonts binaries are licensed to the kit owner and served only to the kit's allow-listed domains; they are not redistributable in a repo, and Adobe serves them independently of Webflow (plan D8). The kit's CSS is captured, so the family, weight and style list survives.
- `https://use.typekit.net/af/441f33/000000000000000000010b5d/27/` (from files/use.typekit.net/htt1asl.js): Adobe Fonts binaries are licensed to the kit owner and served only to the kit's allow-listed domains; they are not redistributable in a repo, and Adobe serves them independently of Webflow (plan D8). The kit's CSS is captured, so the family, weight and style list survives.
- `https://use.typekit.net/af/cef9f3/000000000000000000010b5e/27/` (from files/use.typekit.net/htt1asl.js): Adobe Fonts binaries are licensed to the kit owner and served only to the kit's allow-listed domains; they are not redistributable in a repo, and Adobe serves them independently of Webflow (plan D8). The kit's CSS is captured, so the family, weight and style list survives.
- `https://use.typekit.net/af/2a72d2/000000000000000000010b5f/27/` (from files/use.typekit.net/htt1asl.js): Adobe Fonts binaries are licensed to the kit owner and served only to the kit's allow-listed domains; they are not redistributable in a repo, and Adobe serves them independently of Webflow (plan D8). The kit's CSS is captured, so the family, weight and style list survives.
- `https://challenges.cloudflare.com/turnstile/v0/api.js` (from files/cdn.prod.website-files.com/646d47bfeb53b0308e8d4379/js/williamson-construction.99e4c217.a30679300c1e0808.js): Cloudflare Turnstile is a live service that webflow.js loads for the form backend, not a file: a copy would not run, and the rebuild uses the fleet's own Turnstile widget.

## Failed

None.
