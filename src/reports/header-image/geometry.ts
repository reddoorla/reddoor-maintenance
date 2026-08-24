// Measured off the real plate, not guessed.
//
// SCREEN is the hole INSIDE the laptop bezel. It is derived from the bezel —
// a perfectly flat black frame (luminance 0.0) — because that is
// content-independent. Deriving it from content instead (diffing two headers for
// pixels that vary) yields x=282 y=1856 w=1394 h=871, which is WRONG: that rect
// spans the laptop's outer panel, covering the bezel on three sides while
// falling ~29px short at the bottom, so the plate's baked-in screenshot shows
// as a strip under every site's content.
//
// Cross-checked: the photo-to-flat-black transition at the bottom of the plate
// lands at y=2756, exactly SCREEN.y + SCREEN.h - 1.
//
// Re-measure only if the Figma template changes — and if you do, find the bezel.

/** The plate's pixel dimensions — Figma frame 600x800 exported at 4x. */
export const CANVAS = { width: 2400, height: 3200 } as const;

/** The MacBook Pro screen the site screenshot is pasted into — the area inside
 *  the bezel, so the bezel stays visible around the content exactly as it does
 *  in the hand-made headers. Aspect 1.5983 (16:10 to within 0.1%). */
export const SCREEN = { x: 302, y: 1913, w: 1349, h: 844 } as const;

/** Where a report-type headline overlay lands on the clean plate.
 *
 *  Measured, not guessed: red ink present in the baked maintenance plate but
 *  absent from plate-clean spans x=277 y=998 w=1326 h=658 — and
 *  headline-maintenance.png is that ink box cropped to its own edges
 *  (1328x660, ±1px of anti-aliasing at the threshold), so compositing the
 *  asset at this origin reproduces the baked plate's headline exactly. */
export const HEADLINE = { x: 277, y: 998 } as const;

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
