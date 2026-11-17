import type { CycleView } from "./cycle.js";

/**
 * P1-87 PR 5a: the nightly bar's clock (plan, "The clock"). Every minute it hands the
 * page the time, so the day marker moves like a clock hand (decision 2). It asks the
 * server for the snapshot again about every 2 minutes (every second tick, and at least
 * 90 s apart, so a tick made by the tab becoming visible can come sooner), but only while
 * the tab is visible and the view is due: inside its `refresh` window (the run may still be writing its record),
 * or past its `staleAfterIso` (the view was made for a moment that has passed, so a
 * fresh one is wanted, decision 5). A tab made visible ticks at once. Nothing here
 * touches the DOM, so the page passes its own browser calls in.
 */

/** The marker's step, and how often the bar may re-read the snapshot. */
const TICK_MS = 60_000;
const REREAD_MS = 120_000;
/** A browser's interval fires a few ms late, each tick by a different amount, so two ticks
 *  two minutes apart can measure just under 120 000 ms. Half a tick of slack lets such a
 *  tick re-read, so a jittered tick never skips one. */
const REREAD_JITTER_MS = TICK_MS / 2;

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
  // When the last re-read began. The gap runs from the start of a read, not from
  // its settle, so a slow read does not push the next one back a whole tick, and a read
  // that hangs never blocks the next one: nothing waits on a read's promise.
  let lastStartedMs: number | null = null;

  const tick = () => {
    const now = deps.nowMs();
    deps.onTick(now);
    const { refresh, staleAfterIso } = deps.getView();
    const from = Date.parse(refresh.fromIso);
    const until = Date.parse(refresh.untilIso);
    const due = (from <= now && now < until) || now >= Date.parse(staleAfterIso);
    if (!due) return;
    if (!deps.isVisible()) return;
    if (lastStartedMs !== null && now - lastStartedMs < REREAD_MS - REREAD_JITTER_MS) return;
    lastStartedMs = now;
    // A synchronous throw is a rejection too: a re-read never throws out of the tick, and
    // its outcome is not waited for.
    let done: Promise<void>;
    try {
      done = Promise.resolve(deps.invalidate());
    } catch (e) {
      done = Promise.reject(e);
    }
    done.catch(() => undefined);
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
