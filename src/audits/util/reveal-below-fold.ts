/// <reference lib="dom" />
// Runs IN THE PAGE, not in Node: the a11y audit serializes this function into
// its generated Playwright spec with `Function.prototype.toString()`, and the
// spec hands it to `page.evaluate`, which serializes it again. So it has to be
// self-contained — no import, no module-scope identifier, no named helper
// (a bundler's keep-names shim would reference a `__name` that exists in
// neither the spec nor the page). Types are erased before either trip.

/** What one pass did. Returned so the caller can see that the page actually
 *  scrolled, instead of inferring it from the absence of a hidden element. */
export type RevealPass = {
  /** Scroll positions visited, the top included. 1 means the page could not scroll. */
  steps: number;
  /** The step, in CSS px: half the viewport height. */
  stepPx: number;
  /** `document.documentElement.scrollHeight` when the pass finished. */
  scrollHeight: number;
  /** `window.scrollY` after the return to the top. 0 unless the page fought it. */
  finalScrollY: number;
  /** Finite animations still running when the settle budget ran out. */
  unsettled: number;
};

/**
 * Scroll the page top to bottom, let every scroll-triggered reveal fire and
 * settle, then return to the top — so axe measures below-the-fold content in the
 * state a reader sees, not the hidden state it waits in (#100).
 *
 * The generated spec used to navigate and run axe at `scrollY = 0`. Anything a
 * `use:animateIn`-style action hides until it first intersects the viewport was
 * still at an inline `opacity: 0` when axe ran, and axe does not measure
 * contrast through `opacity: 0` — the text drops out of `color-contrast`
 * entirely, or comes back `incomplete`, and the gate only fails on violations.
 * The injected `transition:none` sheet could not help: there was no transition
 * to snap, because nothing had asked the element to reveal.
 *
 * Four choices, each forced by a way the simpler version is wrong:
 *
 *   - **Half-viewport steps, not whole ones.** A reveal observed with a negative
 *     bottom `rootMargin` (`"0px 0px -25% 0px"` is common) only counts the top
 *     75% of the viewport. Whole-viewport steps leave the bottom quarter of
 *     every screen unobserved at every stop, so a short element sitting in that
 *     band never reveals. Half steps cover any bottom margin down to -50%.
 *   - **`behavior: "instant"` on every scroll.** Sites set `scroll-behavior:
 *     smooth` on `html` for readers who have not asked for reduced motion, and
 *     the audit does not emulate reduced motion. A plain `scrollTo(0, y)` would
 *     animate, so the viewport would lag the loop and the final return to the
 *     top would still be travelling when axe ran.
 *   - **The page height is re-read every step.** Reveals and lazy media can
 *     lengthen the page as it is scrolled; a height read once stops short.
 *   - **Two frames and a task per step.** IntersectionObserver entries are
 *     computed during a rendering update and delivered in a task after it, so
 *     the reveal for a given stop has run only once a second frame has started
 *     and a task has had its turn.
 *
 * Settling: CSS transitions and animations are already snapped by the spec's
 * injected sheet, which must be added BEFORE this runs. What that sheet cannot
 * reach is the Web Animations API — Svelte 5 `in:`/`transition:` directives run
 * on it — so this waits for every running finite animation to finish, bounded
 * at 5 s. An infinite one (a marquee) is not waited on. A reveal delayed by a
 * bare `setTimeout` is invisible to both and is not covered.
 *
 * The return to the top keeps everything else the old audit measured
 * unchanged: a header that changes once scrolled, or a fixed element that
 * would overlap content at some other offset, is measured where it was before.
 */
export async function revealBelowFold(): Promise<RevealPass> {
  const maxSteps = 400;
  const settleBudgetMs = 5000;
  const root = document.documentElement;
  const stepPx = Math.max(1, Math.floor(window.innerHeight / 2));

  let steps = 0;
  for (let y = 0; steps < maxSteps; y += stepPx) {
    window.scrollTo({ top: y, left: 0, behavior: "instant" });
    steps += 1;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))),
    );
    if (y + window.innerHeight >= root.scrollHeight) break;
  }

  const running = document.getAnimations().filter((animation) => {
    if (animation.playState !== "running" || animation.effect === null) return false;
    return Number.isFinite(Number(animation.effect.getComputedTiming().endTime));
  });
  if (running.length > 0) {
    await Promise.race([
      Promise.all(running.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, settleBudgetMs)),
    ]);
  }
  const unsettled = running.filter((animation) => animation.playState === "running").length;

  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))),
  );

  return {
    steps,
    stepPx,
    scrollHeight: root.scrollHeight,
    finalScrollY: window.scrollY,
    unsettled,
  };
}
