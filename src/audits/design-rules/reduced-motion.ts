/// <reference lib="dom" />
import type { Page } from "@playwright/test";
import type { DesignRule, RuleFinding, RuleOutcome } from "./types.js";

// R2 in docs/design-review-rules-2026-09.md: all motion honours
// `prefers-reduced-motion`. Durations AND delays go to zero, JS/WAAPI motion is
// included, and the page lands on its final frame.
//
// Under an emulated `reduce`, the page is sampled at the top, at every
// half-viewport scroll step, and back at the top. A sample fails on:
//
//   - a computed `animation-delay` or `transition-delay` above 0 on any
//     element. A zero-length animation that still waits out its delay is
//     "nothing happens, then it pops" (reddoor-starter #135, ported from
//     beachfront-dentistry df53dee, whose reset zeroed durations only);
//   - a running animation of any kind (CSS animation, CSS transition, Web
//     Animations API) with more than RUNNING_FLOOR_MS left, or no end at all.
//     A reset's 0.01ms durations finish inside the floor; Svelte's JS
//     transitions, which the CSS reset never reaches, do not.
//
// Not covered: the one painted frame a zeroed Svelte transition can commit at
// t=0 (#135's `fly({ y: 22 })`), a scroll-driven animation's end state, and
// motion a page starts on a timer after the last sample.

/** Animations with less than this left are a reset's 0.01ms tail, not motion. */
export const RUNNING_FLOOR_MS = 20;

export type MotionSample = {
  /** `matchMedia("(prefers-reduced-motion: reduce)").matches` in the page. False
   *  means the emulation did not take, so nothing else in the sample counts. */
  reduceMatched: boolean;
  scrollY: number;
  delays: Array<{ target: string; property: "animation-delay" | "transition-delay"; ms: number }>;
  /** `remainingMs: null` is an animation with no end (infinite iterations). */
  running: Array<{ target: string; name: string; remainingMs: number | null }>;
};

/**
 * Runs IN THE PAGE through `page.evaluate`, so it follows revealBelowFold's
 * rules: self-contained, no import, no module-scope identifier, and no named
 * inner function (a keep-names shim would call a `__name` the page lacks).
 */
export function sampleReducedMotion(): MotionSample {
  const sample: MotionSample = {
    reduceMatched: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    scrollY: window.scrollY,
    delays: [],
    running: [],
  };
  // Elements with something to report, and what; target paths are built in
  // one loop at the end so the path code is written once.
  const pending: Array<
    | { el: Element; delay: MotionSample["delays"][number]["property"]; ms: number }
    | { el: Element | null; name: string; remainingMs: number | null }
  > = [];
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const style = getComputedStyle(el);
    const lists: Array<["animation-delay" | "transition-delay", string, boolean]> = [
      ["animation-delay", style.animationDelay, style.animationName !== "none"],
      ["transition-delay", style.transitionDelay, style.transitionProperty !== "none"],
    ];
    for (const [property, list, applies] of lists) {
      if (!applies) continue;
      let ms = 0;
      for (const part of list.split(",")) {
        const text = part.trim();
        const value = parseFloat(text) * (text.endsWith("ms") ? 1 : 1000);
        if (Number.isFinite(value) && value > ms) ms = value;
      }
      if (ms > 0) pending.push({ el, delay: property, ms });
    }
  }
  for (const animation of document.getAnimations()) {
    if (animation.playState !== "running" || animation.effect === null) continue;
    const timing = animation.effect.getComputedTiming();
    const end = Number(timing.endTime);
    const local = Number(timing.localTime ?? 0);
    const remainingMs = Number.isFinite(end) ? end - local : null;
    // 20 is RUNNING_FLOOR_MS; the page cannot see the module constant.
    if (remainingMs !== null && remainingMs <= 20) continue;
    const name =
      "animationName" in animation
        ? `animation ${String(animation.animationName)}`
        : "transitionProperty" in animation
          ? `transition ${String(animation.transitionProperty)}`
          : "Web Animation";
    const el = (animation.effect as KeyframeEffect).target ?? null;
    pending.push({ el, name, remainingMs });
  }
  for (const item of pending) {
    const parts: string[] = [];
    for (let node = item.el; node && parts.length < 4; node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`${part}#${node.id}`);
        break;
      }
      const classes = Array.from(node.classList).slice(0, 2);
      if (classes.length > 0) part += `.${classes.join(".")}`;
      parts.unshift(part);
      if (node === document.body) break;
    }
    const target = parts.length > 0 ? parts.join(" > ") : "(no target)";
    if ("delay" in item) sample.delays.push({ target, property: item.delay, ms: item.ms });
    else sample.running.push({ target, name: item.name, remainingMs: item.remainingMs });
  }
  return sample;
}

