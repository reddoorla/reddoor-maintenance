# Header image: resize + reserve space + placeholder

**Date:** 2026-06-01
**Status:** Approved

## Problem

The per-site report header image is a CID-embedded attachment in the MJML email. Real
example (ERP Industrials, `erpfunds.jpg`): **3.55 MB, 2400×3200**, rendered in a ~600px-wide
email body. Two symptoms:

1. **Slow to load** — the email ships ~16× more pixels than the 600px display needs.
2. **Reflow/jank** — the `<mj-image>` has no `height`, so content below jumps when the
   heavy image finally paints.

Plain JPEG-quality compression was rejected by the operator: the paper texture + in-image
text degrade visibly.

## Goals

- Cut the header's byte weight without visible quality loss (resize, not quality-crush).
- Reserve the image's box so nothing reflows on load.
- Show an intentional placeholder (matched color + alt text) while the image loads or if
  the client blocks images.

## Non-goals

- The local `previewOnly` HTML (`reports/<slug>/draft.html`). Its `cid:` header already
  does not render in a browser; unchanged here.
- Changing how/where headers are stored in Airtable.

## Design

### New module — `src/reports/maintenance-email/header-image.ts`

```
prepareHeaderImage(bytes, { displayWidth = 600 }) →
  { bytes, contentType, displayWidth, displayHeight, placeholderColor }
```

- Downscale with `sharp` to **2× displayWidth (1200px)** for retina crispness; JPEG q≈82;
  `withoutEnlargement: true` (never upscale a smaller source).
- Flatten any alpha onto **white** and output **JPEG** (headers are photographic;
  transparent-PNG headers are not expected — a white background is acceptable if one appears).
- Return **display** dimensions (source ÷ 2, aspect preserved per-site → no distortion).
- Return a **dominant color** hex via `sharp().stats()` for the placeholder box.

### Type — `src/reports/types.ts`

`ReportData` gains three optional fields:

- `headerWidth?: number` (display px, e.g. 600)
- `headerHeight?: number` (display px, e.g. 800)
- `headerBgColor?: string` (hex, e.g. `#cfc3a8`)

### Template — `src/reports/maintenance-email/template.ts`

When all three are present, the header renders:

```html
<mj-image href="{siteUrl}" src="cid:{cid}" width="{headerWidth}px" height="{headerHeight}px"
          alt="{siteName} maintenance report" container-background-color="{headerBgColor}" />
```

Explicit `height` reserves the box; `container-background-color` is the loading/blocked
placeholder; `alt` covers blocked-image clients. Absent the fields, it falls back to today's
bare `<mj-image href src />` (keeps preview + existing tests working).

### Send path — `src/reports/send/orchestrate.ts`

After `fetchAttachmentBytes(site.headerImage.url)`, pass the bytes through
`prepareHeaderImage`. Attach the **resized** bytes (not the original) and forward
`headerWidth`/`headerHeight`/`headerBgColor` into `renderReportHtml`.

## Dependency

Adds `sharp` (standard Node image library).

## Testing

- `prepareHeaderImage`: given a synthetic large image (generated via sharp), it (a) returns
  smaller bytes, (b) caps the source at 2× displayWidth without upscaling, (c) returns
  display dims with the source aspect ratio preserved, (d) returns a valid hex color.
- Template: when the three fields are present, the rendered HTML contains the explicit
  `height`, the `alt`, and the background color; when absent, output matches the bare
  fallback and still renders with no MJML warnings.

## Decisions locked

- 600px display / 1200px source. JPEG with white-flatten. (Operator confirmed; will eyeball
  the result.)
