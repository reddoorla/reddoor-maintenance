/// <reference lib="dom" />
import type { Browser, BrowserContextOptions, Frame, Page } from "@playwright/test";
import { isForeignUrl } from "../util/cross-origin.js";
import { settle, withPage } from "./load.js";
import type { DesignRule, RuleFinding, RuleOutcome } from "./types.js";

// R2 in docs/design-review-rules-2026-09.md: all motion honours
// `prefers-reduced-motion`. Durations AND delays go to zero, JS/WAAPI motion is
// included, and the page lands on its final frame.
//
// Under an emulated `reduce`, at 1440×900 and at 390×844, the page is sampled
// at the top, at every half-viewport scroll step (of the window, or of the
// page's own scroller when the window cannot scroll), back at the top, and
// through a last MOTION_WAIT_MS. Open shadow roots and same-document frames
// (same origin, srcdoc, about:blank) are sampled with the page. It fails on:
//
//   - a computed delay or duration above PERCEPTIBLE_MS on an element or its
//     ::before/::after. Every animation counts; a transition counts unless it
//     only fades a colour (a hover colour fade is not motion; `all` counts,
//     since what it covers is unknown). Each list is read
//     per animation name or transition property, so an entry no name uses is
//     ignored, as the browser ignores it; an animation name no `@keyframes`
//     defines is ignored, and so is one the page pauses (a marquee paused under
//     reduce is the honouring behaviour). A display:none menu is read too,
//     because it will open. A zero-length animation that still waits out its
//     delay is "nothing happens, then it pops" (reddoor-starter #135, from
//     beachfront df53dee);
//   - a running animation (CSS, transition or Web Animations API, which
//     Svelte's transitions run on and no CSS reset reaches) with more than
//     PERCEPTIBLE_MS left or no end, scroll-driven ones (view(), scroll())
//     included unless they only animate size (width, height, or a one-axis
//     scale: a progress bar; a uniform scale() is a zoom, and counts); a
//     finite animation paused short of its end (an endless one paused is a
//     marquee honouring reduce); `scroll-behavior: smooth`; and a video
//     playing;
//   - motion a script drives frame by frame (a tween, a spring, GSAP): an
//     element whose inline transform, position, margin, opacity, background
//     position or dash offset, SVG position attribute, or horizontal scroll
//     changes at two consecutive reads (SCRIPTED_GAP_MS apart; SCRIPTED_READS
//     at every step, and reads through the last wait), or four times in the
//     last wait (a slow stepper), or takes a value never seen before at two
//     scroll steps running (a script parallax). A snap or a swap changes at
//     one read and holds, which reduce allows; width, height and a one-axis
//     scale are size, not motion, and are not read.
//
// Not covered: the single frame a zeroed Svelte transition can paint at t=0
// (#135's `fly({ y: 22 })`); a script's delay before it shows an element (a
// GSAP `delay`), which a read cannot tell from a slide swap; an element a
// script re-creates every frame, which has no identity to follow; two snaps
// SCRIPTED_GAP_MS apart, which read as motion; motion that only hover, focus or an opened state
// starts (`:hover { animation }`, `.is-open { transition }`), because nothing
// here hovers, focuses or opens; size-only scroll-driven animations (counted in
// the note); closed shadow roots and cross-origin frames (a third-party embed
// is not the site's code; counted in the note), and frames that do not answer
// within FRAME_TIMEOUT_MS (counted with them), though an about:blank frame a
// third party's script writes is sampled as the site's; motion a script drives
// through a channel not read here (a CSS custom property, a canvas, text
// content: a typewriter or a count-up), or slower than four changes in the
// last wait (a clock's second hand); an element's own vertical scroll (a
// script auto-scrolling a list), since the page's own scroller moves with
// every step; SMIL (`<animate>`); animated GIF and WebP images; and motion a
// script starts after the last read. Known false fails: what a script moves
// with the scroll to show progress or to stay put reads as parallax (a ring's
// dash offset, a bar's translateX, an element a script pins by transform),
// and keyframes declared only under `prefers-reduced-motion: no-preference`
// count as defined.

