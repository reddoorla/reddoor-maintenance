import type { CycleView } from "./cycle.js";

/**
 * P1-87 PR 5a: the nightly bar's clock (plan, "The clock"). Every minute it hands the
 * page the time, so the day marker moves like a clock hand (decision 2). While the
 * run may still be writing its record, it asks the server for the snapshot again
 * every 2 minutes, but only while the tab is visible and the view's `refresh` window
 * holds. Nothing here touches the DOM, so the page passes its own browser calls in.
 */

/** The marker's step, and how often the bar may re-read the snapshot. */
const TICK_MS = 60_000;
const REREAD_MS = 120_000;

export type CycleClockDeps = {
  /** Read on every tick, so a re-read's new `refresh` window applies at once. */
  getView: () => CycleView;
  nowMs: () => number;
  isVisible: () => boolean;
  /** Re-read the snapshot (the page's `invalidate("cockpit:snapshot")`). */
  invalidate: () => Promise<void>;
  /** The page recomputes the marker from the time it is given. */
  onTick: (nowMs: number) => void;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

/** Start the clock; `stop` removes its timer. */
export function startCycleClock(deps: CycleClockDeps): { stop: () => void } {
  let lastReadMs: number | null = null;
  let inFlight = false;

  const tick = () => {
    const now = deps.nowMs();
    deps.onTick(now);
    const { refresh } = deps.getView();
    const from = Date.parse(refresh.fromIso);
    const until = Date.parse(refresh.untilIso);
    if (!(from <= now && now < until)) return;
    if (!deps.isVisible() || inFlight) return;
    if (lastReadMs !== null && now - lastReadMs < REREAD_MS) return;
    lastReadMs = now;
    inFlight = true;
    deps
      .invalidate()
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
      });
  };

  const timer = deps.setInterval(tick, TICK_MS);
  return { stop: () => deps.clearInterval(timer) };
}
