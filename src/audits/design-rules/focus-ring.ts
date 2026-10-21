/// <reference lib="dom" />
import type { Browser, Page } from "@playwright/test";
import sharp from "sharp";
import { settle, withPage } from "./load.js";
import type { DesignRule, RuleFinding, RuleOutcome } from "./types.js";

// R12 in docs/design-review-rules-2026-09.md: keyboard focus is always
// visible. The ring contrasts at least 3:1 with the ground it is drawn on, is
// not clipped, and is never under a pinned bar.
//
// The page is tabbed through, at 1440×900 and 390×844, under reduced motion
// (so a ring that transitions in is there at once). At each stop the focused
// element's box, padded by RING_PAD_PX, is captured focused and then unfocused
// (the element blurred), and the two are compared pixel by pixel, which is
// WCAG 2.4.13's own measure: the indicator is the pixels that change, and each
// is judged against the SAME pixel unfocused, the ground actually painted
// under it, photo, gradient and band included. A stop fails when:
//
//   - no pixel changes: there is no visible indicator (an `outline: none`, or a
//     ring the colour of its ground, roalson-interests #23's garnet on garnet);
//   - the changed pixels' 90th-percentile contrast against their unfocused
//     selves is under 3:1: the ring is too faint on this ground (#23's 1.48:1
//     on bg-dark);
//   - fewer pixels changed than half the element's perimeter: the ring is
//     mostly cut off by an ancestor's overflow. Half, because R12 asks for a
//     ring that is seen, not WCAG 2.4.13's AAA area;
//   - the focused element's centre is covered by something else: under a
//     pinned bar (roalson's journal, 2026-09-21, "the pinned bar hid whatever
//     the browser focused").
//
// The page is tabbed once the network is idle. Stops are told apart by element
// identity, so the tab order ends where it wraps. A stop at the viewport's edge
// is measured on the part the screen shows; a visually hidden input (a
// `peer sr-only` radio) is measured by its label, where its ring is drawn.
// A page where no stop could be measured is unmeasured, never a pass.
//
// Not covered: a stop wholly outside the viewport after focus scrolled it, and
// focus inside a frame (each counted in the note); `outline: none` in
// forced-colours mode; focus moved by script (a trapped dialog is tabbed as
// the page tabs it); a ring drawn further than RING_PAD_PX from the box; a
// focus that opens something inside the captured box (a menu), whose
// change counts as the indicator, as does a change to the element's own
// fill; and two stops with the same path, whose findings are merged.

/** CSS px of ground captured round the element: outline offset plus width,
 *  with room to spare. */
export const RING_PAD_PX = 16;
/** At most this many tab stops per width. */
export const STOP_CAP = 60;
/** A channel sum below this is the same pixel (antialiasing, compression). */
const SAME_PIXEL = 24;