/** Below this, a delay, duration or remaining time is a reset's 0.01ms tail or
 *  a frame of rounding, not something a reader sees. */
export const PERCEPTIBLE_MS = 50;
/** How long the last reads run, to see timer-started and scripted motion. */
export const MOTION_WAIT_MS = 1500;
/** Reads per window for scripted motion, and the gap between them. A change
 *  at two consecutive reads is motion; a change that holds is a snap. */
export const SCRIPTED_READS = 3;
export const SCRIPTED_GAP_MS = 100;

/** This many elements with a duration under reduce means the page has no
 *  working reset, and the note says so: the fix is one rule, not N. */
export const RESET_HINT_AT = 20;
/** Half-viewport scroll steps before the run stops and says so. */
export const STEP_CAP = 200;

/** Hosts whose cross-origin stylesheets are font faces, never keyframes: one
 *  that cannot be read does not make every animation name count as defined
 *  (every fleet page loads a Typekit sheet). */
export const FONT_HOSTS = /(^|\.)(typekit\.net|fonts\.googleapis\.com|fonts\.bunny\.net)$/;

export const REDUCED_MOTION_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

export type MotionItem = {
  target: string;
  /** "transition-delay", "animation-duration", "running animation spin",
   *  "paused animation r", "scripted" … */
  kind: string;
  /** The delay or duration, or the time left; null for an animation with no end. */
  ms: number | null;
};

export type MotionSample = {
  /** `matchMedia("(prefers-reduced-motion: reduce)").matches` in the page. False
   *  means the emulation did not take, so nothing else in the sample counts. */
  reduceMatched: boolean;
  items: MotionItem[];
  /** Size-only scroll-driven animations seen; not judged. */
  scrollDriven: number;
  /** The document actually sampled; a frame's can change under the caller. */
  href?: string;
};

/**
 * Runs IN THE PAGE through `page.evaluate`, so it follows revealBelowFold's
 * rules: self-contained, no import, no module-scope identifier, and no named
 * inner function (a keep-names shim would call a `__name` the page lacks).
 *
 * Takes [floor in ms, window read]. With the window read set, it ALSO takes one scripted-motion read: the motion
 * values scripts write, per element, are compared with the previous read of
 * the same window (`windowRead` is "<window id>:<read index>"); an element
 * whose values changed at two consecutive reads is reported as scripted.
 * The state lives on `window.__designRulesR2`, keyed by element identity.
 */
