/// <reference lib="dom" />
import type { Browser, BrowserContextOptions, Page } from "@playwright/test";
import { revealBelowFold } from "../util/reveal-below-fold.js";
import { withPage } from "./load.js";
import type { DesignRule, RuleFinding, RuleOutcome } from "./types.js";

// R4 in docs/design-review-rules-2026-09.md: nothing needs JavaScript to become
// visible. The check renders the page twice and compares what a reader sees in
// `<main>`:
//
//   - WITH JavaScript, under reduced motion, once the network is idle, after
//     revealBelowFold has scrolled the page and let every reveal settle,
//     SETTLE_MIN_MS later, and once two samples SETTLE_GAP_MS apart agree (a
//     script that decides the layout late, beachfront's `isMobile`, has then
//     run): the page as designed. It then keeps sampling through
//     STEADY_WINDOW_MS, and only what every sample shows counts as visible: a
//     slideshow's slides come and go (sliding, fading, any width) and are not
//     judged, so the verdict does not depend on which slide a sample caught.
//   - WITHOUT JavaScript, and with NO reduced-motion preference. A reveal's
//     hidden state often sits behind `prefers-reduced-motion: no-preference`
//     (the starters' `[data-reveal]`), so a no-JS render under `reduce` would
//     pass vacuously (vida-legacy-foundation's tests/smoke/pages.spec.ts).
//
// Both renders finish every CSS animation before they are read, so a pure-CSS
// entrance is read at its end, as a visitor sees it a moment later.
//
// Every text visible with JavaScript must be visible without it, and so must
// every image (with a source to show), video, iframe, SVG, `aria-label` and
// `[data-reveal]`. That catches a reveal stranded at opacity 0 (vida #51: the
// hero's only <h1> inside a `.reveal` that only script un-hides), a count-up
// that ships its start value (vida #52: "0+", "0 people"), copy only a script
// renders, and a full-screen cover (a preloader) that only script removes.
// Visible means a box of at least 2×2 px, not `visibility: hidden`, an opacity
// (own times ancestors') of at least 0.1, text that is not transparent, and a
// box not clipped away by an ancestor that clips (overflow, clip-path) nor
// pushed off the page.
//
// Elements pair by place (a class-free path, since script adds classes, and
// which occurrence of it), then by text: a text that script splits into words,
// or copies into a marquee, is still matched, and an element script inserts
// ahead of its siblings does not shift them into findings (a text served at a
// place that script moved elsewhere was moved, not replaced). Not failures:
// copy in a container that also holds a `<noscript>` alternative; a number
// script updates (a year), unless the served value is zero (a count-up); a date
// or time script rewrites ("January 5, 2026" to "9 months ago", hours to "Open
// now"), unless the served value is a zero; and, on a page with no <main>,
// layers that are fixed or dialogs (a consent banner), since the whole <body>
// is read there.
//
// Both renders run at 1440×900 and at 390×844, and open shadow roots are read
// with the page, slotted light children included.
//
// Not covered: a control that is visible and dead before the bundle arrives
// (roalson #47), the other half of R4, which needs the bundle blocked with
// script on; text outside <main> on a page that has one; text inside iframes
// and closed shadow roots; a count-up that ships a non-zero start ("12" to
// "1,200"), which reads as a year; a carousel that cannot be advanced without
// JavaScript (its later slides are not judged); copy that keeps changing on
// its own (a rotating headline, a ticker), which is not steady; an image or
// embed only script mounts, without alt or title, beside a served one without
// either (both read `image ""`); and copy a script renders more than
// SETTLE_MIN_MS after load and after the samples agree.

/** How long the JS render waits after revealing before it samples: a late
 *  script (a review widget, a layout decided on a timer) has run by then. */
const SETTLE_MIN_MS = 2000;
/** The gap between the JS render's samples, until two agree, and through the
 *  steady window. */
const SETTLE_GAP_MS = 500;
/** Samples the JS render takes at most before it reads the last one. */
const SETTLE_TRIES = 8;
/** How long the JS render keeps sampling once it has settled. Only what is
 *  visible in every sample of this window is judged: a slide an autoplay
 *  brings on screen (sliding, fading, any width) is absent from some. */
const STEADY_WINDOW_MS = 6000;

