---
"@reddoorla/maintenance": patch
---

fix(blux): capture a `<video>`'s CDN base from its `src` so videos resolve
offline like images. Previously a video parsed with only assetId+ext (no
`base`), so `mediaCdnUrl` returned null and the video resolved solely via the IR
sourceUrl — i.e. it depended on site.json listing the asset, breaking convert's
offline invariant even though the full url sits on `<video src>`. The parser now
records the src prefix as `base`, so `blux convert`/`blux validate` resolve
the-pointe's hero video (and any `<video>`) from the markup alone, with no
site.json asset entry.
