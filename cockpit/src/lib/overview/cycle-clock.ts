import type { CycleView } from "./cycle.js";

/**
 * P1-87 PR 5a: the nightly bar's clock (plan, "The clock"). Every minute it hands the
 * page the time, so the day marker moves like a clock hand (decision 2). It asks the
 * server for the snapshot again every 2 minutes, but only while the tab is visible and
 * the view is due: inside its `refresh` window (the run may still be writing its record),
 * or past its `staleAfterIso` (the view was made for a moment that has passed, so a
 * fresh one is wanted, decision 5). A tab made visible ticks at once. Nothing here
 * touches the DOM, so the page passes its own browser calls in.
 */

/** The marker's step, how often the bar may re-read the snapshot, and how long a re-read
 *  may stay unsettled before it counts as settled (its promise may never settle). */
const TICK_MS = 60_000;
const REREAD_MS = 120_000;
const READ_TIMEOUT_MS = 30_000;

export type CycleClockDeps = {
  /** Read on every tick, so a re-read's new view applies at once. */
  getView: () => CycleView;
  nowMs: () => number;
  isVisible: () => boolean;
  /** Runs `handler` on each change of the tab's visibility; returns the unlisten. */
  listenVisible: (handler: () => void) => () => void;
  /** Re-read the snapshot (the page's `invalidate("cockpit:snapshot")`). */
  invalidate: () => Promise<void>;
  /** The page recomputes the marker from the time it is given. */
  onTick: (nowMs: number) => void;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

/** Start the clock; `stop` removes its timer and its visibility listener. */
export function startCycleClock(deps: CycleClockDeps): { stop: () => void } {
  // The re-read in flight, by the time it began; and when the last one settled
  // (resolved, rejected, or timed out), which starts the 2-minute gap.
  let inFlight: { startedMs: number } | null = null;
  let lastSettledMs: number | null = null;
  const settle = (at: number) => {
    inFlight = null;
    lastSettledMs = at;
  };

  const tick = () => {
    const now = deps.nowMs();
    deps.onTick(now);
    if (inFlight !== null && now - inFlight.startedMs >= READ_TIMEOUT_MS) {
      settle(inFlight.startedMs + READ_TIMEOUT_MS);
    }
    const { refresh, staleAfterIso } = deps.getView();
    const from = Date.parse(refresh.fromIso);
    const until = Date.parse(refresh.untilIso);
    const due = (from <= now && now < until) || now >= Date.parse(staleAfterIso);
    if (!due) return;
    if (!deps.isVisible() || inFlight !== null) return;
    if (lastSettledMs !== null && now - lastSettledMs < REREAD_MS) return;
    const read = { startedMs: now };
    inFlight = read;
    // A synchronous throw is a rejection too: a re-read never throws out of the tick.
    let done: Promise<void>;
    try {
      done = Promise.resolve(deps.invalidate());
    } catch (e) {
      done = Promise.reject(e);
    }
    done
      .catch(() => undefined)
      .finally(() => {
        // A read that already timed out has been settled; its late answer is ignored.
        if (inFlight === read) settle(deps.nowMs());
      });
  };

  // Called bare: a browser's timers refuse a call on any object but the window.
  const { setInterval: every, clearInterval: cancel } = deps;
  const timer = every(tick, TICK_MS);
  // A tab made visible is looked at at once, not a minute later.
  const unlisten = deps.listenVisible(tick);
  return {
    stop: () => {
      cancel(timer);
      unlisten();
    },
  };
}