export function sampleReducedMotion([floorMs, windowRead, fontHosts]: readonly [
  number,
  string | null,
  string,
]): MotionSample {
  const items: MotionItem[] = [];
  let scrollDriven = 0;
  const pending: Array<{ el: Element; pseudo: string | null; kind: string; ms: number | null }> =
    [];

  // Pass 1: every root (the document and each open shadow root), and every
  // keyframe name any of them defines, before any element is judged.
  const roots: Array<Document | ShadowRoot> = [document];
  const elements: Element[] = [];
  for (let r = 0; r < roots.length; r++) {
    for (const el of Array.from(roots[r]!.querySelectorAll("*"))) {
      elements.push(el);
      if (el.shadowRoot) roots.push(el.shadowRoot);
    }
  }
  // null once a sheet that could hold keyframes cannot be read (cross-origin
  // and not a font host); every name then counts as defined.
  let keyframes: Set<string> | null = new Set<string>();
  const sheets: CSSStyleSheet[] = [];
  for (const root of roots) {
    sheets.push(...Array.from(root.styleSheets), ...Array.from(root.adoptedStyleSheets ?? []));
  }
  for (let s = 0; s < sheets.length; s++) {
    const sheet = sheets[s]!;
    let rules: CSSRule[];
    try {
      rules = Array.from(sheet.cssRules);
    } catch {
      const host = sheet.href ? new URL(sheet.href, location.href).hostname : "";
      if (!new RegExp(fontHosts).test(host)) {
        keyframes = null;
      }
      continue;
    }
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]!;
      if (rule instanceof CSSKeyframesRule) {
        // The computed animation-name comes back CSS-escaped (`\31 slide`),
        // the rule's name unescaped (`1slide`): keep both.
        keyframes?.add(rule.name);
        keyframes?.add(CSS.escape(rule.name));
      } else if (rule instanceof CSSImportRule) {
        if (rule.styleSheet) sheets.push(rule.styleSheet);
      } else if ("cssRules" in rule) {
        rules.push(...Array.from((rule as CSSGroupingRule).cssRules));
      }
    }
  }

  // Pass 2: smooth scrolling, playing video, and computed delays and durations.
  for (const el of elements) {
    // `scroll-behavior: smooth` animates every anchor jump and scrollTo (the
    // starters' reset sets it back to auto under reduce).
    if (getComputedStyle(el).scrollBehavior === "smooth") {
      pending.push({ el, pseudo: null, kind: "smooth scrolling", ms: null });
    }
    if (el instanceof HTMLVideoElement && !el.paused && !el.ended) {
      pending.push({ el, pseudo: null, kind: "playing video", ms: null });
    }
    for (const pseudo of [null, "::before", "::after"]) {
      const style = getComputedStyle(el, pseudo);
      if (pseudo !== null && (style.content === "none" || style.content === "normal")) continue;
      const lists: Array<[string, string, string, string, string]> = [
        [
          "transition",
          style.transitionProperty,
          style.transitionDuration,
          style.transitionDelay,
          "",
        ],
        [
          "animation",
          style.animationName,
          style.animationDuration,
          style.animationDelay,
          style.animationPlayState,
        ],
      ];
      for (const [family, namesText, durationsText, delaysText, statesText] of lists) {
        const names = namesText.split(",").map((s) => s.trim());
        const durations = durationsText.split(",").map((s) => s.trim());
        const delays = delaysText.split(",").map((s) => s.trim());
        const states = statesText.split(",").map((s) => s.trim());
        let duration = 0;
        let delay = 0;
        for (let i = 0; i < names.length; i++) {
          const name = names[i]!;
          if (name === "none") continue;
          if (family === "animation") {
            if (keyframes !== null && !keyframes.has(name)) continue;
            if (states[i % states.length] === "paused") continue;
          }
          // A shorter list repeats to the length of the name list.
          const d = durations[i % durations.length]!;
          const l = delays[i % delays.length]!;
          const dMs = parseFloat(d) * (d.endsWith("ms") ? 1 : 1000);
          const lMs = parseFloat(l) * (l.endsWith("ms") ? 1 : 1000);
          // A transition's duration counts only for a property that moves
          // or fades the element; a colour, background, border, shadow or
          // custom-property fade (Tailwind's transition-colors) is not
          // motion. Its delay still counts.
          const moves =
            family === "animation" ||
            /^(all|transform|translate|scale|rotate|top|right|bottom|left|inset.*|margin.*|opacity|offset.*|stroke-dashoffset|clip-path|background-position|filter)$/.test(
              name,
            );
          if (moves && Number.isFinite(dMs) && dMs > duration) duration = dMs;
          if (Number.isFinite(lMs) && lMs > delay) delay = lMs;
        }
        if (duration > floorMs)
          pending.push({ el, pseudo, kind: `${family}-duration`, ms: duration });
        if (delay > floorMs) pending.push({ el, pseudo, kind: `${family}-delay`, ms: delay });
      }
    }
  }

  // Animations, from every root (document.getAnimations() leaves out shadow trees).
  for (const root of roots) {
    for (const animation of root.getAnimations()) {
      const effect = animation.effect as KeyframeEffect | null;
      if (effect === null) continue;
      const timeline = animation.timeline;
      // A scroll-driven animation (view() or scroll()) is judged as motion,
      // unless it only animates size: a reading-progress bar (width, or a
      // transform of scale() alone) is size, not motion, and is only counted.
      const scrollLinked = timeline !== null && !(timeline instanceof DocumentTimeline);
      if (scrollLinked) {
        let sizeOnly = true;
        for (const frame of effect.getKeyframes()) {
          for (const [prop, value] of Object.entries(frame)) {
            if (["offset", "computedOffset", "easing", "composite"].includes(prop)) continue;
            const size = ["width", "height", "inlineSize", "blockSize"].includes(prop);
            const scaleOnly =
              prop === "transform" &&
              /^(none|(\s*scale[XY]\([^)]*\))+)$/.test(String(value).trim());
            if (!size && !scaleOnly) sizeOnly = false;
          }
        }
        if (sizeOnly) {
          scrollDriven += 1;
          continue;
        }
      }
      const onView = scrollLinked;
      const name =
        "animationName" in animation
          ? `animation ${String(animation.animationName)}`
          : "transitionProperty" in animation
            ? `transition ${String(animation.transitionProperty)}`
            : "Web Animation";
      if (
        name.startsWith("transition ") &&
        !/^transition (all|transform|translate|scale|rotate|top|right|bottom|left|inset.*|margin.*|opacity|offset.*|stroke-dashoffset|clip-path|background-position|filter)$/.test(
          name,
        )
      ) {
        continue;
      }
      const timing = effect.getComputedTiming();
      const end = Number(timing.endTime);
      const local = Number(timing.localTime ?? 0);
      const left = Number.isFinite(end) ? end - local : null;
      if (animation.playState === "running" || onView) {
        if (left !== null && left <= floorMs && !onView) continue;
        if (effect.target) {
          pending.push({
            el: effect.target,
            pseudo: effect.pseudoElement,
            kind: onView ? `running ${name} (scroll-driven)` : `running ${name}`,
            ms: onView ? null : left,
          });
        } else items.push({ target: "(no target)", kind: `running ${name}`, ms: left });
      } else if (animation.playState === "paused" && effect.target) {
        // Pausing an endless animation (a marquee) is how a page honours
        // reduce. A finite one paused short of its end has not landed on its
        // final frame: a headline frozen out of its mask, a fade at its start.
        if (left !== null && left > floorMs) {
          pending.push({
            el: effect.target,
            pseudo: effect.pseudoElement,
            kind: `paused ${name}`,
            ms: left,
          });
        }
      }
    }
  }

  // One scripted-motion read.
  if (windowRead !== null) {
    const [windowId, readText] = windowRead.split(":");
    const read = Number(readText);
    const w = window as unknown as {
      __designRulesR2?: {
        window: string;
        last: WeakMap<Element, string>;
        changedAt: WeakMap<Element, number>;
        changes: WeakMap<Element, number>;
        seen: WeakMap<Element, Set<string>>;
      };
      __designRulesR2Steps?: { seen: WeakMap<Element, Set<string>>; run: WeakMap<Element, number> };
    };
    if (!w.__designRulesR2 || w.__designRulesR2.window !== windowId) {
      w.__designRulesR2 = {
        window: windowId!,
        last: new WeakMap(),
        changedAt: new WeakMap(),
        changes: new WeakMap(),
        seen: new WeakMap(),
      };
    }
    const state = w.__designRulesR2;
    // Across scroll steps: the value each step window opened on.
    w.__designRulesR2Steps ??= { seen: new WeakMap(), run: new WeakMap() };
    const steps = w.__designRulesR2Steps;
    // The top window's first read is the baseline; each step window's first
    // read is compared with every value seen at the openings before it.
    const stepOpen = read === 0 && (windowId === "top" || windowId!.startsWith("step"));
    for (const el of elements) {
      const css = (el as HTMLElement).style;
      if (!css) continue;
      const svg = el instanceof SVGElement;
      // A one-axis scale is size, not motion (a script-driven progress bar); a
      // uniform scale() is a zoom, and is read.
      const values = [
        css.transform.replace(/scale[XY]\([^)]*\)/g, ""),
        css.translate,
        css.scale,
        css.rotate,
        css.left,
        css.top,
        css.right,
        css.bottom,
        css.marginLeft,
        css.marginTop,
        css.marginRight,
        css.marginBottom,
        css.opacity,
        css.backgroundPosition,
        css.strokeDashoffset,
        svg ? el.getAttribute("transform") : null,
        svg ? el.getAttribute("cx") : null,
        svg ? el.getAttribute("cy") : null,
        svg ? el.getAttribute("x") : null,
        svg ? el.getAttribute("y") : null,
        el.scrollWidth > el.clientWidth ? String(el.scrollLeft) : null,
      ].join("|");
      if (stepOpen) {
        // A value never seen before at two step openings running moves with
        // the scroll (a script parallax, a hero's included: it moves for the
        // first two steps, then holds); a hiding header or a late image
        // changes once.
        const seen = steps.seen.get(el) ?? new Set<string>();
        const fresh = seen.size > 0 && !seen.has(values);
        seen.add(values);
        steps.seen.set(el, seen);
        const run = fresh ? (steps.run.get(el) ?? 0) + 1 : 0;
        steps.run.set(el, run);
        if (run === 2) pending.push({ el, pseudo: null, kind: "scroll-linked", ms: null });
      }
      const before = state.last.get(el);
      state.last.set(el, values);
      const seenValues = state.seen.get(el) ?? new Set<string>();
      seenValues.add(values);
      state.seen.set(el, seenValues);
      if (read === 0 || before === undefined || before === values) continue;
      // Changed at this read AND the one before: a value in motion. A swap
      // (a slide, a toggle) changes at one read and holds. A slow stepper
      // (a 4fps ticker) never changes twice running, but takes four new
      // values in the long last window; a swap only ever alternates.
      const changes = (state.changes.get(el) ?? 0) + 1;
      state.changes.set(el, changes);
      if (
        state.changedAt.get(el) === read - 1 ||
        (windowId === "last" && changes >= 4 && seenValues.size >= 4)
      ) {
        pending.push({ el, pseudo: null, kind: "scripted", ms: null });
      }
      state.changedAt.set(el, read);
    }
  }

  for (const item of pending) {
    // A path a reader can paste into querySelector: escaped classes, and the
    // :nth-of-type wherever a parent has more than one child of that tag.
    const parts: string[] = [];
    let node: Element | null = item.el;
    while (node && parts.length < 8) {
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
    items.push({ target, kind: item.kind, ms: item.ms });
  }

  return {
    reduceMatched: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    items,
    scrollDriven,
    href: location.href,
  };
}

