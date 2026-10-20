import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "@playwright/test";
import {
  checkReducedMotion,
  reducedMotionRule,
  summarizeReducedMotion,
  MOTION_WAIT_MS,
  type MotionRun,
} from "../../../src/audits/design-rules/reduced-motion.js";
import { DESIGN_RULES, runDesignRules } from "../../../src/audits/design-rules/index.js";

/**
 * R2, RUN FOR REAL. Each page below is served to a real Chromium and checked
 * the way scripts/design-rules.mts checks it. The known-good page passes
 * first: until it does, a FAIL from the check is the instrument's, not the
 * page's (the workspace CLAUDE.md, "Prove the instrument").
 */

/** reddoor-starter `src/app.css` at b58bde9 (#135): durations AND delays zeroed. */
const RESET_AFTER_135 = `@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    transition-delay: 0ms !important;
    scroll-behavior: auto !important;
  }
}`;

/** The same block one commit earlier (b58bde9^), and in beachfront-dentistry
 *  before df53dee: durations zeroed, delays not. */
const RESET_BEFORE_135 = `@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}`;

/** Motion a page legitimately carries for readers who have not asked for less:
 *  beachfront's AnimateInTriggered (Tailwind `transition delay-1000`, 2000ms),
 *  a delayed keyframe entrance, and the starter's infinite `pos-y-wiggle`. */
const MOTION = `
@keyframes rise { from { opacity: 0; transform: translateY(22px) } to { opacity: 1; transform: none } }
@keyframes pos-y-wiggle { 0% { transform: translateY(1px) } 50% { transform: translateY(-1px) } 100% { transform: translateY(1px) } }
.animate-in-triggered { transition-property: opacity, transform; transition-duration: 2000ms; transition-delay: 1000ms; }
.entrance { animation: rise 600ms 1200ms both; }
.wiggle { animation: 1s infinite pos-y-wiggle ease-out; }`;

const MOTION_MARKUP = `
<div class="animate-in-triggered">Booked in seconds</div>
<h2 class="entrance">Our team</h2>
<span class="wiggle">↓</span>`;

function page(css: string, body: string, script = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>R2</title><style>${css}</style></head><body><main><h1>R2</h1>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;
}

const BOTH = "(at 1440 and 390px)";