export type TextItem = {
  /** The path shown to a reader. */
  target: string;
  /** The same place without classes (which script adds and removes), to pair
   *  the two renders. */
  key: string;
  /** The element's own text, or for an element without text, its kind and
   *  name: `image "alt"`, `video src`, `"aria label"`, `reveal`. */
  text: string;
  visible: boolean;
};

export type TextSample = {
  /** True when the page parsed with scripting off: `<noscript>` content
   *  parses as elements only then. False in the no-JS render means the
   *  emulation did not take, so the comparison means nothing. */
  scriptingOff: boolean;
  /** Elements in <main>, or in <body> less its fixed layers and dialogs. */
  items: TextItem[];
  /** The keys of the elements that hold a `<noscript>`. */
  noscriptKeys: string[];
  /** A fixed layer over 90% or more of the viewport, at its centre, or null. */
  cover: string | null;
  /** Items the JS render showed but not in every sample of its steady
   *  window (an autoplay's slides), so not judged. Set by the JS render. */
  unsteady?: number;
  /** True when the page had no <main> and <body> was read. */
  noMain: boolean;
};

/**
 * Runs IN THE PAGE through `page.evaluate`, under revealBelowFold's rules:
 * self-contained, no import, no module-scope identifier, no named inner
 * function.
 */
