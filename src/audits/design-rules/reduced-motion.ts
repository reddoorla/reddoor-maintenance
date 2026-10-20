/// <reference lib="dom" />
import type { Browser, BrowserContextOptions, Page } from "@playwright/test";
import { settle, withPage } from "./load.js";
import type { DesignRule, RuleFinding, RuleOutcome } from "./types.js";

// R2 in docs/design-review-rules-2026-09.md: all motion honours
// `prefers-reduced-motion`. Durations AND delays go to zero, JS/WAAPI motion is
// included, and the page lands on its final frame.
//
// Under an emulated `reduce`, at 1440×900 and at 390×844, the page is sampled
// at the top, at every half-viewport scroll step (of the window, or of the
// page's own scroller when the window cannot scroll), back at the top, and
// once more after MOTION_WAIT_MS. Same-origin iframes and open shadow roots
// are sampled with the page. A sample fails on:
//
//   - a computed `animation-delay`, `animation-duration`, `transition-delay`
//     or `transition-duration` above PERCEPTIBLE_MS, on an element or its
//     ::before/::after, read per animation name or transition property
//     (a list entry no name uses is ignored, as the browser ignores it) and
//     only for an animation name some readable `@keyframes` defines. A
//     zero-length animation that still waits out its delay is "nothing
//     happens, then it pops" (reddoor-starter #135, from beachfront df53dee);
//     a display:none menu is read too, because it will open;
//   - a running animation (CSS, transition or Web Animations API, which
//     Svelte's transitions run on and no CSS reset reaches) with more than
//     PERCEPTIBLE_MS left or no end, and a paused one short of its end;
//   - an element whose transform, translate, scale, rotate, opacity, left or
//     top changed across MOTION_WAIT_MS with no animation to account for it:
//     motion a script drives frame by frame (a tween, a spring, GSAP).
//
// Not covered: the single frame a zeroed Svelte transition can paint at t=0
// (#135's `fly({ y: 22 })`); scroll-driven animations, which are counted in
// the note and not judged (a reading-progress bar is size, not motion, and an
// end state needs a reference to compare with); closed shadow roots and
// cross-origin iframes, which a page cannot read (counted in the note); and
// motion a script starts after the last sample.

/** Below this, a delay, duration or remaining time is a reset's 0.01ms tail or
 *  a frame of rounding, not something a reader sees. */
export const PERCEPTIBLE_MS = 50;
/** How long the last sample waits, to see timer-started and scripted motion. */
export const MOTION_WAIT_MS = 1500;

export const REDUCED_MOTION_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

export type MotionItem = {
  target: string;
  /** "transition-delay", "animation-duration", "running animation spin", … */
  kind: string;
  /** The delay or duration, or the time left; null for an animation with no end. */
  ms: number | null;
};

export type MotionSample = {
  /** `matchMedia("(prefers-reduced-motion: reduce)").matches` in the page. False
   *  means the emulation did not take, so nothing else in the sample counts. */
  reduceMatched: boolean;
  items: MotionItem[];
  /** Scroll-driven animations seen; not judged. */
  scrollDriven: number;
};

/**
 * Runs IN THE PAGE through `page.evaluate`, so it follows revealBelowFold's
 * rules: self-contained, no import, no module-scope identifier, and no named
 * inner function (a keep-names shim would call a `__name` the page lacks).
 * Also returns, per element, the style values scripted motion would change,
 * for the caller to diff across MOTION_WAIT_MS.
 */