/** What one viewport's run saw, for the summary. */
export type MotionRun = {
  width: number;
  samples: MotionSample[];
  /** What was scrolled: "window", an element's path, or "nothing" (one screen). */
  scrolled: string;
  /** Child frames not sampled: cross-origin, or not answering. */
  skippedFrames: number;
  /** The step cap this run used, when not STEP_CAP. */
  stepCap?: number;
  /** True when the scroll stopped at its step cap before the bottom. */
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
  for (const run of runs) {
    for (const s of run.samples) {
      for (const i of s.items) {
        const ms = i.ms ?? Number.POSITIVE_INFINITY;
        const key = `${i.target}\u0000${i.kind}`;
        const seen = worst.get(key) ?? { target: i.target, kind: i.kind, ms, widths: [] };
        if (ms > seen.ms) seen.ms = ms;
        if (!seen.widths.includes(run.width)) seen.widths.push(run.width);
        worst.set(key, seen);
      }
    }
  }
  // A finite running animation on an element that already has a delay or
  // duration finding of its family is the same cause; the static finding
  // names it, and the running one (whose time left varies) is folded in. An
  // endless one is kept: it says something the static finding does not.
  for (const [key, w] of worst) {
    const family = w.kind.startsWith("running animation ")
      ? "animation"
      : w.kind.startsWith("running transition ")
        ? "transition"
        : null;
    if (!family || !Number.isFinite(w.ms)) continue;
    if (
      worst.has(`${w.target}\u0000${family}-delay`) ||
      worst.has(`${w.target}\u0000${family}-duration`)
    ) {
      worst.delete(key);
    }
  }
  // A tween a scroll step starts can still be running at the next steps; its
  // frame-by-frame finding names it, so the scroll-linked one is folded in.
  for (const [key, w] of worst) {
    if (w.kind === "scroll-linked" && worst.has(`${w.target}\u0000scripted`)) worst.delete(key);
  }
  const findings: RuleFinding[] = [...worst.values()].map(({ target, kind, ms, widths }) => {
    const at = ` (at ${widths.join(" and ")}px)`;
    const time = Number.isFinite(ms) ? `${Math.round(ms)}ms` : "no end";
    if (kind === "scripted") {
      return { target, problem: `moved by script, frame by frame, under reduce${at}` };
    }
    if (kind === "smooth scrolling" || kind === "playing video") {
      return { target, problem: `${kind} under reduce${at}` };
    }
    if (kind === "scroll-linked") {
      return { target, problem: `moved by script with the scroll (parallax) under reduce${at}` };
    }
    if (kind.startsWith("running ")) {
      return {
        target,
        problem: `${kind.slice(8)} still running under reduce (${Number.isFinite(ms) ? `${time} left` : time})${at}`,
      };
    }
    if (kind.startsWith("paused ")) {
      return {
        target,
        problem: `${kind.slice(7)} paused short of its end under reduce (${time} left)${at}`,
      };
    }
    return { target, problem: `${kind} ${time} under reduce${at}` };
  });
  const scrollDriven = Math.max(0, ...samples.map((s) => s.scrollDriven));
  // Elements, not findings: one element can keep both durations.
  const durations = new Set(
    findings.filter((f) => /(transition|animation)-duration /.test(f.problem)).map((f) => f.target),
  ).size;
  const skipped = Math.max(0, ...runs.map((r) => r.skippedFrames));
  const note =
    `${samples.length} samples under reduce at ${runs.map((r) => `${r.width}px`).join(" and ")}` +
    ` (scrolled ${[...new Set(runs.map((r) => r.scrolled))].join(", ")}); ${findings.length} finding(s)` +
    (scrollDriven > 0 ? `; ${scrollDriven} size-only scroll-driven animation(s) not judged` : "") +
    (skipped > 0 ? `; ${skipped} frame(s) not sampled (cross-origin or not answering)` : "") +
    (runs.some((r) => r.capped)
      ? `; the scroll stopped at its ${Math.max(...runs.map((r) => r.stepCap ?? STEP_CAP))}-step cap`
      : "") +
    (durations >= RESET_HINT_AT
      ? `; ${durations} elements keep a duration under reduce: no prefers-reduced-motion reset reaches them`
      : "");
  return { ...base, status: findings.length === 0 ? "pass" : "fail", findings, note };
}