export function sampleVisibleText(): TextSample {
  for (const animation of document.getAnimations()) {
    try {
      animation.finish();
    } catch {
      // An endless animation cannot finish; it is left as it is.
    }
  }
  const probe = document.createElement("div");
  probe.innerHTML = "<noscript><i></i></noscript>";
  const main = document.querySelector("main, [role=main]");
  const root = main ?? document.body;
  const docWidth = document.documentElement.scrollWidth;
  // The subtree in document order, entering open shadow roots and keeping the
  // light children a shadow root slots.
  const order: Element[] = [];
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    order.push(el);
    const children = [
      ...Array.from(el.shadowRoot ? el.shadowRoot.children : []),
      ...Array.from(el.children),
    ];
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
  const pending: Array<{
    el: Element;
    kind: "item" | "noscript" | "cover";
    text: string;
    visible: boolean;
  }> = [];
  for (const el of order) {
    if (el.tagName === "NOSCRIPT") {
      if (el.parentElement) {
        pending.push({ el: el.parentElement, kind: "noscript", text: "", visible: false });
      }
      continue;
    }
    // These have no box; leaving them out early saves the style reads.
    if (["SCRIPT", "STYLE", "TEMPLATE"].includes(el.tagName)) continue;
    if (!main) {
      // With no <main>, a fixed layer or a dialog is chrome (a consent banner).
      let layer = false;
      for (
        let node: Element | null = el;
        node && node !== document.body;
        node = node.parentElement
      ) {
        if (
          node.tagName === "DIALOG" ||
          node.getAttribute("role") === "dialog" ||
          getComputedStyle(node).position === "fixed"
        ) {
          layer = true;
          break;
        }
      }
      if (layer) continue;
    }
    let own = "";
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) own += node.textContent ?? "";
    }
    let text = own.replace(/\s+/g, " ").trim();
    const ownText = text !== "";
    if (!ownText) {
      const label = el.getAttribute("aria-label");
      if (el instanceof HTMLImageElement) {
        // Named by its alt, never its source: a blur-up script swaps the source.
        text = `image "${el.alt}"`;
      } else if (el instanceof HTMLIFrameElement) {
        text = `iframe "${el.title}"`;
      } else if (el instanceof HTMLVideoElement) {
        text = `video ${el.getAttribute("src") ?? ""}`.trim();
      } else if (label) text = `"${label}"`;
      else if (el.tagName === "svg") text = "svg";
      else if (el.hasAttribute("data-reveal")) text = "reveal";
      else continue;
    }
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    let opacity = 1;
    let clipped = false;
    for (let node: Element | null = el; node;) {
      const s = getComputedStyle(node);
      opacity *= Number(s.opacity);
      if (/opacity\(0(\.0*)?\)/.test(s.filter)) opacity = 0;
      if (
        node !== el &&
        (s.overflowX !== "visible" || s.overflowY !== "visible" || s.clipPath !== "none")
      ) {
        // A clipping ancestor: the element must overlap its box.
        const box = node.getBoundingClientRect();
        if (
          rect.right <= box.left ||
          rect.left >= box.right ||
          rect.bottom <= box.top ||
          rect.top >= box.bottom
        ) {
          clipped = true;
        }
      }
      node = node.parentElement ?? ((node.getRootNode() as ShadowRoot).host || null);
    }
    if (/inset\([^)]*100%/.test(style.clipPath)) clipped = true;
    const offPage = rect.right + scrollX <= 0 || rect.left + scrollX >= docWidth;
    const ink = /rgba?\(([^)]+)\)/.exec(style.color)?.[1]?.split(",");
    const fill = /rgba?\(([^)]+)\)/
      .exec(style.getPropertyValue("-webkit-text-fill-color"))?.[1]
      ?.split(",");
    const transparent =
      ownText &&
      ((ink?.length === 4 && Number(ink[3]) === 0) ||
        (fill?.length === 4 && Number(fill[3]) === 0));
    // An image with no source to show (a lazysizes `data-src` a script copies
    // in) renders its alt text, not the image.
    const unsourced =
      el instanceof HTMLImageElement &&
      !el.getAttribute("src") &&
      !el.getAttribute("srcset") &&
      !el.parentElement?.querySelector("source[srcset]");
    const visible =
      !unsourced &&
      rect.width >= 2 &&
      rect.height >= 2 &&
      style.visibility === "visible" &&
      opacity >= 0.1 &&
      !transparent &&
      !clipped &&
      !offPage;
    pending.push({ el, kind: "item", text, visible });
  }
  // A full-screen cover at the viewport's centre: a fixed layer of 90% or more.
  for (
    let node: Element | null = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    node && node !== document.body;
    node = node.parentElement
  ) {
    const r = node.getBoundingClientRect();
    if (
      getComputedStyle(node).position === "fixed" &&
      r.width * r.height >= 0.9 * innerWidth * innerHeight
    ) {
      pending.push({ el: node, kind: "cover", text: "", visible: true });
      break;
    }
  }
  const items: TextItem[] = [];
  const noscriptKeys: string[] = [];
  let cover: string | null = null;
  for (const item of pending) {
    // A path a reader can paste into querySelector, as R2 builds it, and the
    // same path with tags and ids only.
    const parts: string[] = [];
    const keyParts: string[] = [];
    let node: Element | null = item.el;
    while (node && parts.length < 8) {
      const tag = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`${tag}#${CSS.escape(node.id)}`);
        keyParts.unshift(`${tag}#${CSS.escape(node.id)}`);
        break;
      }
      let part = tag;
      let keyPart = tag;
      const classes = Array.from(node.classList).slice(0, 2);
      if (classes.length > 0) part += classes.map((c) => `.${CSS.escape(c)}`).join("");
      const parent: Element | null = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        if (same.length > 1) {
          part += `:nth-of-type(${same.indexOf(node) + 1})`;
          keyPart += `:nth-of-type(${same.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      keyParts.unshift(keyPart);
      if (node === root || node === document.body) break;
      if (parent) node = parent;
      else {
        const host: Element | null = (node.getRootNode() as ShadowRoot).host ?? null;
        if (host) {
          parts.unshift("::shadow");
          keyParts.unshift("::shadow");
        }
        node = host;
      }
    }
    const target = parts.join(" > ").replace(/ > ::shadow > /g, " ::shadow ");
    const key = keyParts.join(" > ").replace(/ > ::shadow > /g, " ::shadow ");
    if (item.kind === "noscript") noscriptKeys.push(key);
    else if (item.kind === "cover") cover = target;
    else items.push({ target, key, text: item.text, visible: item.visible });
  }
  return {
    scriptingOff: probe.querySelector("i") !== null,
    items,
    noscriptKeys,
    cover,
    noMain: main === null,
  };
}

const quote = (text: string): string => `"${text.length > 60 ? `${text.slice(0, 57)}…` : text}"`;

/** A value only digits and separators make up: a year, a date, a total. */
const NUMBER = /^[\d\s.,:/–-]+$/;
/** A date or a time, written out: a month name beside a number, a clock
 *  time, a relative date ("3 days ago"). */
const DATE_OR_TIME =
  /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?\s+\d|\d\s+(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b|\d{1,2}:\d{2}|\b\d{1,2}\s?(am|pm)\b|\b\d+\s+\w+\s+ago\b/i;

/** One width's pair of renders. */
type NoJsPair = { width: number; withJs: TextSample; withoutJs: TextSample };

/**
 * R4's verdict from each width's two renders. PURE. Each thing visible with
 * JavaScript is looked for without it, at the same place first:
 *
 *   - the same text there, visible: fine; hidden: "hidden";
 *   - another text there, visible, that script does not show elsewhere:
 *     "reads X without JavaScript" (unless both are numbers and the served
 *     one is not zero, a year; or both are dates or times);
 *   - otherwise, by text: fine if the text is visible anywhere without
 *     JavaScript (a marquee's copy), or inside the element that held it
 *     before script split it into words; "hidden" at an invisible copy if
 *     there is one; fine inside a container that holds a `<noscript>`
 *     alternative; else "not rendered".
 *
 * A cover only the no-JS render has is a finding of its own. A finding seen at
 * both widths is reported once, with the widths.
 */
export function summarizeNoJs(url: string, pairs: NoJsPair[]): RuleOutcome {
  const base = { rule: "R4" as const, url };
  const unmeasured = (note: string): RuleOutcome => ({
    ...base,
    status: "unmeasured",
    findings: [],
    note,
  });
  if (pairs.length === 0) return unmeasured("no render was taken");
  if (pairs.some((p) => !p.withoutJs.scriptingOff)) {
    return unmeasured("scripting was on in the no-JS render, so the emulation did not take");
  }
  if (pairs.some((p) => p.withJs.scriptingOff)) {
    return unmeasured("scripting was off in the JS render");
  }
  if (pairs.some((p) => !p.withJs.items.some((i) => i.visible))) {
    return unmeasured("nothing visible with JavaScript");
  }
  const nth = (items: TextItem[]) => {
    const seen = new Map<string, number>();
    return items.map((i) => {
      const k = seen.get(i.key) ?? 0;
      seen.set(i.key, k + 1);
      return { ...i, place: `${i.key}\u0000${k}` };
    });
  };
  const byProblem = new Map<string, { target: string; problem: string; widths: number[] }>();
  const add = (width: number, place: string, target: string, problem: string) => {
    const key = `${place}\u0000${problem}`;
    const seen = byProblem.get(key) ?? { target, problem, widths: [] };
    seen.widths.push(width);
    byProblem.set(key, seen);
  };
  let shownTotal = 0;
  for (const { width, withJs, withoutJs } of pairs) {
    const shownWithJs = new Set(withJs.items.filter((i) => i.visible).map((i) => i.text));
    const noJs = nth(withoutJs.items);
    const byPlace = new Map(noJs.map((i) => [i.place, i]));
    const visibleNoJs = noJs.filter((i) => i.visible);
    if (withoutJs.cover && withoutJs.cover !== withJs.cover) {
      add(width, "\u0000cover", withoutJs.cover, "covers the page without JavaScript");
    }
    for (const i of nth(withJs.items)) {
      if (!i.visible) continue;
      shownTotal += 1;
      const there = byPlace.get(i.place);
      if (there && there.text === i.text) {
        if (!there.visible) {
          add(width, i.place, there.target, `${quote(i.text)} is hidden without JavaScript`);
        }
        continue;
      }
      // A text served here that script shows elsewhere was moved (an element
      // inserted ahead of its siblings), not replaced: judged by text below.
      if (there && there.visible && !shownWithJs.has(there.text)) {
        const year = NUMBER.test(i.text) && NUMBER.test(there.text) && /[1-9]/.test(there.text);
        // Both dates or times, the served one not a zero (a count-up's start).
        const dateOrTime =
          DATE_OR_TIME.test(i.text) && DATE_OR_TIME.test(there.text) && /[1-9]/.test(there.text);
        if (!year && !dateOrTime) {
          add(
            width,
            i.place,
            there.target,
            `reads ${quote(there.text)} without JavaScript, ${quote(i.text)} with it`,
          );
        }
        continue;
      }
      // The same text visible elsewhere (a marquee's copy), or inside the
      // element that held it before script split it into words.
      const elsewhere = visibleNoJs.some(
        (n) => n.text === i.text || (i.key.startsWith(`${n.key} > `) && n.text.includes(i.text)),
      );
      if (elsewhere) continue;
      const hidden = noJs.find((n) => n.text === i.text && !n.visible);
      if (hidden) {
        add(width, i.place, hidden.target, `${quote(i.text)} is hidden without JavaScript`);
        continue;
      }
      if (withoutJs.noscriptKeys.some((k) => i.key === k || i.key.startsWith(`${k} > `))) continue;
      add(width, i.place, i.target, `${quote(i.text)} is not rendered without JavaScript`);
    }
  }
  const findings: RuleFinding[] = [...byProblem.values()].map((f) => ({
    target: f.target,
    problem: `${f.problem} (at ${f.widths.join(" and ")}px)`,
  }));
  const noMain = pairs.some((p) => p.withJs.noMain);
  const unsteady = Math.max(0, ...pairs.map((p) => p.withJs.unsteady ?? 0));
  return {
    ...base,
    status: findings.length === 0 ? "pass" : "fail",
    findings,
    note:
      `${shownTotal} visible item(s) with JavaScript across ${pairs.map((p) => `${p.width}px`).join(" and ")}; ${findings.length} missing without it` +
      (noMain ? "; no <main>, so <body> was read, its fixed layers and dialogs left out" : "") +
      (unsteady > 0
        ? `; ${unsteady} item(s) came and went with JavaScript (a slideshow), not judged`
        : ""),
  };
}

const NO_JS_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

const WITH_JS_CONTEXT: BrowserContextOptions = { reducedMotion: "reduce" };

export const WITHOUT_JS_CONTEXT: BrowserContextOptions = {
  javaScriptEnabled: false,
  reducedMotion: "no-preference",
};

/** The JS render: wait for the network to go quiet, reveal everything, then
 *  sample until two samples SETTLE_GAP_MS apart see the same visible things. */
async function settledSample(page: Page, windowMs: number): Promise<TextSample> {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.evaluate(revealBelowFold);
  await page.waitForTimeout(SETTLE_MIN_MS);
  const shown = (s: TextSample) =>
    s.items
      .filter((x) => x.visible)
      .map((x) => `${x.key}\u0000${x.text}`)
      .join("\u0001");
  let last = await page.evaluate(sampleVisibleText);
  for (let i = 1; i < SETTLE_TRIES; i++) {
    await page.waitForTimeout(SETTLE_GAP_MS);
    const next = await page.evaluate(sampleVisibleText);
    const same = shown(next) === shown(last);
    last = next;
    if (same) break;
  }
  // The steady window: an item is visible with JavaScript only if every
  // sample shows it.
  const steady = new Set(shown(last).split("\u0001"));
  for (let t = 0; t < windowMs; t += SETTLE_GAP_MS) {
    await page.waitForTimeout(SETTLE_GAP_MS);
    const now = new Set(shown(await page.evaluate(sampleVisibleText)).split("\u0001"));
    for (const k of steady) if (!now.has(k)) steady.delete(k);
  }
  const unsteady = last.items.filter(
    (x) => x.visible && !steady.has(`${x.key}\u0000${x.text}`),
  ).length;
  return {
    ...last,
    unsteady,
    items: last.items.map((x) =>
      x.visible && !steady.has(`${x.key}\u0000${x.text}`) ? { ...x, visible: false } : x,
    ),
  };
}

async function render(
  browser: Browser,
  url: string,
  options: BrowserContextOptions,
  windowMs: number,
): Promise<TextSample> {
  return withPage(browser, options, url, (page) =>
    // Without script nothing changes after load, and a frame-and-timer wait
    // never resolves in a page with scripting off.
    options.javaScriptEnabled === false
      ? page.evaluate(sampleVisibleText)
      : settledSample(page, windowMs),
  );
}

/** Render `url` with and without JavaScript at each width and compare. A
 *  test passes another no-JS context to prove the emulation check. */
export async function checkNoJs(
  browser: Browser,
  url: string,
  withoutJs: BrowserContextOptions = WITHOUT_JS_CONTEXT,
  windowMs = STEADY_WINDOW_MS,
): Promise<RuleOutcome> {
  const pairs: NoJsPair[] = [];
  for (const viewport of NO_JS_VIEWPORTS) {
    pairs.push({
      width: viewport.width,
      withJs: await render(browser, url, { ...WITH_JS_CONTEXT, viewport }, windowMs),
      withoutJs: await render(browser, url, { ...withoutJs, viewport }, windowMs),
    });
  }
  return summarizeNoJs(url, pairs);
}

export const noJsRule: DesignRule = {
  id: "R4",
  title: "Nothing needs JavaScript to become visible",
  check: (browser, url) => checkNoJs(browser, url),
};