export function sampleReducedMotion(floorMs: number): MotionSample & {
  geometry: Record<string, string>;
} {
  const items: MotionItem[] = [];
  const geometry: Record<string, string> = {};
  let scrollDriven = 0;
  // Every root: the document and each open shadow root, found as we go.
  const roots: Array<Document | ShadowRoot> = [document];
  // Keyframe names some readable stylesheet defines; null once any sheet
  // could not be read (cross-origin), and then every name counts as defined.
  let keyframes: Set<string> | null = new Set<string>();
  // What to report, per element; target paths are built in one loop at the
  // end. A `geometry` entry carries motion-style values instead of a finding.
  const pending: Array<{
    el: Element;
    pseudo: string | null;
    kind: string;
    ms: number | null;
    geometry?: string;
  }> = [];

  for (let r = 0; r < roots.length; r++) {
    const root = roots[r]!;
    const sheets: CSSStyleSheet[] = [
      ...Array.from(root.styleSheets),
      ...Array.from(root.adoptedStyleSheets ?? []),
    ];
    const rules: CSSRule[] = [];
    for (const sheet of sheets) {
      try {
        rules.push(...Array.from(sheet.cssRules));
      } catch {
        keyframes = null;
      }
    }
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]!;
      if (rule instanceof CSSKeyframesRule) keyframes?.add(rule.name);
      else if ("cssRules" in rule) rules.push(...Array.from((rule as CSSGroupingRule).cssRules));
    }
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
      for (const pseudo of [null, "::before", "::after"]) {
        const style = getComputedStyle(el, pseudo);
        if (pseudo !== null && (style.content === "none" || style.content === "normal")) continue;
        const lists: Array<[string, string, string, string]> = [
          ["transition", style.transitionProperty, style.transitionDuration, style.transitionDelay],
          ["animation", style.animationName, style.animationDuration, style.animationDelay],
        ];
        for (const [family, namesText, durationsText, delaysText] of lists) {
          const names = namesText.split(",").map((s) => s.trim());
          const durations = durationsText.split(",").map((s) => s.trim());
          const delays = delaysText.split(",").map((s) => s.trim());
          let duration = 0;
          let delay = 0;
          for (let i = 0; i < names.length; i++) {
            const name = names[i]!;
            if (name === "none") continue;
            if (family === "animation" && keyframes !== null && !keyframes.has(name)) continue;
            // A shorter list repeats to the length of the name list.
            const d = durations[i % durations.length]!;
            const l = delays[i % delays.length]!;
            const dMs = parseFloat(d) * (d.endsWith("ms") ? 1 : 1000);
            const lMs = parseFloat(l) * (l.endsWith("ms") ? 1 : 1000);
            if (Number.isFinite(dMs) && dMs > duration) duration = dMs;
            if (Number.isFinite(lMs) && lMs > delay) delay = lMs;
          }
          if (duration > floorMs)
            pending.push({ el, pseudo, kind: `${family}-duration`, ms: duration });
          if (delay > floorMs) pending.push({ el, pseudo, kind: `${family}-delay`, ms: delay });
        }
      }
      // An element no animation accounts for, for the scripted-motion diff.
      if (el.getClientRects().length > 0 && el.getAnimations().length === 0) {
        const style = getComputedStyle(el);
        const values = [
          style.transform,
          style.translate,
          style.scale,
          style.rotate,
          style.opacity,
          style.left,
          style.top,
        ];
        pending.push({ el, pseudo: null, kind: "geometry", ms: null, geometry: values.join("|") });
      }
    }
  }

  for (const root of roots) {
    for (const animation of root.getAnimations()) {
      if (animation.effect === null) continue;
      if (animation.timeline !== null && !(animation.timeline instanceof DocumentTimeline)) {
        scrollDriven += 1;
        continue;
      }
      const timing = animation.effect.getComputedTiming();
      const end = Number(timing.endTime);
      const local = Number(timing.localTime ?? 0);
      const left = Number.isFinite(end) ? end - local : null;
      if (left !== null && left <= floorMs) continue;
      const name =
        "animationName" in animation
          ? `animation ${String(animation.animationName)}`
          : "transitionProperty" in animation
            ? `transition ${String(animation.transitionProperty)}`
            : "Web Animation";
      if (animation.playState !== "running" && animation.playState !== "paused") continue;
      const state = animation.playState;
      const effect = animation.effect as KeyframeEffect;
      if (effect.target) {
        pending.push({
          el: effect.target,
          pseudo: effect.pseudoElement,
          kind: `${state} ${name}`,
          ms: left,
        });
      } else items.push({ target: "(no target)", kind: `${state} ${name}`, ms: left });
    }
  }

  for (const item of pending) {
    // A path a reader can paste into querySelector: escaped classes, and the
    // :nth-of-type wherever a parent has more than one child of that tag.
    const parts: string[] = [];
    let node: Element | null = item.el;
    while (node && parts.length < 6) {
      const tag = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`${tag}#${CSS.escape(node.id)}`);
        break;
      }
      let part = tag;
      const classes = Array.from(node.classList).slice(0, 2);
      if (classes.length > 0) part += classes.map((c) => `.${CSS.escape(c)}`).join("");
      const parent: Element | null = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (node === document.body) break;
      if (parent) node = parent;
      else {
        const host: Element | null = (node.getRootNode() as ShadowRoot).host ?? null;
        if (host) parts.unshift("::shadow");
        node = host;
      }
    }
    const target = parts.join(" > ").replace(/ > ::shadow > /g, " ::shadow ") + (item.pseudo ?? "");
    if (item.geometry !== undefined) geometry[target] = item.geometry;
    else items.push({ target, kind: item.kind, ms: item.ms });
  }

  return {
    reduceMatched: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    items,
    scrollDriven,
    geometry,
  };
}

