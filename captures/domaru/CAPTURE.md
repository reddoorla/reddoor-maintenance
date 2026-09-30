# Webflow capture: https://www.domaruhealthsupply.com

Captured 2026-09-30T00:38:13.506Z by `scripts/webflow-capture/capture.mjs`. Webflow site id `61817e584460db988c9333a4`.

Every page reachable by same-origin links from `/`, and every file those pages load, recursively
(stylesheet `url()`s, runtime script loads, Lottie images), byte for byte and unrewritten.
`manifest.json` maps each URL to its file with its sha256. Re-prove it offline with
`node scripts/webflow-capture/check.mjs <this directory>`.

**7 pages, 121 files, 17.6 MB. 2 excluded, 0 failed to download. Check: PASS (121 present, 0 failures).**

## Pages

| path        | bytes |
| ----------- | ----- |
| `/`         | 34025 |
| `/about`    | 14191 |
| `/contact`  | 34149 |
| `/faq`      | 19661 |
| `/privacy`  | 30043 |
| `/products` | 33593 |
| `/services` | 13739 |

## Files by type

| type  | files |
| ----- | ----- |
| png   | 56    |
| svg   | 30    |
| json  | 12    |
| woff2 | 6     |
| js    | 3     |
| eot   | 3     |
| ttf   | 3     |
| woff  | 3     |
| jpeg  | 2     |
| css   | 2     |
| ico   | 1     |

## Files by host

| host                          | files |
| ----------------------------- | ----- |
| cdn.prod.website-files.com    | 98    |
| assets.website-files.com      | 15    |
| d3e54v103j8qbb.cloudfront.net | 3     |
| fonts.gstatic.com             | 3     |
| ajax.googleapis.com           | 1     |
| fonts.googleapis.com          | 1     |

## Excluded (not vendored, on purpose)

- `https://www.google.com/recaptcha/api.js` (from /, /about, /contact, /faq, /privacy): reCAPTCHA is a live Google service, not a file: a copy would not run, and Google serves it independently of Webflow.
- `https://cdn.embedly.com/widgets/media.html?src=https%3A%2F%2Fwww.youtube.com%2Fembed%2FNpEaa2P7qZI%3Ffeature%3Doembed&display_name=YouTube&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DNpEaa2P7qZI&image=https%3A%2F%2Fi.ytimg.com%2Fvi%2FNpEaa2P7qZI%2Fhqdefault.jpg&key=c4e54deccf4d4ec997a64902e9a30300&type=text%2Fhtml&schema=youtube` (from /about): a video-platform embed: the video is hosted by the platform (the embed URL names it), not by Webflow, so it survives the cancellation.

## Failed

None.