/** A frame whose document the page itself made: same origin, srcdoc,
 *  about:blank, data: or blob: (the a11y audit's own test, isForeignUrl). */
function sameDocumentFrame(page: Page, frame: Frame): boolean {
  return !isForeignUrl(frame.url(), new URL(page.url()).origin);
}

/** How long a child frame gets to answer one sample. */
const FRAME_TIMEOUT_MS = 1000;
/** Frames that did not answer, per page; never asked again. */
const silent = new WeakMap<Page, Set<Frame>>();

/** One sample of the page and of every same-document child frame. */
async function sampleAll(page: Page, windowRead: string | null): Promise<MotionSample> {
  const args = [PERCEPTIBLE_MS, windowRead, FONT_HOSTS.source] as const;
  const top = await page.evaluate(sampleReducedMotion, args);
  const silentFrames = silent.get(page) ?? new Set<Frame>();
  silent.set(page, silentFrames);
  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || !sameDocumentFrame(page, frame)) continue;
    if (silentFrames.has(frame)) continue;
    // A frame that never loaded (an empty url) never answers an evaluate, so
    // each one gets FRAME_TIMEOUT_MS; one that does not answer is not sampled.
    const inner = await Promise.race([
      frame.evaluate(sampleReducedMotion, args).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FRAME_TIMEOUT_MS)),
    ]);
    if (inner === null) silentFrames.add(frame);
    // A frame still navigating has an empty url, so it looked like the page's
    // own; the document the evaluate actually ran in decides (a lazy Vimeo
    // player is not the site's code).
    if (inner && isForeignUrl(inner.href ?? "", new URL(page.url()).origin)) continue;
    if (!inner) continue;
    const src = await frame
      .frameElement()
      .then((el) => el.getAttribute("src"))
      .catch(() => null);
    const at =
      src !== null
        ? `iframe[src=${JSON.stringify(src)}] :: `
        : frame.url() === "about:srcdoc"
          ? `iframe[srcdoc] :: `
          : `iframe:not([src]) :: `;
    top.items.push(...inner.items.map((i) => ({ ...i, target: at + i.target })));
    top.scrollDriven += inner.scrollDriven;
    top.reduceMatched &&= inner.reduceMatched;
  }
  return top;
}