/** What one viewport's run saw, for the summary. */
export type MotionRun = {
  width: number;
  samples: MotionSample[];
  /** Elements whose motion styles changed across MOTION_WAIT_MS, unanimated. */
  scripted: string[];
  /** What was scrolled: "window", an element's path, or "nothing" (one screen). */
  scrolled: string;
  /** Child frames the page could not sample (cross-origin). */
  skippedFrames: number;
  /** True when the scroll stopped at STEP_CAP before the bottom. */
  capped?: boolean;
};

/** Fold the runs into R2's verdict. PURE. A finding seen at several steps or
 *  widths is reported once, at its worst, with the widths it was seen at. */
export function summarizeReducedMotion(url: string, runs: MotionRun[]): RuleOutcome {
  const base = { rule: "R2" as const, url };
  const samples = runs.flatMap((r) => r.samples);
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
  const worst = new Map<string, { target: string; kind: string; ms: number; widths: number[] }>();
  const keep = (width: number, target: string, kind: string, ms: number) => {
    const key = `${target}\u0000${kind}`;
    const seen = worst.get(key) ?? { target, kind, ms, widths: [] };
    if (ms > seen.ms) seen.ms = ms;
    if (!seen.widths.includes(width)) seen.widths.push(width);
    worst.set(key, seen);
  };
  for (const run of runs) {
    for (const s of run.samples) {
      for (const i of s.items) keep(run.width, i.target, i.kind, i.ms ?? Number.POSITIVE_INFINITY);
    }
    for (const target of run.scripted) keep(run.width, target, "scripted", 0);
  }
  // An animation inside its delay is also running; the delay finding already
  // names it, so the running one (whose time left varies) is folded into it.
  for (const [key, w] of worst) {
    const family = w.kind.startsWith("running animation ")
      ? "animation"
      : w.kind.startsWith("running transition ")
        ? "transition"
        : null;
    if (family && worst.has(`${w.target}\u0000${family}-delay`)) worst.delete(key);
  }
  const findings: RuleFinding[] = [...worst.values()].map(({ target, kind, ms, widths }) => {
    const at = ` (at ${widths.join(" and ")}px)`;
    const time = Number.isFinite(ms) ? `${Math.round(ms)}ms` : "no end";
    if (kind === "scripted") {
      return { target, problem: `moved by script under reduce, with no animation${at}` };
    }
    if (kind.startsWith("running ")) {
      return {
        target,
        problem: `${kind.slice(8)} still running under reduce (${Number.isFinite(ms) ? `${time} left` : time})${at}`,
      };
    }
    if (kind.startsWith("paused ")) {
      return { target, problem: `${kind.slice(7)} paused short of its end under reduce${at}` };
    }
    return { target, problem: `${kind} ${time} under reduce${at}` };
  });
  const scrollDriven = Math.max(0, ...samples.map((s) => s.scrollDriven));
  const skipped = Math.max(0, ...runs.map((r) => r.skippedFrames));
  const note =
    `${samples.length} samples under reduce at ${runs.map((r) => `${r.width}px`).join(" and ")}` +
    ` (scrolled ${[...new Set(runs.map((r) => r.scrolled))].join(", ")}); ${findings.length} finding(s)` +
    (scrollDriven > 0 ? `; ${scrollDriven} scroll-driven animation(s) not judged` : "") +
    (skipped > 0 ? `; ${skipped} cross-origin frame(s) not sampled` : "") +
    (runs.some((r) => r.capped) ? `; the scroll stopped at its ${STEP_CAP}-step cap` : "");
  return { ...base, status: findings.length === 0 ? "pass" : "fail", findings, note };
}

const STEP_CAP = 200;

