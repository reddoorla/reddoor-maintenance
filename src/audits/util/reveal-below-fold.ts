/// <reference lib="dom" />
// Runs IN THE PAGE, not in Node: the a11y audit serializes this function into
// its generated Playwright spec with `Function.prototype.toString()`, and the
// spec hands it to `page.evaluate`, which serializes it again. So it has to be
// self-contained — no import, no module-scope identifier, no named helper
// (a bundler's keep-names shim would reference a `__name` that exists in
// neither the spec nor the page). Types are erased before either trip.

/** What one pass did. Returned so the caller can see that the page actually
 *  scrolled, instead of inferring it from the absence of a hidden element. The
 *  generated spec writes it into the audit artifact, and the summary names any
 *  route whose pass was incomplete. */
export type RevealPass = {
  /** Scroll positions visited, the top included. 1 means the page could not scroll. */
  steps: number;
  /** The step, in CSS px: half the viewport height. */
  stepPx: number;
  /** True when the pass stopped at its step cap before reaching the bottom. */
  capped: boolean;
  /** `document.documentElement.scrollHeight` when the pass finished. */
  scrollHeight: number;
  /** `window.scrollY` after the return to the top. 0 unless the page fought it. */
  finalScrollY: number;
  /** Finite animations still running when the settle budget ran out. */
  unsettled: number;
};

/**
 * Scroll the page top to bottom, return to the top, and let every
 * scroll-triggered reveal settle — so axe measures below-the-fold content in
 * the state a reader sees, not the hidden state it waits in (#100).
 *
 * The generated spec used to navigate and run axe at `scrollY = 0`. Anything a
 * `use:animateIn`-style action hides until it first intersects the viewport was
 * still at an inline `opacity: 0` when axe ran, and axe does not measure
 * contrast through `opacity: 0` — the text drops out of `color-contrast`
 * entirely, or comes back `incomplete`, and the gate only fails on violations.
 * The injected `transition:none` sheet could not help: there was no transition
 * to snap, because nothing had asked the element to reveal.
 *
 * Choices, each forced by a way the simpler version is wrong. Each is held by
 * a mutation in tests/audits/a11y-live-spec.test.ts — undo it and a named test
 * there goes red — EXCEPT where a bullet says otherwise. Two things are not
 * held: the exact length of the waits (two frames and a task is a margin; one
 * frame, or two without the task, also passes today), and the 400-step cap
 * (reaching it takes a page some 200 screens tall, so `capped` is held by unit
 * tests on the summary only).
 *
 *   - **Half-viewport steps, not whole ones.** A reveal observed with a negative
 *     bottom `rootMargin` (`"0px 0px -25% 0px"` is common) only counts the top
 *     75% of the viewport. Whole-viewport steps leave the bottom quarter of
 *     every screen unobserved at every stop, so a short element sitting in that
 *     band never reveals. Half steps cover any bottom margin down to -50%.
 *   - **`behavior: "instant"` on every scroll.** Sites set `scroll-behavior:
 *     smooth` on `html` for readers who have not asked for reduced motion, and
 *     the audit does not emulate reduced motion. A plain `scrollTo(0, y)`
 *     animates, and each call retargets the last, so the viewport never
 *     reaches the reveals at all.
 *   - **The page height is re-read every step.** A reveal can lengthen the
 *     page as it is scrolled; a height read once stops short of what it added.
 *   - **Back to the top before axe.** A header that changes once scrolled, or a
 *     fixed element that would overlap content at some other offset, is then
 *     measured where the old audit measured it.
 *   - **A wait at every stop.** IntersectionObserver entries are computed
 *     during a rendering update and delivered in a task after it, so a stop's
 *     reveals have run only once both have passed. Deleting the wait is held;
 *     its length (two frames and a task) is a margin, not held.
 *   - **Settle last, in a loop.** CSS transitions are already snapped, and CSS
 *     animations cancelled, by the spec's injected sheet, which must be added
 *     BEFORE this runs. What that sheet cannot reach is the Web Animations API,
 *     which Svelte 5 `in:`/`transition:` directives run on — and a Svelte intro
 *     with a `delay` runs a placeholder animation first and creates the real
 *     one in its `onfinish`. So the settle:
 *       - runs after the return to the top, which can start animations of its
 *         own;
 *       - re-reads the running animations after every wait, until none are
 *         left or the 5 s budget is spent;
 *       - yields past the current rendering update after each wait before it
 *         looks again, because `onfinish` is dispatched at the next rendering
 *         update, after the `finished` promise the wait resolved on. Deleting
 *         the yield is held; its length (two frames and a task) is a margin,
 *         not held;
 *       - waits on finite animations only, so an infinite one (a marquee)
 *         cannot eat the budget.
 *
 * Not covered, and audited hidden exactly as before:
 *
 *   - a reveal that toggles both ways — hidden again when it leaves the
 *     viewport — is hidden again by the return to the top;
 *   - a CSS-keyframe reveal whose visible end state exists only as its
 *     `forwards` fill, because the spec's `animation:none!important` cancels
 *     the animation and leaves the element at its hidden base style;
 *   - a reveal delayed by a bare `setTimeout`, which no animation list shows;
 *   - a page that scrolls an inner container instead of the window.
 */
export async function revealBelowFold(): Promise<RevealPass> {
  const maxSteps = 400;
  const settleBudgetMs = 5000;
  const root = document.documentElement;
  const stepPx = Math.max(1, Math.floor(window.innerHeight / 2));

  let steps = 0;
  let reachedBottom = false;
  for (let y = 0; steps < maxSteps; y += stepPx) {
    window.scrollTo({ top: y, left: 0, behavior: "instant" });
    steps += 1;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))),
    );
    if (y + window.innerHeight >= root.scrollHeight) {
      reachedBottom = true;
      break;
    }
  }

  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))),
  );

  const deadline = performance.now() + settleBudgetMs;
  let unsettled = 0;
  for (;;) {
    const running = document.getAnimations().filter((animation) => {
      if (animation.playState !== "running" || animation.effect === null) return false;
      return Number.isFinite(Number(animation.effect.getComputedTiming().endTime));
    });
    if (running.length === 0) break;
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      unsettled = running.length;
      break;
    }
    await Promise.race([
      Promise.all(running.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, remaining)),
    ]);
    // An animation's `onfinish` can start the next one (a delayed Svelte
    // intro does exactly that), so let it run before looking again.
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))),
    );
  }

  return {
    steps,
    stepPx,
    capped: !reachedBottom,
    scrollHeight: root.scrollHeight,
    finalScrollY: window.scrollY,
    unsettled,
  };
}
