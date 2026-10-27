# Webflow capture: https://www.williamson-homes.com

Captured 2026-09-30T00:41:29.776Z by `scripts/webflow-capture/capture.mjs`. Webflow site id `645ec08251dadc9000a072e5`.

Every page reachable by same-origin links from `/`, and every file those pages load, recursively
(stylesheet `url()`s, runtime script loads, Lottie images), byte for byte and unrewritten.
`manifest.json` maps each URL to its file with its sha256. Re-prove it offline with
`node scripts/webflow-capture/check.mjs <this directory>`.

**10 pages, 429 files, 167.4 MB. 0 excluded, 0 failed to download. Check: PASS (429 present, 0 failures).**

## Pages

| path                           | bytes |
| ------------------------------ | ----- |
| `/`                            | 17888 |
| `/about-us`                    | 24315 |
| `/contact`                     | 11417 |
| `/projects`                    | 18144 |
| `/projects/hermosa-home-gym`   | 14358 |
| `/projects/manhattan-beach`    | 17887 |
| `/projects/palos-verdes-cove`  | 40691 |
| `/projects/palos-verdes-north` | 13641 |
| `/projects/palos-verdes-west`  | 17945 |
| `/projects/pv-malaga-cove`     | 22564 |

## Files by type

| type  | files |
| ----- | ----- |
| jpg   | 239   |
| jpeg  | 124   |
| woff2 | 30    |
| png   | 21    |
| svg   | 7     |
| js    | 6     |
| css   | 2     |

## Files by host

| host                          | files |
| ----------------------------- | ----- |
| cdn.prod.website-files.com    | 391   |
| fonts.gstatic.com             | 30    |
| d3e54v103j8qbb.cloudfront.net | 4     |
| ajax.googleapis.com           | 1     |
| cdn.jsdelivr.net              | 1     |
| fonts.googleapis.com          | 1     |
| raw.githack.com               | 1     |

## Excluded (not vendored, on purpose)

None.

## Failed

None.