/** One sample of the page and of every same-origin child frame. */
async function sampleAll(page: Page): Promise<MotionSample & { geometry: Record<string, string> }> {
  const top = await page.evaluate(sampleReducedMotion, PERCEPTIBLE_MS);
  const origin = new URL(page.url()).origin;
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    let frameOrigin: string;
    try {
      frameOrigin = new URL(frame.url()).origin;
    } catch {
      continue;
    }
    if (frameOrigin !== origin) continue;
    const inner = await frame.evaluate(sampleReducedMotion, PERCEPTIBLE_MS).catch(() => null);
    if (!inner) continue;
    const at = `iframe[src="${frame.url()}"] :: `;
    top.items.push(...inner.items.map((i) => ({ ...i, target: at + i.target })));
    top.scrollDriven += inner.scrollDriven;
    top.reduceMatched &&= inner.reduceMatched;
    for (const [k, v] of Object.entries(inner.geometry)) top.geometry[at + k] = v;
  }
  return top;
}

/** One viewport: top, every half-viewport step, back to the top, and a last
 *  sample after MOTION_WAIT_MS, diffed against the one before it. */
async function runAt(page: Page, width: number, waitMs: number): Promise<MotionRun> {
  await settle(page);
  const samples: MotionSample[] = [await sampleAll(page)];
  let scrolled = "nothing";
  let capped = true;
  for (let step = 1; step <= STEP_CAP; step++) {
    // Half-viewport steps, as revealBelowFold takes, with the height re-read
    // each time. When the window cannot scroll, the page's tallest scroller
    // (overflow-y auto or scroll) is stepped instead.
    const moved = await page.evaluate((n) => {
      const doc = document.documentElement;
      let box: Element | null = null;
      let maxY = doc.scrollHeight - window.innerHeight;
      if (maxY <= 0) {
        let best = 0;
        for (const el of Array.from(document.querySelectorAll("*"))) {
          const oy = getComputedStyle(el).overflowY;
          const room = el.scrollHeight - el.clientHeight;
          if ((oy === "auto" || oy === "scroll") && room > best) {
            best = room;
            box = el;
          }
        }
        maxY = best;
      }
      const stepPx = Math.max(1, Math.floor(window.innerHeight / 2));
      if ((n - 1) * stepPx >= maxY) return null;
      const top = Math.min(n * stepPx, maxY);
      if (box) box.scrollTo({ top, left: 0, behavior: "instant" });
      else window.scrollTo({ top, left: 0, behavior: "instant" });
      return box ? box.tagName.toLowerCase() + (box.id ? `#${box.id}` : "") : "window";
    }, step);
    if (moved === null) {
      capped = false;
      break;
    }
    scrolled = moved;
    await settle(page);
    samples.push(await sampleAll(page));
  }
  await page.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    for (const el of Array.from(document.querySelectorAll("*"))) {
      if (el.scrollTop > 0) el.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  });
  await settle(page);
  const before = await sampleAll(page);
  samples.push(before);
  await page.waitForTimeout(waitMs);
  const after = await sampleAll(page);
  samples.push(after);
  const scripted = Object.keys(after.geometry).filter(
    (k) => k in before.geometry && before.geometry[k] !== after.geometry[k],
  );
  const origin = new URL(page.url()).origin;
  const skippedFrames = page.frames().filter((f) => {
    if (f === page.mainFrame()) return false;
    try {
      return new URL(f.url()).origin !== origin;
    } catch {
      return true;
    }
  }).length;
  return {
    width,
    samples: samples.map((s) => ({
      reduceMatched: s.reduceMatched,
      items: s.items,
      scrollDriven: s.scrollDriven,
    })),
    scripted,
    scrolled,
    skippedFrames,
    capped,
  };
}

/** Run R2 on `url` at each of REDUCED_MOTION_VIEWPORTS, in contexts that
 *  emulate `reduce`. A test passes `reducedMotion: "no-preference"` to prove
 *  the emulation check, and a shorter `waitMs` where no timer is involved. */
export async function checkReducedMotion(
  browser: Browser,
  url: string,
  options: BrowserContextOptions = { reducedMotion: "reduce" },
  waitMs: number = MOTION_WAIT_MS,
): Promise<RuleOutcome> {
  const runs: MotionRun[] = [];
  for (const viewport of REDUCED_MOTION_VIEWPORTS) {
    runs.push(
      await withPage(browser, { ...options, viewport }, url, (page) =>
        runAt(page, viewport.width, waitMs),
      ),
    );
  }
  return summarizeReducedMotion(url, runs);
}

export const reducedMotionRule: DesignRule = {
  id: "R2",
  title: "All motion honours prefers-reduced-motion",
  check: (browser, url) => checkReducedMotion(browser, url),
};