const PAGES: Record<string, string> = {
  "/good": page(`${MOTION}\n${RESET_AFTER_135}`, MOTION_MARKUP),
  "/before-135": page(`${MOTION}\n${RESET_BEFORE_135}`, MOTION_MARKUP),
  // Only an animation delay is left: the check must see the computed
  // animation-delay itself (mutation 1 of the brief).
  "/animation-delay-only": page(
    `@keyframes rise { from { opacity: 0 } to { opacity: 1 } }
     .entrance { animation: rise 0.01ms 1500ms both; }`,
    `<h2 class="entrance">Our team</h2>`,
  ),
  "/no-reset": page(
    `@keyframes pos-y-wiggle { 0% { transform: translateY(1px) } 100% { transform: translateY(-1px) } }
     .wiggle { animation: 1s infinite pos-y-wiggle ease-out; }`,
    `<span class="wiggle">↓</span>`,
  ),
  // An untriggered menu slide: nothing runs at sample time, but its duration
  // is 600ms under reduce.
  "/menu-duration": page(
    `.menu { transform: translateX(100%); transition: transform 600ms; } .menu.open { transform: none; }`,
    `<nav class="menu">Menu</nav>`,
  ),
  // A Web Animations API entrance (what Svelte transitions run on), which the
  // CSS reset cannot reach: the good reset is present and does not help.
  "/waapi": page(
    RESET_AFTER_135,
    `<p id="intro">Hello</p>`,
    `document.getElementById("intro").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 4000, fill: "both" });`,
  ),
  "/paused": page(
    `@keyframes r { from { opacity: 0 } to { opacity: 1 } } .rev { animation: r 1s both paused; }`,
    `<p class="rev">Stuck at the first frame</p>`,
  ),
  "/pseudo-delay": page(
    `.btn::after { content: ""; display: block; height: 2px; transition: opacity 0.01ms 800ms; }`,
    `<a class="btn" href="#x">Book</a>`,
  ),
  // Motion only a 390px viewport has.
  "/mobile-only": page(
    `@media (max-width: 768px) { .nav a { transition: opacity 0.01ms 300ms; } }`,
    `<div class="nav"><a href="#a">A</a></div>`,
  ),
  // Motion that starts once scrolled into view, two screens down.
  "/below-fold": page(
    `@keyframes spin { to { transform: rotate(1turn) } }
     .spacer { height: 2400px } .spin { animation: spin 2s linear infinite; }`,
    `<div class="spacer"></div><div id="late">Late</div>`,
    `new IntersectionObserver(([e], o) => { if (e.isIntersecting) { e.target.classList.add("spin"); o.disconnect(); } }).observe(document.getElementById("late"));`,
  ),
  // The same, inside a page that scrolls a container and not the window.
  "/container-scroll": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>R2</title>
<style>html, body { height: 100%; margin: 0; overflow: hidden } main { height: 100%; overflow-y: auto } .spacer { height: 3000px }</style></head>
<body><main><h1>R2</h1><div class="spacer"></div><p id="late">Late</p></main>
<script>new IntersectionObserver(([e], o) => { if (e.isIntersecting) { e.target.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 3000 }); o.disconnect(); } }).observe(document.getElementById("late"));</script></body></html>`,
  "/raf": page(
    `#mover { position: relative; left: 0 }`,
    `<div id="mover">Sliding</div>`,
    `const el = document.getElementById("mover"); const t0 = performance.now();
     (function step(t) { el.style.left = Math.min(300, ((t - t0) / 5000) * 300) + "px"; if (t - t0 < 5000) requestAnimationFrame(step); })(t0);`,
  ),
  "/timer": page(
    RESET_AFTER_135,
    `<p id="late">Hello</p>`,
    `setTimeout(() => document.getElementById("late").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 2000 }), 400);`,
  ),
  "/shadow": page(
    "",
    `<x-card></x-card><x-menu></x-menu>`,
    `customElements.define("x-card", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = "<style>@keyframes s { to { transform: rotate(1turn) } } .s { animation: s 2s linear infinite }</style><i class=s>x</i>"; } });
     customElements.define("x-menu", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = "<style>.m { transition: transform 0.01ms 900ms }</style><b class=m>m</b>"; } });`,
  ),
  "/iframe": page("", `<iframe src="/inner" title="inner"></iframe>`),
  "/inner": page(
    `@keyframes spin { to { transform: rotate(1turn) } } .spin { animation: spin 2s linear infinite; }`,
    `<i class="spin">*</i><div id="mover">m</div>`,
    `const el = document.getElementById("mover"); const t0 = performance.now();
     (function step(t) { el.style.transform = "translateX(" + ((t - t0) / 20) + "px)"; if (t - t0 < 8000) requestAnimationFrame(step); })(t0);`,
  ),
  // Two elements on one short path: both must be reported, apart.
  "/two-cards": page(
    `.t { transition: opacity 0.01ms 600ms } .card:nth-of-type(2) .t { transition-delay: 100ms }`,
    `<div class="card"><p class="t">A</p></div><div class="card"><p class="t">B</p></div>`,
  ),
  // Two Web Animations held near their end: 30ms left is under the floor,
  // 200ms left is not.
  "/floor": page(
    "",
    `<p id="tail">a</p><p id="left">b</p>`,
    `for (const [id, at] of [["tail", 970], ["left", 800]]) {
       const a = document.getElementById(id).animate([{ opacity: 0 }, { opacity: 1 }], 1000);
       a.currentTime = at; a.playbackRate = 1e-4;
     }`,
  ),
  // Motion that starts only when the page scrolls back up to the top.
  "/on-scroll-up": page(
    `.spacer { height: 2400px }`,
    `<p id="top">Top</p><div class="spacer"></div>`,
    `let low = 0; addEventListener("scroll", () => {
       if (scrollY > low) low = scrollY;
       else if (scrollY === 0 && low > 0) document.getElementById("top").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 5000 });
     });`,
  ),
  // Round 2's false passes, each a page that breaks R2:
  // a tween on an element whose finished fill-forwards entrance stays listed;
  "/fill-gate": page(
    `@keyframes fade { from { opacity: 0 } to { opacity: 1 } } .box { animation: fade 0.01ms both; }`,
    `<div class="box" id="box">Box</div>`,
    `const el = document.getElementById("box"); const t0 = performance.now();
     (function step(t) { el.style.transform = "translateX(" + ((t - t0) / 20) + "px)"; if (t - t0 < 8000) requestAnimationFrame(step); })(t0);`,
  ),
  // a rAF tween on a page with the reset, which gives every style write a
  // 0.01ms transition;
  "/raf-with-reset": page(
    RESET_AFTER_135,
    `<div id="mover">Sliding</div>`,
    `const el = document.getElementById("mover"); const t0 = performance.now();
     (function step(t) { el.style.marginLeft = ((t - t0) / 20) + "px"; if (t - t0 < 8000) requestAnimationFrame(step); })(t0);`,
  ),
  // keyframes that arrive by @import, and a shadow host's own :host keyframes;
  "/import-kf": page(
    `@import url(/kf.css); .menu { display: none; animation: rise 400ms 300ms both; }`,
    `<nav class="menu">Menu</nav>`,
  ),
  "/kf.css": "@keyframes rise { from { opacity: 0 } to { opacity: 1 } }",
  "/host-kf": page(
    "",
    `<x-pop></x-pop>`,
    `customElements.define("x-pop", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = "<style>@keyframes pop { from { opacity: 0 } to { opacity: 1 } } :host { display: none; animation: pop 400ms 300ms both }</style>"; } });`,
  ),
  // a scroll-triggered 800ms rAF reveal halfway down a long page;
  "/scroll-reveal": page(
    `.spacer { height: 1200px } .tall { height: 6000px }`,
    `<div class="spacer"></div><div id="card">Card</div><div class="tall"></div>`,
    `new IntersectionObserver(([e], o) => { if (!e.isIntersecting) return; o.disconnect();
       const el = e.target; const t0 = performance.now();
       (function step(t) { const k = Math.min(1, (t - t0) / 800); el.style.opacity = String(k); el.style.transform = "translateY(" + (40 - 40 * k) + "px)"; if (k < 1) requestAnimationFrame(step); })(t0);
     }).observe(document.getElementById("card"));`,
  ),
  // motion inside an iframe the page writes itself;
  "/srcdoc": page(
    "",
    `<iframe title="s" srcdoc="<style>@keyframes s { to { transform: rotate(1turn) } } i { display: inline-block; animation: s 2s linear infinite }</style><i>*</i>"></iframe>`,
  ),
  // a view() reveal, which the rule's check names ("scroll-driven heroes");
  "/view-reveal": page(
    `@keyframes up { from { opacity: 0; transform: translateY(80px) } to { opacity: 1; transform: none } }
     .r { animation: up linear both; animation-timeline: view(); } .spacer { height: 1200px }`,
    `<div class="spacer"></div><p class="r">Reveal</p><div class="spacer"></div>`,
  ),
  // an endless flicker behind a delay: both are said.
  "/infinite-delay": page(
    `@keyframes s { to { opacity: .5 } } .f { animation: s 0.01ms 400ms infinite; }`,
    `<p class="f">Flicker</p>`,
  ),
  // Round 2's unheld behaviours:
  // a spin that runs only while its element, mid-page, is on screen, so only
  // a sample at that scroll step sees it;
  "/mid-page": page(
    `@keyframes spin { to { transform: rotate(1turn) } } .spacer { height: 2400px } .on { animation: spin 2s linear infinite; }`,
    `<div class="spacer"></div><p id="mid">Mid</p><div class="spacer"></div>`,
    `new IntersectionObserver(([e]) => e.target.classList.toggle("on", e.isIntersecting)).observe(document.getElementById("mid"));`,
  ),
  // a transition the page triggers that is still inside its delay;
  "/triggered-delay": page(
    `.t { opacity: 0; transition: opacity 0.01ms 3000ms } .t.in { opacity: 1 }`,
    `<p class="t">Late</p>`,
    `requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector(".t").classList.add("in")));`,
  ),
  // keyframes nested in @media, for a menu that has not opened;
  "/nested-kf": page(
    `@media all { @keyframes slide { from { transform: translateX(100%) } to { transform: none } } }
     .menu { display: none; animation: slide 400ms both; }`,
    `<nav class="menu">Menu</nav>`,
  ),
  // a slide a script swaps every 400ms, instantly: reduce allows a swap.
  "/swap": page(
    RESET_AFTER_135,
    `<p id="slide" style="opacity: 1">One</p>`,
    `let on = true; setInterval(() => { on = !on; document.getElementById("slide").style.opacity = on ? "1" : "0"; }, 400);`,
  ),
  // Round 2's false fails: honouring pages each.
  "/honouring": page(
    `${RESET_AFTER_135}
     @keyframes marquee { to { transform: translateX(-50%) } }
     .m { animation: marquee 20s linear infinite; }
     @media (prefers-reduced-motion: reduce) { .m { animation-play-state: paused; } }
     a { transition: color 300ms; }
     .lazy { opacity: 0; transition: opacity 600ms } .lazy.loaded { opacity: 1 }
     header { position: fixed; top: 0 }`,
    `<header id="bar">Bar</header><div class="m">News · News · News</div><a href="#x">Hover me</a>
     <img class="lazy" alt="" width="10" height="10" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
     <div id="slides" style="transform: translateX(0)">Slides</div>`,
    `setTimeout(() => document.querySelector(".lazy").classList.add("loaded"), 700);
     setTimeout(() => { document.getElementById("bar").style.top = "-1px"; }, 900);
     setTimeout(() => { document.getElementById("slides").style.transform = "translateX(-100%)"; }, 1100);`,
  ),
  // The same honouring with no reset at all, where the colour fade and the
  // marquee keep their real durations.
  "/honouring-no-reset": page(
    `@keyframes marquee { to { transform: translateX(-50%) } }
     .m { animation: marquee 20s linear infinite; }
     @media (prefers-reduced-motion: reduce) { .m { animation-play-state: paused; } }
     a { transition: color 300ms, background-color 300ms; }`,
    `<div class="m">News · News · News</div><a href="#x">Hover me</a>`,
  ),
  // Not defects, each a false FAIL round 1 reproduced:
  "/not-defects": page(
    `${RESET_BEFORE_135}
     @keyframes grow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
     .progress { position: fixed; top: 0; height: 4px; width: 100%; animation: grow linear both; animation-timeline: scroll(); }
     .dead { animation: nonexistentKeyframes 1s ease 500ms both; }
     .extra { transition-property: opacity; transition-delay: 0s, 800ms; }
     .blink { transition: opacity 0.01ms 31ms; }
     .spacer { height: 2000px }`,
    `<div class="progress"></div><p class="dead">a</p><p class="extra">b</p><p class="blink">c</p><div class="spacer"></div>`,
  ),
};

