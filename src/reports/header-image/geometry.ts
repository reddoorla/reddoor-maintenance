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

/** The per-site domain line, bottom left. `baseline` is the text baseline in
 *  canvas pixels; `size` is the em size. Both derived from the measured ink box
 *  (x=283, y=2963, cap-to-descender 74px). */
export const DOMAIN = {
  x: 282,
  baseline: 3037,
  size: 62,
  color: "#747474",
} as const;

/** Flat paper tone, used as the compositing background so a transparent or
 *  short source can never punch a hole in the plate. */
export const PAPER = "#fcfcfc" as const;
