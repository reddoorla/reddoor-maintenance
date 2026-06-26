---
"@reddoorla/maintenance": patch
---

Report emails now hide the ANALYTICS block instead of rendering an empty "— Users" placeholder when there's no traffic data. The block appears only when there's something real to show — a GA user count or a page-1 search callout; a GA-less site that still ranks shows just the search line (no user count), and a site with neither drops the block (and its data-contextual SEO call-to-action) entirely. The announcement template's alternating band colors stay correct when the block is hidden (the dropped band no longer consumes a color slot).