let server: Server;
let base: string;
let browser: Browser;

beforeAll(async () => {
  server = createServer((req, res) => {
    // A frame on another origin: "localhost" from a page on "127.0.0.1".
    const port = (server.address() as AddressInfo).port;
    const html =
      req.url === "/cross"
        ? page("", `<iframe title="x" src="http://localhost:${port}/inner"></iframe>`)
        : PAGES[req.url ?? ""];
    const type = (req.url ?? "").endsWith(".css") ? "text/css" : "text/html; charset=utf-8";
    res.writeHead(html ? 200 : 404, { "content-type": type });
    res.end(html ?? "not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

/** The check as the CLI runs it, but with a 300ms last wait: only the timer
 *  case needs the full MOTION_WAIT_MS. */
async function run(path: string, waitMs = 300) {
  return checkReducedMotion(browser, `${base}${path}`, { reducedMotion: "reduce" }, waitMs);
}

describe("design-rules R2 (reduced motion), in a real browser", () => {
  it("is registered as R2", () => {
    expect(DESIGN_RULES.R2).toBe(reducedMotionRule);
  });

  it("PASSES the known-good page: the starter's reset after #135, over motion that is fine without reduce", async () => {
    const o = await run("/good");
    expect(o.status, o.note).toBe("pass");
    expect(o.findings).toEqual([]);
    expect(o.note).not.toMatch(/cap/);
  });

  it("FAILS the reset before #135: the delays survive under reduce", async () => {
    const o = await run("/before-135");
    expect(o.status).toBe("fail");
    expect(o.findings).toEqual([
      {
        target: "body > main > div.animate-in-triggered",
        problem: `transition-delay 1000ms under reduce ${BOTH}`,
      },
      {
        target: "body > main > h2.entrance",
        problem: `animation-delay 1200ms under reduce ${BOTH}`,
      },
    ]);
  });

  it("FAILS a page whose only defect is an animation delay, read from the computed style", async () => {
    const o = await run("/animation-delay-only");
    expect(o.findings).toEqual([
      {
        target: "body > main > h2.entrance",
        problem: `animation-delay 1500ms under reduce ${BOTH}`,
      },
    ]);
  });

  it("FAILS an infinite animation on a page with no reset, by its duration and by its running", async () => {
    const o = await run("/no-reset");
    expect(o.findings).toEqual([
      {
        target: "body > main > span.wiggle",
        problem: `animation-duration 1000ms under reduce ${BOTH}`,
      },
      {
        target: "body > main > span.wiggle",
        problem: `animation pos-y-wiggle still running under reduce (no end) ${BOTH}`,
      },
    ]);
  });

  it("FAILS an untriggered transition by its duration", async () => {
    const o = await run("/menu-duration");
    expect(o.findings).toEqual([
      {
        target: "body > main > nav.menu",
        problem: `transition-duration 600ms under reduce ${BOTH}`,
      },
    ]);
  });

  it("FAILS a Web Animations API entrance that the CSS reset cannot reach", async () => {
    const o = await run("/waapi");
    expect(o.findings).toHaveLength(1);
    expect(o.findings[0]!.target).toBe("p#intro");
    expect(o.findings[0]!.problem).toMatch(
      /^Web Animation still running under reduce \(\d+ms left\) \(at 1440 and 390px\)$/,
    );
  });

  it("FAILS an animation paused short of its end", async () => {
    const o = await run("/paused");
    expect(o.findings).toContainEqual({
      target: "body > main > p.rev",
      problem: `animation r paused with its element hidden under reduce ${BOTH}`,
    });
  });

  it("FAILS a delay on a ::after", async () => {
    const o = await run("/pseudo-delay");
    expect(o.findings).toEqual([
      {
        target: "body > main > a.btn::after",
        problem: `transition-delay 800ms under reduce ${BOTH}`,
      },
    ]);
  });

  it("FAILS motion only the phone viewport has, and says so", async () => {
    const o = await run("/mobile-only");
    expect(o.findings).toEqual([
      {
        target: "body > main > div.nav > a",
        problem: "transition-delay 300ms under reduce (at 390px)",
      },
    ]);
  });

  it("FAILS motion that starts only when scrolled into view", async () => {
    const o = await run("/below-fold");
    expect(o.findings).toEqual([
      { target: "div#late", problem: `animation-duration 2000ms under reduce ${BOTH}` },
      { target: "div#late", problem: `animation spin still running under reduce (no end) ${BOTH}` },
    ]);
  });

  it("FAILS motion below the fold of a page that scrolls a container, not the window", async () => {
    const o = await run("/container-scroll");
    expect(o.status).toBe("fail");
    expect(o.findings.map((f) => f.target)).toEqual(["p#late"]);
    expect(o.note).toMatch(/scrolled main/);
  });

  it("FAILS motion a script drives frame by frame", async () => {
    const o = await run("/raf");
    expect(o.findings).toEqual([
      { target: "div#mover", problem: `moved by script, frame by frame, under reduce ${BOTH}` },
    ]);
  });

  it("FAILS motion a timer starts after load", async () => {
    const o = await run("/timer", MOTION_WAIT_MS);
    expect(o.findings.map((f) => f.target)).toEqual(["p#late"]);
  });

  it("FAILS motion inside open shadow roots", async () => {
    const o = await run("/shadow");
    expect(o.findings.map((f) => `${f.target}: ${f.problem}`)).toEqual([
      `body > main > x-card ::shadow i.s: animation-duration 2000ms under reduce ${BOTH}`,
      `body > main > x-menu ::shadow b.m: transition-delay 900ms under reduce ${BOTH}`,
      `body > main > x-card ::shadow i.s: animation s still running under reduce (no end) ${BOTH}`,
    ]);
  });

  it("FAILS motion inside a same-origin iframe, scripted motion included", async () => {
    const o = await run("/iframe");
    expect(o.findings.map((f) => `${f.target}: ${f.problem.split(" (")[0]}`)).toEqual([
      `iframe[src="/inner"] :: body > main > i.spin: animation-duration 2000ms under reduce`,
      `iframe[src="/inner"] :: body > main > i.spin: animation spin still running under reduce`,
      `iframe[src="/inner"] :: div#mover: moved by script, frame by frame, under reduce`,
    ]);
  });

  it("does not sample a cross-origin frame, and says so", async () => {
    const o = await run("/cross");
    expect(o.status).toBe("pass");
    expect(o.note).toMatch(/; 1 frame\(s\) not sampled \(cross-origin or not answering\)$/);
  });

  it("FAILS motion only a sample at its own scroll step can see", async () => {
    const o = await run("/mid-page");
    expect(o.findings.map((f) => f.target)).toEqual(["p#mid", "p#mid"]);
  });

  it("FAILS a triggered transition still inside its delay, said once", async () => {
    const o = await run("/triggered-delay");
    expect(o.findings).toEqual([
      { target: "body > main > p.t.in", problem: `transition-delay 3000ms under reduce ${BOTH}` },
    ]);
  });

  it("FAILS an unopened menu whose keyframes sit inside @media", async () => {
    const o = await run("/nested-kf");
    expect(o.findings).toEqual([
      {
        target: "body > main > nav.menu",
        problem: `animation-duration 400ms under reduce ${BOTH}`,
      },
    ]);
  });

  it("PASSES a slide a script swaps instantly", async () => {
    const o = await run("/swap", MOTION_WAIT_MS);
    expect(o.findings).toEqual([]);
  });

  it("FAILS a script tween on an element a finished fill-forwards entrance still lists", async () => {
    const o = await run("/fill-gate");
    expect(o.findings).toEqual([
      { target: "div#box", problem: `moved by script, frame by frame, under reduce ${BOTH}` },
    ]);
  });

  it("FAILS a script tween on a page with the reset", async () => {
    const o = await run("/raf-with-reset");
    expect(o.findings).toEqual([
      { target: "div#mover", problem: `moved by script, frame by frame, under reduce ${BOTH}` },
    ]);
  });

  it("FAILS an animation whose keyframes arrive by @import", async () => {
    const o = await run("/import-kf");
    expect(o.findings.map((f) => f.problem)).toEqual([
      `animation-duration 400ms under reduce ${BOTH}`,
      `animation-delay 300ms under reduce ${BOTH}`,
    ]);
  });

  it("FAILS a shadow host's own :host animation, keyframes in its shadow root", async () => {
    const o = await run("/host-kf");
    expect(o.findings.map((f) => `${f.target}: ${f.problem}`)).toEqual([
      `body > main > x-pop: animation-duration 400ms under reduce ${BOTH}`,
      `body > main > x-pop: animation-delay 300ms under reduce ${BOTH}`,
    ]);
  });

  it("FAILS a script reveal that a scroll step starts and that ends before the next", async () => {
    const o = await run("/scroll-reveal");
    expect(o.findings).toEqual([
      { target: "div#card", problem: `moved by script, frame by frame, under reduce ${BOTH}` },
    ]);
  });

  it("FAILS motion in an iframe the page writes itself (srcdoc)", async () => {
    const o = await run("/srcdoc");
    expect(o.findings.map((f) => f.target)).toEqual([
      'iframe[src="about:srcdoc"] :: body > i',
      'iframe[src="about:srcdoc"] :: body > i',
    ]);
    expect(o.note).not.toMatch(/not sampled/);
  });

  it("FAILS a view() reveal", async () => {
    const o = await run("/view-reveal");
    expect(o.findings).toContainEqual({
      target: "body > main > p.r",
      problem: `animation up (view-driven) still running under reduce (no end) ${BOTH}`,
    });
  });

  it("says both the delay and the endless run of a delayed infinite animation", async () => {
    const o = await run("/infinite-delay");
    expect(o.findings.map((f) => f.problem)).toEqual([
      `animation-delay 400ms under reduce ${BOTH}`,
      `animation s still running under reduce (no end) ${BOTH}`,
    ]);
  });

  it("PASSES what honours reduce: a paused marquee, a colour fade, a late class, a snap, a header nudge", async () => {
    const o = await run("/honouring", MOTION_WAIT_MS);
    expect(o.findings).toEqual([]);
  });

  it("PASSES a paused marquee and a colour fade on a page with no reset", async () => {
    const o = await run("/honouring-no-reset");
    expect(o.findings).toEqual([]);
  });

  it("ignores an animation within PERCEPTIBLE_MS of its end, and reports one beyond it", async () => {
    const o = await run("/floor");
    expect(o.findings.map((f) => f.target)).toEqual(["p#left"]);
  });

  it("samples again back at the top", async () => {
    const o = await run("/on-scroll-up");
    expect(o.findings.map((f) => f.target)).toEqual(["p#top"]);
  });

  it("reports two elements on one short path apart, with paths querySelector accepts", async () => {
    const o = await run("/two-cards");
    expect(o.findings).toEqual([
      {
        target: "body > main > div.card:nth-of-type(1) > p.t",
        problem: `transition-delay 600ms under reduce ${BOTH}`,
      },
      {
        target: "body > main > div.card:nth-of-type(2) > p.t",
        problem: `transition-delay 100ms under reduce ${BOTH}`,
      },
    ]);
  });

  it("PASSES what is not a defect: a scroll-driven bar, a dead keyframe name, an unused list entry, a 31ms delay", async () => {
    const o = await run("/not-defects");
    expect(o.findings).toEqual([]);
    expect(o.status).toBe("pass");
    expect(o.note).toMatch(/1 scroll\(\) animation\(s\) not judged/);
  });

  it("is UNMEASURED, never a pass, when the context does not emulate reduce (negative control)", async () => {
    const o = await checkReducedMotion(browser, `${base}/before-135`, {
      reducedMotion: "no-preference",
    });
    expect(o.status).toBe("unmeasured");
    expect(o.note).toMatch(/did not take/);
  });

  it("is UNMEASURED when the page answers 404, or cannot load", async () => {
    const [missing] = await runDesignRules([`${base}/missing`], [reducedMotionRule], browser);
    expect(missing!.status).toBe("unmeasured");
    expect(missing!.note).toBe("the check threw: the page answered 404");
    const [down] = await runDesignRules(["http://127.0.0.1:9/"], [reducedMotionRule], browser);
    expect(down!.status).toBe("unmeasured");
  });
});

describe("summarizeReducedMotion", () => {
  const run = (width: number, samples: MotionRun["samples"]): MotionRun => ({
    width,
    samples,
    scrolled: "window",
    skippedFrames: 0,
  });
  const clean = { reduceMatched: true, items: [], scrollDriven: 0 };

  it("is unmeasured with no samples", () => {
    expect(summarizeReducedMotion("u", []).status).toBe("unmeasured");
  });

  it("reports a finding seen at several steps once, at its worst, with its widths", () => {
    const o = summarizeReducedMotion("u", [
      run(1440, [
        { ...clean, items: [{ target: "a", kind: "transition-delay", ms: 300 }] },
        { ...clean, items: [{ target: "a", kind: "transition-delay", ms: 900 }] },
      ]),
      run(390, [{ ...clean, items: [{ target: "b", kind: "running Web Animation", ms: 120.4 }] }]),
    ]);
    expect(o).toEqual({
      rule: "R2",
      url: "u",
      status: "fail",
      findings: [
        { target: "a", problem: "transition-delay 900ms under reduce (at 1440px)" },
        {
          target: "b",
          problem: "Web Animation still running under reduce (120ms left) (at 390px)",
        },
      ],
      note: "3 samples under reduce at 1440px and 390px (scrolled window); 2 finding(s)",
    });
  });

  it("is unmeasured when any one sample lost the emulation", () => {
    expect(
      summarizeReducedMotion("u", [run(1440, [clean, { ...clean, reduceMatched: false }])]).status,
    ).toBe("unmeasured");
  });

  it("notes a scroll that stopped at its step cap", () => {
    const o = summarizeReducedMotion("u", [{ ...run(1440, [clean]), capped: true }]);
    expect(o.note).toMatch(/; the scroll stopped at its 200-step cap$/);
  });

  it("notes cross-origin frames it could not sample", () => {
    const o = summarizeReducedMotion("u", [{ ...run(1440, [clean]), skippedFrames: 2 }]);
    expect(o.note).toMatch(/2 frame\(s\) not sampled \(cross-origin or not answering\)$/);
  });
});
