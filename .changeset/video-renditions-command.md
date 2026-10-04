---
"@reddoorla/maintenance": minor
---

`reddoor-maint video <input>` encodes a background-video master into the fleet's web renditions (a capped-height H.264 mp4 and VP9 webm, a 720p phone mp4 when the source is at least 720 tall, and a poster frame taken from the mp4 that plays), dropping audio from every output and printing a size and bitrate table from ffprobe. `--upload <prismic-repo>` then pushes each output to that repository's Prismic media library, deduped by filename, using only `PRISMIC_TOKEN_<REPO>`.