/** WCAG relative luminance of an sRGB pixel. */
function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(...a);
  const lb = luminance(...b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * What one stop's two captures say. PURE over the raw RGBA buffers. The
 * indicator is the pixels that changed; its contrast is the 90th-percentile
 * contrast of those pixels against the same pixels unfocused (the ring's own
 * colour on its ground: a thin ring at a fractional position is
 * anti-aliased into two half-strength rows, so a per-pixel count would
 * measure its sub-pixel offset instead), and it is unclipped when it covers at
 * least half the element's perimeter.
 */
export function measureRing(
  focused: Uint8Array,
  unfocused: Uint8Array,
  width: number,
  height: number,
  perimeterPx: number,
): { changed: number; contrast: number; passes: boolean } {
  const contrasts: number[] = [];
  for (let i = 0; i < width * height * 4; i += 4) {
    const f: [number, number, number] = [focused[i]!, focused[i + 1]!, focused[i + 2]!];
    const u: [number, number, number] = [unfocused[i]!, unfocused[i + 1]!, unfocused[i + 2]!];
    if (Math.abs(f[0] - u[0]) + Math.abs(f[1] - u[1]) + Math.abs(f[2] - u[2]) < SAME_PIXEL)
      continue;
    contrasts.push(contrast(f, u));
  }
  contrasts.sort((a, b) => a - b);
  const changed = contrasts.length;
  const p90 = changed === 0 ? 1 : contrasts[Math.floor((changed - 1) * 0.9)]!;
  return { changed, contrast: p90, passes: p90 >= 3 && changed >= perimeterPx / 2 };
}

/** The focused element, as the page sees it: its box, a path a reader can
 *  paste, whether something else covers its centre, whether this element
 *  was focused before (the tab order has wrapped), and whether focus is
 *  inside a frame (not measured). A visually hidden input (a Tailwind
 *  `peer sr-only` radio) is measured by its label, where its ring is drawn.
 *  Runs IN THE PAGE (self-contained, no named helpers). */
export function describeFocus(): {
  target: string;
  rect: { x: number; y: number; width: number; height: number };
  covered: string | null;
  repeat: boolean;
  inFrame: boolean;
} | null {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const w = window as unknown as { __designRulesR12Seen?: WeakSet<Element> };
  w.__designRulesR12Seen ??= new WeakSet();
  const inFrame = el.tagName === "IFRAME" || el.tagName === "FRAME";
  // Focus moves inside a frame while the frame stays the active element, so
  // a frame is never a repeat.
  const repeat = !inFrame && w.__designRulesR12Seen.has(el);
  w.__designRulesR12Seen.add(el);
  let box: Element = el;
  const own = el.getBoundingClientRect();
  const labels = (el as HTMLInputElement).labels;
  if ((own.width <= 2 || own.height <= 2) && labels && labels.length > 0) box = labels[0]!;
  const r = box.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let hit: Element | null = document.elementFromPoint(cx, cy);
  while (hit && hit.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(cx, cy);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  const covers =
    hit &&
    hit !== el &&
    hit !== box &&
    !box.contains(hit) &&
    !hit.contains(box) &&
    !el.contains(hit)
      ? hit
      : null;
  const paths: string[] = [];
  for (const start of [el, covers]) {
    const parts: string[] = [];
    let node: Element | null = start;
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
      node = parent ?? ((node.getRootNode() as ShadowRoot).host || null);
    }
    paths.push(parts.join(" > "));
  }
  return {
    target: paths[0]!,
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    covered: covers ? paths[1]! : null,
    repeat,
    inFrame,
  };
}

export type FocusStop = {
  target: string;
  /** null: the stop was not measured (see `skipped`). */
  ring: { changed: number; contrast: number; passes: boolean } | null;
  covered: string | null;
  /** Why the ring was not measured: the element is wholly outside the
   *  viewport, or focus is inside a frame. */
  skipped?: "viewport" | "frame";
};

/** Tab through one page, measuring each stop. */
async function tabThrough(page: Page): Promise<FocusStop[]> {
  // A loader overlay or late hydration would cover the first stops: tab once
  // the network is quiet and a frame has run.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await settle(page);
  const stops: FocusStop[] = [];
  const viewport = page.viewportSize()!;
  for (let i = 0; i < STOP_CAP; i++) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(describeFocus);
    if (!focus || focus.repeat) break;
    if (focus.inFrame) {
      // Focus is inside a frame, on an element this page cannot see; it
      // stays there so the next Tab moves on through the frame and out.
      stops.push({ target: focus.target, ring: null, covered: null, skipped: "frame" });
      continue;
    }
    const { x, y, width, height } = focus.rect;
    // The element's part inside the viewport, and the padded box round it
    // clamped to the viewport: a full-bleed link at x = 0 is measured on the
    // three sides the screen shows.
    const seen = {
      left: Math.max(0, x),
      top: Math.max(0, y),
      right: Math.min(viewport.width, x + width),
      bottom: Math.min(viewport.height, y + height),
    };
    if (seen.right - seen.left < 1 || seen.bottom - seen.top < 1) {
      stops.push({ target: focus.target, ring: null, covered: focus.covered, skipped: "viewport" });
      continue;
    }
    const left = Math.max(0, Math.floor(x - RING_PAD_PX));
    const top = Math.max(0, Math.floor(y - RING_PAD_PX));
    const clip = {
      x: left,
      y: top,
      width: Math.min(viewport.width, Math.ceil(x + width + RING_PAD_PX)) - left,
      height: Math.min(viewport.height, Math.ceil(y + height + RING_PAD_PX)) - top,
    };
    const on = await page.screenshot({ clip, animations: "disabled", caret: "hide" });
    // Unfocused: drop focus and capture. The next Tab moves on from the
    // blurred element, which stays the sequential focus starting point.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const off = await page.screenshot({ clip, animations: "disabled", caret: "hide" });
    const a = await sharp(on).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const b = await sharp(off).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const perimeter = 2 * (Math.round(seen.right - seen.left) + Math.round(seen.bottom - seen.top));
    stops.push({
      target: focus.target,
      ring: measureRing(a.data, b.data, a.info.width, a.info.height, perimeter),
      covered: focus.covered,
    });
  }
  return stops;
}

