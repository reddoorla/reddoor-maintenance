# Header-image generator — design

**Date:** 2026-07-31
**Status:** approved design, pending implementation plan

## Problem

Every report email opens with a per-site "Header image": a 2400×3200 JPEG built by
hand in Figma from a desktop screenshot of the site's homepage. Two costs follow
from it being manual:

1. **It blocks sends.** `preflight` fails a site with `header-image-missing` —
   "no Header image on the Websites row — the send will throw". 1836dig launched
   2026-07-31 and cannot be sent a Launch report until one exists. **34 of 44**
   Airtable rows have no header image at all.
2. **It goes stale.** The image is made once and never revisited. Sonder runs
   Monthly maintenance + Quarterly testing = **16 reports/year**; by the 16th, the
   laptop in the header shows a homepage that may be a year out of date.

## Goals

- Generate a site's header image from its live homepage with no manual Figma step.
- Regenerate automatically when a report is drafted, so the screenshot always
  matches the period being reported.
- Backfill the 34 sites that have none.

## Non-goals

- Changing the template design. Output must be indistinguishable from the 10
  existing hand-made headers.
- Per-report-type variants. See "One plate" below.
- Replacing the operator's approval step.

## Decisions

### One plate, maintenance wording

Airtable's `Header image` field holds exactly one attachment per site, and
`resolveCopy` does not vary by report type — the Launch email renders its own
`launchHeading: "LAUNCHED"` / `launchBody` as HTML. Every existing header reads
"Your website maintenance is complete." and is reused across Maintenance, Testing,
Launch and Announcement sends.

We keep that exactly as-is. Per-type plates would require a schema change; there
is no evidence the current behavior is a problem.

### Bundled plate + sharp compositing

The plate is a committed binary asset; compositing runs offline with `sharp`
(already a dependency at `^0.35.0`). Rejected alternatives:

- **Figma API at generate time** — needs a token in CI, network access, and a
  stable file/node-id contract; breaks silently if someone edits the file.
- **Rebuild the plate in HTML/CSS + Playwright** — re-creates the paper texture
  and typography by hand, with real risk of visible drift.

### Regenerate at draft time

Measured cost per header:

| Step                                    | Cost                                      |
| --------------------------------------- | ----------------------------------------- |
| Capture, warm browser (shared instance) | ~4.3 s                                    |
| Capture, cold launch                    | ~5.9 s                                    |
| Composite + JPEG encode                 | 184 ms                                    |
| Output size                             | 0.67 MB (hand-made originals are ~2.4 MB) |

Against the live Airtable frequencies — 14 live sites, **57 reports/year**:

- **Draft-time regeneration: 57 captures/year ≈ 4 minutes of compute per year.**
- Nightly-for-everyone: 5,110 captures/year, 90× the work for no extra freshness.

For scale, one `fleet-lighthouse` sweep already runs ~48 minutes.

Draft time is also where review already happens: the draft flow renders the email,
uploads a `Rendered HTML` preview attachment, and sets `draftReady`, and every
pending-approval gate blocks the send until the operator approves. A regenerated
header is therefore seen by a human before it can reach a client — the operator
confirmed they read the HTML preview before sending.

## Architecture

New module `src/reports/header-image/`, sibling to `maintenance-email/`:

| File               | Responsibility                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `capture.ts`       | Playwright → homepage PNG, 1600×1000 @2×. Browser IO injected behind an interface so tests use a fake, mirroring `src/audits/form-e2e.ts`. |
| `geometry.ts`      | Plate constants: screen rect, domain-text baseline/size/color. Pure data.                                                                  |
| `compose.ts`       | Pure. `(plate, screenshot, domain) → JPEG bytes`. sharp resize + `composite()`; domain text as an SVG layer.                               |
| `index.ts`         | Orchestrates capture → compose.                                                                                                            |
| `assets/plate.png` | The empty 2400×3200 plate.                                                                                                                 |

`compose.ts` is deliberately pure and separately testable — it is where fidelity
lives, and it must be verifiable without a browser or a network.

### Capture parameters

- Viewport 1600×1000 (16:10, matching the MacBook Pro screen), `deviceScaleFactor: 2`
  so the 2400px-wide plate stays crisp.
- `waitUntil: "networkidle"`, then `document.fonts.ready`, then a **2500 ms** settle
  delay — the value used for the measured captures above, overridable per site.
- Viewport screenshot, **not** `fullPage` — the mockup shows a screen, not a scroll.
- A `--delay` escape hatch: entrance animations and consent gates vary per site and
  one timing will not fit all 44.

Non-16:10 homepages are cropped to fill from the top (`fit: "cover", position: "top"`),
never distorted.

## The plate

