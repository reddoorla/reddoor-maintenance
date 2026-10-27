// Measured off the real plate, not guessed.
//
// SCREEN is the hole INSIDE the laptop bezel. It is derived from the bezel —
// a perfectly flat black frame (luminance 0.0) — because that is
// content-independent. Deriving it from content instead (diffing two headers for
// pixels that vary) yields a rect that spans the laptop's outer panel, covering
// the bezel on three sides, so the plate's baked-in screenshot shows as a strip
// under every site's content.
//
// ⚠️ THIS RECT IS A PROPERTY OF THE PLATE ASSET, AND THE ASSET HAS MOVED ONCE.
// The values below were correct for `plate.png` (#476) and went stale when #570
// re-exported the Figma frame as `plate-clean.png` to drop the baked headline:
// the laptop moved 7px right and 26px up and grew slightly. Nothing re-measured
// SCREEN, so for three weeks every generated header left rows 1887..1912 and
// columns 1651..1655 of the plate UNPAINTED — and what showed through there was
// the Alamo Anatomy homepage baked into the export: a green nav bar with a
// "Contact Us" pill, across the top of all 13 maintained sites' headers, in
// client-facing maintenance reports. Found 2026-09-17 on 29 Navy's.
//
// Evidence that the old values were right for the old asset, and are wrong for
// this one — the hole measured by walking outward from the screen interior to
// the first flat-black run:
//
//   plate.png (#476)      x=302 y=1913 w=1349   ← dx=0  dy=0  dw=0  vs SCREEN
//   plate-clean.png       x=309 y=1887 w=1347   ← dx=-7 dy=26 dw=2
//
// The old cross-check in this comment said "the photo-to-flat-black transition
// at the bottom lands at y=2756, exactly SCREEN.y + SCREEN.h - 1". That is true
// of plate.png — y=2755 is photo, y=2756 is rgb(2,2,2), y=2757 is black — and
// false of plate-clean.png, where y=2756 sits 29 rows inside the bottom bezel's
// black run (2728..2775). A cross-check that still passes against the wrong file
// is not a cross-check, which is why the guard is now a test against the bundled
// asset (tests/reports/header-image/plate-geometry.test.ts) rather than a number
// in a comment. Re-export the plate and that test fails; it cannot go stale
// silently the way this paragraph did.
//
// Re-measure only if the Figma template changes — and if you do, find the bezel.

/** The plate's pixel dimensions — Figma frame 600x800 exported at 4x. */
export const CANVAS = { width: 2400, height: 3200 } as const;

/** The MacBook Pro screen the site screenshot is pasted into — the area inside
 *  the bezel, so the bezel stays visible around the content exactly as it does
 *  in the hand-made headers. Aspect 1.6017 (16:10 to within 0.11%).
 *
 *  Measured on plate-clean.png: content spans x 310..1655, y 1888..2727, with a
 *  single anti-aliased blend pixel on the outside of the left, top and bottom
 *  edges (x=309 rgb(5,10,8); y=1887 rgb(14,29,24); y=2727 rgb(27,50,74)). The
 *  rect INCLUDES those blend pixels deliberately: each one is part baked
 *  screenshot, so leaving it uncovered leaves a faint tinted line of the other
 *  site, while covering it repaints one pixel of bezel edge and is invisible. */
export const SCREEN = { x: 309, y: 1887, w: 1347, h: 841 } as const;

/** Where a report-type headline overlay lands on the clean plate.
 *
 *  Measured, not guessed: red ink present in the baked maintenance plate but
 *  absent from plate-clean spans x=277 y=998 w=1326 h=658 — and
 *  headline-maintenance.png is that ink box cropped to its own edges
 *  (1328x660, ±1px of anti-aliasing at the threshold), so compositing the
 *  asset at this origin reproduces the baked plate's headline exactly. */
export const HEADLINE = { x: 277, y: 998 } as const;

/** The band a headline occupies, sized to the WIDEST registered overlay
 *  (Testing, 1715x664). Used to detect a header that already carries a baked-in
 *  headline, so it can't be stamped a second time. Deliberately clear of the
 *  logo above (ends y≈506) and the laptop screen below (starts y=1887), so the
 *  only ink that can land here is a headline. */
export const HEADLINE_BAND = { x: HEADLINE.x, y: HEADLINE.y, w: 1715, h: 664 } as const;

/** The headline ink colour (brand red), and how far a pixel may drift from it
 *  and still count — JPEG re-encoding moves it by a level or two. */
export const HEADLINE_INK = { r: 209, g: 34, b: 62 } as const;

/** The per-site domain line, bottom left.
 *
 *  Solved against the hand-made reference rather than guessed: rendering
 *  "gallerysonder.com" with these values reproduces Sonder's original ink box
 *  (x=283 y=2963 w=645 h=74) EXACTLY — dx=0 dy=0 dw=0 dh=0. A sweep over sizes
 *  62-88 at weights 300/400 has a single exact solution at size 80 / weight 400.
 *
 *  `baseline` is the text baseline in canvas pixels; the ink box sits above it
 *  by the cap height and below by the descender. */
export const DOMAIN = {
  x: 280,
  baseline: 3020,
  size: 80,
  weight: 400,
  color: "#747474",
} as const;

/** Flat paper tone, used as the compositing background so a transparent or
 *  short source can never punch a hole in the plate. */
export const PAPER = "#fcfcfc" as const;