/** `reads` samples SCRIPTED_GAP_MS apart, as one scripted-motion window. */
async function sampleWindow(
  page: Page,
  windowId: string,
  reads = SCRIPTED_READS,
): Promise<MotionSample[]> {
  const out: MotionSample[] = [];
  for (let read = 0; read < reads; read++) {
    if (read > 0) await page.waitForTimeout(SCRIPTED_GAP_MS);
    out.push(await sampleAll(page, `${windowId}:${read}`));
  }
  return out;
}

/** One viewport: a window at the top, at every half-viewport step, and back at
 *  the top, then reads through a last `waitMs`. */
async function runAt(
  page: Page,
  width: number,
  waitMs: number,
  stepCap: number,
): Promise<MotionRun> {
  await settle(page);
  const samples: MotionSample[] = await sampleWindow(page, "top");
  let scrolled = "nothing";
  let capped = false;
  for (let step = 1; ; step++) {
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
    if (moved === null) break;
    if (step > stepCap) {
      capped = true;
      break;
    }
    scrolled = moved;
    await settle(page);
    samples.push(...(await sampleWindow(page, `step${step}`)));
  }
  await page.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    for (const el of Array.from(document.querySelectorAll("*"))) {
      if (el.scrollTop > 0) el.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  });
  await settle(page);
  samples.push(...(await sampleWindow(page, "back")));
  // The last wait, read as one long window, for timers and slow tweens.
  const lastReads = Math.max(2, Math.round(waitMs / SCRIPTED_GAP_MS) + 1);
  samples.push(...(await sampleWindow(page, "last", lastReads)));
  const skippedFrames =
    page.frames().filter((f) => f !== page.mainFrame() && !sameDocumentFrame(page, f)).length +
    (silent.get(page)?.size ?? 0);
  return { width, samples, scrolled, skippedFrames, capped, stepCap };
}

/** Run R2 on `url` at each of REDUCED_MOTION_VIEWPORTS, in contexts that
 *  emulate `reduce`. A test passes `reducedMotion: "no-preference"` to prove
 *  the emulation check, and a shorter `waitMs` where no timer is involved. */
export async function checkReducedMotion(
  browser: Browser,
  url: string,
  options: BrowserContextOptions = { reducedMotion: "reduce" },
  waitMs: number = MOTION_WAIT_MS,
  stepCap: number = STEP_CAP,
): Promise<RuleOutcome> {
  const runs: MotionRun[] = [];
  for (const viewport of REDUCED_MOTION_VIEWPORTS) {
    runs.push(
      await withPage(browser, { ...options, viewport }, url, (page) =>
        runAt(page, viewport.width, waitMs, stepCap),
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
