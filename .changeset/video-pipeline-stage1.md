---
"@reddoorla/maintenance": minor
---

Adds the R2 video pipeline's first stage: `--profile player` on `reddoor-maint video` keeps audio (AAC) and makes a 720 mp4 and a poster, and a new `reddoor-maint video-pipeline encode` and `stuck` encode a Prismic video master to Cloudflare R2 with a `manifest.json`, with Whisper captions for player videos. The light `@reddoorla/maintenance/video-pipeline` subpath holds the key, manifest, classification, webhook relay and stuck-video helpers for site code.