const pct = (n: number): string => n.toFixed(2);

/** One width's tab-through. */
export type FocusRun = { width: number; stops: FocusStop[] };

/** R12's verdict. PURE. A finding seen at both widths is reported once. */
export function summarizeFocusRing(url: string, runs: FocusRun[]): RuleOutcome {
  const base = { rule: "R12" as const, url };
  const stops = runs.flatMap((r) => r.stops);
  if (stops.length === 0) {
    return { ...base, status: "unmeasured", findings: [], note: "no element took keyboard focus" };
  }
  const seen = new Map<string, { target: string; problem: string; widths: number[] }>();
  const add = (width: number, target: string, problem: string) => {
    const key = `${target}\u0000${problem}`;
    const f = seen.get(key) ?? { target, problem, widths: [] };
    if (!f.widths.includes(width)) f.widths.push(width);
    seen.set(key, f);
  };
  let offScreen = 0;
  let inFrames = 0;
  let measured = 0;
  for (const { width, stops: list } of runs) {
    for (const s of list) {
      if (s.covered) add(width, s.target, `is under ${s.covered} when focused`);
      if (s.ring === null) {
        if (s.skipped === "frame") inFrames += 1;
        else offScreen += 1;
        continue;
      }
      measured += 1;
      if (s.ring.changed === 0) add(width, s.target, "has no visible focus indicator");
      else if (!s.ring.passes) {
        add(
          width,
          s.target,
          s.ring.contrast < 3
            ? `focus indicator reaches only ${pct(s.ring.contrast)}:1 against its ground (needs 3:1)`
            : "focus indicator covers under half its perimeter (clipped, or not a ring)",
        );
      }
    }
  }
  const findings: RuleFinding[] = [...seen.values()].map((f) => ({
    target: f.target,
    problem: `${f.problem} (at ${f.widths.join(" and ")}px)`,
  }));
  const note =
    `${runs.map((r) => `${r.stops.length} stops at ${r.width}px`).join(", ")}; ${findings.length} finding(s)` +
    (offScreen > 0 ? `; ${offScreen} stop(s) outside the viewport not measured` : "") +
    (inFrames > 0 ? `; ${inFrames} stop(s) inside frames not measured` : "");
  // Nothing measured and nothing found is not a pass: no ring was seen.
  if (measured === 0 && findings.length === 0) {
    return { ...base, status: "unmeasured", findings, note: `no stop could be measured: ${note}` };
  }
  return { ...base, status: findings.length === 0 ? "pass" : "fail", findings, note };
}

export const FOCUS_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/** Tab through `url` at each width, under reduced motion. */
export async function checkFocusRing(browser: Browser, url: string): Promise<RuleOutcome> {
  const runs: FocusRun[] = [];
  for (const viewport of FOCUS_VIEWPORTS) {
    runs.push({
      width: viewport.width,
      stops: await withPage(browser, { viewport, reducedMotion: "reduce" }, url, tabThrough),
    });
  }
  return summarizeFocusRing(url, runs);
}

export const focusRingRule: DesignRule = {
  id: "R12",
  title: "Keyboard focus is always visible",
  check: (browser, url) => checkFocusRing(browser, url),
};
