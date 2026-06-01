---
"@reddoorla/maintenance": minor
---

Report header images are now downscaled, dimensioned, and given a loading placeholder before send. Per-site headers in Airtable are often multi-MB / 2400px+ (the ERP Industrials header was 3.55 MB / 2400×3200) while the email renders them at ~600px — so the email shipped ~16× more pixels than the display could use, loaded slowly, and reflowed when it finally painted (the `<mj-image>` had no height).

The send path (`orchestrate.ts`) now runs each header through a new `prepareHeaderImage` (`src/reports/maintenance-email/header-image.ts`, backed by `sharp`): downscale to 2× the 600px display width for retina, re-encode JPEG q82 on a flat white background, never upscale. On the real ERP header this is a **93% byte reduction (3.39 MB → 239 KB)** with no visible quality loss — the cut is resolution the email can't display, not the quality compression that visibly degraded the paper texture and in-image text.

It also returns the display dimensions and a dominant-color placeholder, which the template now applies to the header `<mj-image>` (`width`/`height` to reserve the box and stop reflow, `container-background-color` as the loading/blocked placeholder, `alt` for blocked-image clients). When dimensions are absent (e.g. the local preview path) the header falls back to today's bare image. Adds `sharp` as a dependency.