The Figma source is `Web-Maintenance-Email`, file key `mQ3hy2d9JnOG9ljCzbZS8j`,
frame `158:10` "Header" — 600×800 design units, exported at 4× for 2400×3200.

Frame structure:

| Node   | Name                          | Design-unit box |
| ------ | ----------------------------- | --------------- |
| 158:11 | Mask group (paper background) | 0,0 600×800     |
| 158:16 | Red door logo                 | 70,69 81×58     |
| 158:15 | Headline text                 | 70,244 460×180  |
| 158:17 | Frame 5 (MacBook mockup)      | 31,464 424×257  |
| 158:14 | Domain text                   | 70,739 461×24   |

**The Figma file contains no empty laptop frame.** `download_assets` returns the
mockup as a pre-flattened 4096×2836 PNG with a site screenshot already baked in —
the designer composites the laptop elsewhere and drops in a raster. The plate must
therefore be _constructed_: take the mockup asset, blank its screen region, and
lay it onto the background + logo + headline.

### Open measurement: the screen rect

Diffing two real headers (Sonder vs Data Dynamiq) isolates the per-site content and
confirms the rest of the template is byte-stable — only **17.5% of the canvas**
differs, in exactly two bands:

- laptop band `x=137 y=1845 w=1675 h=1020`
- domain text `x=283 y=2962 w=646 h=75`

The laptop band is the whole mockup, not the screen. Attempts to tighten it landed
at aspect ratios of 1.40–1.64 rather than the expected 1.60, because the mockup
PNG's own aspect (4096×2836 = 1.444) does not match its Figma frame (424×257 = 1.650),
so the fit mode still has to be resolved. Compositing into the un-tightened band
overwrites the laptop chassis.

**This is the first implementation task**, and it has an objective acceptance test:

> Regenerate Sonder's header from Sonder's own live homepage. Diff against the
> existing `sonderHeader.jpg`. Every pixel outside the screen rect and the domain
> text must be identical.

Measure against the clean 4096×2836 mockup PNG (no JPEG artifacts, alpha channel
present) rather than against compressed headers.

## Asset delivery

`src/reports/maintenance-email/assets/index.ts` documents a regression that shipped
in **0.10.0–0.10.1**: tsup inlines the asset loader into `dist/cli/bin.js`, so
`import.meta.url` sibling resolution looks in `dist/cli/` and fails with ENOENT —
and **dev tests still pass**, because vitest evaluates the source file where
`import.meta.url` is already correct.

The plate must reuse that same walk-up loader, which probes both the `src/` and
`dist/` layouts. Two further traps:

- `tsup.config.ts`'s `onSuccess` hook copies assets **by explicit filename**. The
  plate must be added there or it never reaches `dist/`.
- `package.json#files` is `["dist", "README.md"]`, so a missed copy ships a package
  that throws on first use.

`pnpm test:dist` is therefore a required gate, not optional.

## Integration

- **Draft path** — regenerate before rendering, so the preview and the send agree.
  A capture or compose failure must **not** fail the draft: log and fall back to the
  existing Airtable image, exactly as the launch recipe already tolerates a
  preview-upload hiccup.
- **CLI** — `reddoor-maint header-image <site>` writes a local JPEG for inspection;
  `--write-airtable` uploads via the existing `uploadAttachment`; `--all` backfills
  the 34 sites without one.

### Guard

Replace the stored image only when the new capture passes a cheap sanity check:
correct dimensions, and not a single flat color (a blank or mid-animation shot).
On failure, keep the previous image and warn. The operator's preview review is the
primary gate; this only stops an obviously broken capture from overwriting a good
asset.

## Testing

| Layer        | Approach                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `compose.ts` | Golden-image test: fixture screenshot + plate → assert dimensions and sampled pixels at known offsets. |
| `capture.ts` | Fake browser IO; assert viewport, scale factor and wait sequence.                                      |
| Fidelity     | The Sonder round-trip diff described above.                                                            |
| Packaging    | `pnpm test:dist` — proves the plate resolves from `dist/`.                                             |

## Risks

| Risk                                             | Mitigation                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| Screen-rect geometry still unmeasured            | First task, with a pixel-diff acceptance test.                     |
| Bundled asset missing from `dist/`               | Reuse the walk-up loader; add to `onSuccess`; gate on `test:dist`. |
| Capture catches a cookie banner or mid-animation | `--delay` escape hatch; flat-image guard; operator preview review. |
| Adds ~2.4 MB of binary to the repo               | One-time; the plate replaces per-site manual exports.              |

## Follow-up, out of scope

Regenerating a header does not refresh `Rendered HTML` previews already attached to
older report rows. Those are historical records and should stay as sent.