/** Fold the samples into R2's verdict. PURE. A finding seen at several scroll
 *  steps is reported once, with the largest delay or remaining time seen. */
export function summarizeReducedMotion(url: string, samples: MotionSample[]): RuleOutcome {
  const base = { rule: "R2" as const, url };
  if (samples.length === 0) {
    return { ...base, status: "unmeasured", findings: [], note: "no sample was taken" };
  }
  if (samples.some((s) => !s.reduceMatched)) {
    return {
      ...base,
      status: "unmeasured",
      findings: [],
      note: "prefers-reduced-motion: reduce did not match in the page, so the emulation did not take",
    };
  }
  const worst = new Map<string, { target: string; label: string; value: number }>();
  const keep = (target: string, label: string, value: number) => {
    const key = `${target}\u0000${label}`;
    const seen = worst.get(key);
    if (!seen || value > seen.value) worst.set(key, { target, label, value });
  };
  for (const s of samples) {
    for (const d of s.delays) keep(d.target, d.property, d.ms);
    for (const r of s.running) {
      keep(r.target, `running ${r.name}`, r.remainingMs ?? Number.POSITIVE_INFINITY);
    }
  }
  const findings: RuleFinding[] = [...worst.values()].map(({ target, label, value }) => ({
    target,
    problem: label.startsWith("running ")
      ? `${label.slice("running ".length)} still running under reduce (${
          Number.isFinite(value) ? `${Math.round(value)}ms left` : "no end"
        })`
      : `${label} ${Math.round(value)}ms under reduce`,
  }));
  const status = findings.length === 0 ? "pass" : "fail";
  return {
    ...base,
    status,
    findings,
    note: `${samples.length} samples under reduce; ${findings.length} finding(s)`,
  };
}

const STEP_CAP = 200;

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))),
      ),
  );
}

/** Load `url` (in a context that emulates `reduce`), then sample at the top,
 *  at every half-viewport step to the bottom, and back at the top. */
async function checkReducedMotion(page: Page, url: string): Promise<RuleOutcome> {
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  await settle(page);
  const samples: MotionSample[] = [await page.evaluate(sampleReducedMotion)];
  for (let step = 1; step <= STEP_CAP; step++) {
    // Half-viewport steps, as revealBelowFold takes, with the page height
    // re-read each time; the last step lands exactly on the bottom.
    const moved = await page.evaluate((n) => {
      const stepPx = Math.max(1, Math.floor(window.innerHeight / 2));
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      if ((n - 1) * stepPx >= maxY) return false;
      window.scrollTo({ top: Math.min(n * stepPx, maxY), left: 0, behavior: "instant" });
      return true;
    }, step);
    if (!moved) break;
    await settle(page);
    samples.push(await page.evaluate(sampleReducedMotion));
  }
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await settle(page);
  samples.push(await page.evaluate(sampleReducedMotion));
  return summarizeReducedMotion(url, samples);
}

export const reducedMotionRule: DesignRule = {
  id: "R2",
  title: "All motion honours prefers-reduced-motion",
  contextOptions: { reducedMotion: "reduce", viewport: { width: 1440, height: 900 } },
  check: checkReducedMotion,
};
