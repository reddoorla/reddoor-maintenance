// P1-87 PR 8a: the overview's motion. Durations are named here so the CSS (which reads them as
// custom properties set inline) and the tests share one number each.

/** Health bars: each fill runs this long, and each bar starts this much after the one before. */
export const BAR_MS = 600;
export const BAR_STAGGER_MS = 80;
/** The big numbers' count-up, and the sparklines' draw-in. */
export const COUNT_MS = 900;
export const SPARK_MS = 900;
/** A new feed line's slide-in. */
export const FEED_MS = 400;
/** No motion runs longer than this (the plan's five-second rule). */
export const MAX_MOTION_MS = 5000;

// One flag per document: the overview's intro (items 3 and 4) plays on a full load only.
let played = false;
export const introPlayed = (): boolean => played;
/** Called only from onMount, which never runs on the server: the server's module state is shared
 *  across requests, so a server-side call would switch the intro off for every later visitor. */
export const markIntroPlayed = (): void => {
  played = true;
};
