---
"@reddoorla/maintenance": patch
---

Fix squished/distorted report header image. The reserve-space change in 0.18.0 set an explicit pixel `height` on the header `<mj-image>`, which MJML emits as `height:<px>` while keeping `width:100%` — so the height stayed locked while the width scaled, distorting the header at any rendered width other than the 600px design width (mobile, narrow reading panes). The header now stays `height:auto` (always proportional, never distorts) and reserves its vertical space via `aspect-ratio` in a head `<mj-style>` instead. Added a regression test asserting the header `<img>` uses `height:auto` and never a fixed pixel height.
