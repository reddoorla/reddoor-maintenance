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
/** How long the intro (`data-intro`) stays on after the script runs: it covers the longest intro
 *  end (the last bar's unknown span, about 1.68 s for seven checks), so a later refresh never
 *  replays it on a node it inserts (P1-87 PR 8a, review round 1, F2). */
export const INTRO_MS = 2000;
/** The fail-safe's delay: after this long a figure the count never took shows at once (overview.css
 *  repeats the number in its `ov-failsafe` rule, which cannot import this). A count that starts
 *  after it is not run: the figure is already showing (P1-87 PR 8a, review round 1, C). */
export const FAILSAFE_MS = 2000;
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

/** P1-87 PR 8a, item 4: a figure the count-up may run on: digits, with thousands commas where they
 *  group. "not yet collected", "could not be read" and "—" are not figures, so they never count. */
export const countable = (s: string): boolean => /^\d+$/.test(s) || /^\d{1,3}(,\d{3})+$/.test(s);

const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const grouped = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** The count-up's text at progress `t` (0 to 1). It never shows a number above the model's, and
 *  at t >= 1 it is the model's own string, commas and all. */
export function countFrame(to: string, t: number): string {
  if (t >= 1) return to;
  const n = Number(to.replace(/,/g, ""));
  const v = Math.round(easeOut(Math.max(0, t)) * n);
  return to.includes(",") ? grouped(v) : String(v);
}

/** Counts a measured figure up from 0 once per document load. The figure's own text is Svelte's,
 *  so the action writes only `.ov-num-count` (empty at rest) and toggles attributes on the `p`.
 *  It runs only when `enabled` (the intro), the figure is countable, and motion is allowed;
 *  otherwise it marks the figure counted at once and does nothing else. */
export function countUp(
  node: HTMLElement,
  params: { to: string; enabled: boolean },
): { update(p: { to: string; enabled: boolean }): void; destroy(): void } {
  let to = params.to;
  let frame = 0;
  const digits = node.querySelector<HTMLElement>(".ov-num-count");
  const finish = () => {
    cancelAnimationFrame(frame);
    if (digits) digits.textContent = "";
    node.removeAttribute("data-counting");
    node.setAttribute("data-counted", "");
  };
  const motionAllowed = () => matchMedia("(prefers-reduced-motion: no-preference)").matches;
  // The skip compares time since navigation start with FAILSAFE_MS: a mount at or after that time
  // is not counted, since the figure may already show. The CSS fail-safe runs from its own style
  // start, a little later (about 0.46 s on a normal load), so a mount in that gap shows the figure
  // at once without a count; that is allowed, and the threshold is a separate round 2 item (r3).
  // (P1-87 PR 8a, review round 1, C; round 2, r3.)
  if (!(params.enabled && countable(to) && motionAllowed()) || performance.now() >= FAILSAFE_MS) {
    node.setAttribute("data-counted", "");
  } else {
    node.setAttribute("data-counting", "");
    // P1-87 minors, #2164: a page mounted hidden (a background tab) runs no frame until it is shown,
    // and its intro waits for the show; the count then starts at its first frame, so it runs with
    // the sparklines it is paired with instead of ending at once. A visible mount counts from now.
    let start =
      typeof document === "undefined" || document.visibilityState === "visible"
        ? performance.now()
        : null;
    const step = (now: number) => {
      start ??= now;
      const t = (now - start) / COUNT_MS;
      if (t >= 1) return finish();
      if (digits) digits.textContent = countFrame(to, t);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }
  return {
    update(p) {
      to = p.to;
      // A refresh to a value that is not a figure (a word) ends the count at once: no frame may
      // write it, and the figure shows its own words (P1-87 PR 8a, review round 1, F1).
      if (!countable(to)) finish();
      // The intro ended while the count ran (a page first shown with its view due a re-read ends
      // its intro at once, #2164): the count ends with it, as the sparklines do.
      else if (!p.enabled && node.hasAttribute("data-counting")) finish();
    },
    destroy() {
      if (node.hasAttribute("data-counting")) finish();
      cancelAnimationFrame(frame);
    },
  };
}

/** P1-87 PR 8a, item 5: a key on a focused trend. Returns the night it selects (`null`: none), or
 *  `undefined` when the key is not one the trend handles. Right and Left step one night and stop at
 *  the ends (no wrap). With no night selected the slider reports the newest, so the steps start from
 *  it: Right selects the newest, Left the one before it (round 2, H: Right never jumps to the oldest).
 *  Home and End go to the first and last nights, and Escape clears. */
export function trendKey(
  key: string,
  selected: number | null,
  count: number,
): number | null | undefined {
  if (key === "Escape") return null;
  if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(key)) return undefined;
  if (count === 0) return null;
  const last = count - 1;
  const from = selected ?? last;
  switch (key) {
    case "ArrowRight":
      return Math.min(from + 1, last);
    case "ArrowLeft":
      return Math.max(from - 1, 0);
    case "Home":
      return 0;
    default:
      return last;
  }
}

/** The readout's words for the selected night: that night's own title, as the chart's model wrote
 *  it, or nothing when no night is selected. */
export function trendReadout(titles: readonly string[], k: number | null): string {
  return k === null ? "" : (titles[k] ?? "");
}
