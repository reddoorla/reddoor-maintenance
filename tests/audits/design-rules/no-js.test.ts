import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "@playwright/test";
import {
  WITHOUT_JS_CONTEXT,
  checkNoJs,
  noJsRule,
  summarizeNoJs,
  type TextItem,
  type TextSample,
} from "../../../src/audits/design-rules/no-js.js";
import { DESIGN_RULES, runDesignRules } from "../../../src/audits/design-rules/index.js";

/**
 * R4, RUN FOR REAL: each page is rendered by a real Chromium with and without
 * JavaScript. The known-good page passes first ("Prove the instrument").
 */

const BOTH = "(at 1440 and 390px)";

function page(head: string, main: string, script = "", body = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>R4</title>${head}</head><body><main>${main}</main>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;
}

/** reddoor-starter after 1877e66 (#141): the hidden state ships in CSS behind
 *  `no-preference`, a <noscript><style> releases it, and script reveals. A
 *  closed dialog in <main> is hidden both ways, and a banner outside <main>
 *  is script's alone. */
const STARTER_AFTER_141 = page(
  `<style>@media (prefers-reduced-motion: no-preference) { [data-reveal] { opacity: 0; transform: translateY(50%); } }</style>
<noscript><style>[data-reveal] { opacity: 1 !important; transform: none !important; }</style></noscript>`,
  `<h1>Welcome</h1><p data-reveal>Our services</p><dialog><p>Closed dialog</p></dialog>`,
  `for (const el of document.querySelectorAll("[data-reveal]")) el.removeAttribute("data-reveal");
   document.getElementById("consent").textContent = "We use cookies";`,
  `<div id="consent"></div>`,
);

/** A script that adds a class to un-hide `css`'s `.x`, on `markup`. */
const released = (css: string, markup: string) =>
  page(
    `<style>${css}</style>`,
    `<h1>Page</h1>${markup}`,
    `for (const el of document.querySelectorAll(".x")) el.classList.add("in");`,
  );

const PAGES: Record<string, string> = {
  "/good": STARTER_AFTER_141,
  // vida-legacy-foundation at baaf301 (before #51): the hero copy, the page's
  // only <h1> included, sits in a `.reveal` that only script marks `.is-in`.
  "/vida-before-51": page(
    `<style>.reveal { opacity: 0; transform: translateY(1.25rem); transition: opacity 700ms ease-out, transform 700ms ease-out; }
.reveal.is-in, .reveal:focus-within { opacity: 1; transform: none; }</style>`,
    `<section class="heart-hero"><div class="hero-copy reveal"><h1>Financial relief and support</h1></div></section>`,
    `document.querySelector(".hero-copy").classList.add("is-in");`,
  ),
  // vida before #52: CountUp's tween runs only from onMount, so the SSR markup
  // carries the start value.
  "/vida-before-52": page(
    "",
    `<h1>Impact</h1><p class="t-stat"><span aria-hidden="true">0+</span></p><p class="t-stat"><span aria-hidden="true">0 people</span></p>`,
    `const s = document.querySelectorAll(".t-stat span"); s[0].textContent = "100,000+"; s[1].textContent = "13 people";`,
  ),
  "/client-only": page(
    "",
    `<h1>Team</h1><div id="list"></div>`,
    `document.getElementById("list").innerHTML = "<p>Dr. Lee</p>";`,
  ),
  // Copy a script renders well after load.
  "/late-copy": page(
    "",
    `<h1>Reviews</h1><p id="r"></p>`,
    `setTimeout(() => { document.getElementById("r").textContent = "Five stars from 120 patients"; }, 1500);`,
  ),
  // The starter's #141 reveal with its <noscript> release left out: the hidden
  // state sits behind `no-preference`, so a no-JS render under `reduce` would
  // not see it.
  "/starter-141-without-noscript": STARTER_AFTER_141.replace(/<noscript>[\s\S]*?<\/noscript>/, ""),
  // A reveal only the phone layout hides, and copy inside a declarative shadow
  // root (which exists without script) that only script un-hides.
  "/mobile-and-shadow": page(
    `<style>@media (max-width: 768px) { .m-reveal { opacity: 0 } .m-reveal.in { opacity: 1 } }</style>`,
    `<h1>Menu</h1><p class="m-reveal">Call us</p>
<x-quote><template shadowrootmode="open"><style>p { opacity: 0 } :host(.in) p { opacity: 1 }</style><p>Five stars</p></template></x-quote>`,
    `document.querySelector(".m-reveal").classList.add("in"); document.querySelector("x-quote").classList.add("in");`,
  ),
  // Round 1's false passes: hidden by other means than opacity.
  "/mask": released(
    `.mask { overflow: hidden } .x { display: block; transform: translateY(110%) } .x.in { transform: none }`,
    `<div class="mask"><span class="x">Masked line</span></div>`,
  ),
  "/clip": released(
    `.x { clip-path: inset(0 100% 0 0) } .x.in { clip-path: none }`,
    `<p class="x">Wiped line</p>`,
  ),
  "/collapsed": released(
    `.acc { height: 0; overflow: hidden } .acc.in { height: auto }`,
    `<div class="acc x"><p>Accordion body</p></div>`,
  ),
  "/transparent": released(
    `.x { color: transparent } .x.in { color: #111 }`,
    `<p class="x">Ghost text</p>`,
  ),
  "/visibility": released(
    `.x { visibility: hidden } .x.in { visibility: visible }`,
    `<p class="x">Hidden text</p>`,
  ),
  "/faint": released(`.x { opacity: 0.05 } .x.in { opacity: 0.5 }`, `<p class="x">Faint text</p>`),
  "/filter": released(
    `.x { filter: opacity(0) } .x.in { filter: none }`,
    `<p class="x">Filtered text</p>`,
  ),
  "/preloader": page(
    `<style>#pre { position: fixed; inset: 0; background: #fff }</style>`,
    `<h1>Home</h1><p>Copy</p>`,
    `document.getElementById("pre").remove();`,
    `<div id="pre"></div>`,
  ),
  "/image": released(
    `.x { opacity: 0 } .x.in { opacity: 1 }`,
    `<div class="x"><img alt="Volunteers at the walk" width="40" height="40" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><a href="#d" aria-label="Donate now"><svg width="20" height="20"></svg></a></div>`,
  ),
  "/slotted": page(
    `<style>x-card:not(:defined) { visibility: hidden }</style>`,
    `<h1>Cards</h1><x-card><p>Slotted card copy</p></x-card>`,
    `customElements.define("x-card", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = "<slot></slot>"; } });`,
  ),
  "/below-fold": page(
    `<style>.spacer { height: 3000px } .x { opacity: 0 } .x.in { opacity: 1 }</style>`,
    `<h1>Long</h1><div class="spacer"></div><p class="x">Below fold</p>`,
    `new IntersectionObserver(([e]) => { if (e.isIntersecting) e.target.classList.add("in"); }).observe(document.querySelector(".x"));`,
  ),
  "/shadow-host": released(
    `.x { opacity: 0 } .x.in { opacity: 1 }`,
    `<div class="x"><x-q><template shadowrootmode="open"><p>Inside</p></template></x-q></div>`,
  ),
  // A heading a reveal hides, whose words also appear, visible, in a link.
  "/same-words": released(
    `.x { opacity: 0 } .x.in { opacity: 1 }`,
    `<nav><a href="#m">Our Mission</a></nav><div class="x"><h2>Our Mission</h2></div>`,
  ),
  // Round 1's false fails: pages that need no JavaScript to show anything.
  "/css-fade": page(
    `<style>@keyframes f { from { opacity: 0 } } h1 { animation: f 1s .3s both }</style>`,
    `<h1>Hero line</h1>`,
  ),
  "/split-words": page(
    "",
    `<h1>Page</h1><h2 id="s">Split into words by script</h2>`,
    `const h = document.getElementById("s"); h.innerHTML = h.textContent.split(" ").map((w) => "<span>" + w + "</span>").join(" ");`,
  ),
  "/marquee-clone": page(
    "",
    `<h1>Page</h1><div class="track"><span>Trusted by 500 families</span></div>`,
    `const t = document.querySelector(".track"); t.append(t.firstElementChild.cloneNode(true));`,
  ),
  "/noscript-widget": page(
    "",
    `<h1>Book</h1><div id="w"><noscript><p>Call 555-0100 to book.</p></noscript></div>`,
    `document.getElementById("w").insertAdjacentHTML("beforeend", "<p>Pick a time</p><button>Book now</button>");`,
  ),
  "/no-main": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>R4</title><style>.banner { position: fixed; bottom: 0 }</style></head>
<body><h1>Plain page</h1><p>Copy</p><script>document.body.insertAdjacentHTML("beforeend", '<div class="banner"><p>We use cookies.</p><button>Accept</button></div>');</script></body></html>`,
  // Round 2's false fails: a paragraph script inserts ahead of its siblings;
  "/inserted": page(
    "",
    `<h1>Page</h1><p>First para</p><p>Second para</p><p>Third para</p>`,
    `const p = document.createElement("p"); p.textContent = "Injected by script"; document.querySelector("h1").after(p);`,
  ),
  // an autoplay carousel, its first slide served on screen; and the same one
  // cloning its last slide ahead of the first to loop (as Swiper does);
  "/carousel": page(
    `<style>.vp { overflow: hidden; width: 300px } .track { display: flex; transition: none } .slide { flex: 0 0 300px }</style>`,
    `<h1>Page</h1><div class="vp"><div class="track">${[1, 2, 3, 4].map((n) => `<div class="slide"><p>Testimonial ${n}</p></div>`).join("")}</div></div>`,
    `const t = document.querySelector(".track"); let n = 0; const go = () => { n = (n + 1) % 4; t.style.transform = "translateX(" + -300 * n + "px)"; }; go(); setInterval(go, 700);`,
  ),
  // the plain carousel again, its first slide served with a state class;
  "/carousel-active": page(
    `<style>.vp { overflow: hidden; width: 300px } .track { display: flex; transition: none } .slide { flex: 0 0 300px }</style>`,
    `<h1>Page</h1><div class="vp"><div class="track">${[1, 2, 3, 4].map((n) => `<div class="slide${n === 1 ? " is-active" : ""}"><p>Testimonial ${n}</p></div>`).join("")}</div></div>`,
    `const t = document.querySelector(".track"); let n = 0; const go = () => { n = (n + 1) % 4; t.style.transform = "translateX(" + -300 * n + "px)"; }; go(); setInterval(go, 700);`,
  ),
  "/carousel-loop": page(
    `<style>.vp { overflow: hidden; width: 300px } .track { display: flex; transition: none } .slide { flex: 0 0 300px }</style>`,
    `<h1>Page</h1><div class="vp"><div class="track">${[1, 2, 3, 4].map((n) => `<div class="slide"><p>Testimonial ${n}</p></div>`).join("")}</div></div>`,
    `const t = document.querySelector(".track"); t.prepend(t.lastElementChild.cloneNode(true)); let n = 0; const go = () => { n = (n % 4) + 1; t.style.transform = "translateX(" + -300 * n + "px)"; }; go(); setInterval(go, 700);`,
  ),
  // a date and opening hours a script rewrites;
  "/dates": page(
    "",
    `<h1>Page</h1><p><time id="d">January 5, 2026</time></p><p id="h">9:00 AM to 5:00 PM</p>`,
    `document.getElementById("d").textContent = "9 months ago"; document.getElementById("h").textContent = "Open now until 5:00 PM";`,
  ),
  // Round 2's false passes: an embed only script mounts, and an image whose
  // source only script sets;
  "/embed": page(
    "",
    `<h1>Page</h1><div id="slot"></div>`,
    `const f = document.createElement("iframe"); f.title = "Promo video"; f.width = "560"; f.height = "315"; f.srcdoc = "<p>video</p>"; document.getElementById("slot").append(f);`,
  ),
  "/data-src": page(
    "",
    `<h1>Page</h1><img alt="Hero photo" width="600" height="400" data-src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`,
    `const i = document.querySelector("img"); i.src = i.dataset.src;`,
  ),
  // Round 3's: a hero line masked in an overflow-hidden section beside a
  // visible eyebrow of the same tag and a different class, which is not a
  // slide (a false pass), and a blur-up image and an embed whose source
  // script rewrites (false fails)
  "/mask-beside-copy": released(
    `section { overflow: hidden; padding: 40px } .x { display: block; transform: translateY(300px) } .x.in { transform: none }`,
    `<section><p>Welcome to our practice</p><p class="x">Smile brighter</p></section>`,
  ),
  // Round 4's: a hero headline slid in from off-canvas inside a page wrapper
  // that clips sideways scroll, above a second classless section (a false
  // pass);
  "/wrapper-slide-in": released(
    `#app { overflow-x: hidden } .x { transform: translateX(-120vw) } .x.in { transform: none }`,
    `<div id="app"><section><div><h2 class="x">Hero headline</h2></div></section><section><p>About our practice</p></section></div>`,
  ),
  // Round 5's: a crossfade slideshow and a variable-width logo strip that
  // scrolls on its own (false fails); two equal columns, one sliding in, and
  // a section translated by its own width beside a stacked one (false passes);
  "/crossfade": page(
    `<style>.show { position: relative; height: 80px } .s { position: absolute; inset: 0; opacity: 0 } .s.on { opacity: 1 }</style>`,
    `<h1>Page</h1><div class="show">${["Great, Ann", "Kind, Bo", "Wonderful, Cleo", "Best ever, Dan"].map((t, i) => `<blockquote class="s${i === 0 ? " on" : ""}">${t}</blockquote>`).join("")}</div>`,
    `const s = [...document.querySelectorAll(".s")]; let n = 0; setInterval(() => { s[n].classList.remove("on"); n = (n + 1) % s.length; s[n].classList.add("on"); }, 900);`,
  ),
  "/logo-strip": page(
    `<style>.vp { overflow: hidden; width: 600px } ul { display: flex; gap: 24px; width: max-content; margin: 0; padding: 0; list-style: none }</style>`,
    `<h1>Page</h1><div class="vp"><ul>${[300, 500, 350, 420, 380, 450].map((w, i) => `<li><img alt="${"ABCDEF"[i]}" width="${w}" height="40" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></li>`).join("")}</ul></div>`,
    `const u = document.querySelector("ul"); let x = 0; setInterval(() => { x = (x + 400) % 2400; u.style.transform = "translateX(" + -x + "px)"; }, 500);`,
  ),
  "/two-columns": released(
    `#app { overflow-x: hidden } .row { display: flex } .c { width: 50% } .x { transform: translateX(100vw) } .x.in { transform: none }`,
    `<div id="app"><div class="row"><div class="c"><p>Left copy</p></div><div class="c"><p class="x">Right copy slides in</p></div></div></div>`,
  ),
  "/section-by-width": released(
    `.wrap { overflow-x: hidden } .x { transform: translateX(100%) } .x.in { transform: none }`,
    `<div class="wrap"><section class="x"><h2>Smile brighter</h2></section><section><p>Family dentistry</p></section></div>`,
  ),
  "/src-swap": page(
    "",
    `<h1>Page</h1><img alt="" width="300" height="200" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><iframe width="300" height="200" srcdoc="<p>map</p>"></iframe>`,
    `document.querySelector("img").src = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs="; document.querySelector("iframe").srcdoc = "<p>map, decorated</p>";`,
  ),
  "/year": page(
    "",
    `<h1>Page</h1><p>© <span id="y">2024</span> Studio</p>`,
    `document.getElementById("y").textContent = String(new Date().getFullYear() + 1);`,
  ),
};

let server: Server;
let base: string;
let browser: Browser;

beforeAll(async () => {
  server = createServer((req, res) => {
    const html = PAGES[req.url ?? ""];
    res.writeHead(html ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
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

/** The check as the CLI runs it, with a 2.5 s steady window: every
 *  slideshow fixture here goes through a full cycle within it. */
const run = (path: string) => checkNoJs(browser, `${base}${path}`, undefined, 2500);
const problems = async (path: string) => (await run(path)).findings.map((f) => f.problem);

describe.concurrent("design-rules R4 (no-JS visibility), in a real browser", () => {
  it("is registered as R4", () => {
    expect(DESIGN_RULES.R4).toBe(noJsRule);
  });

  it("PASSES the known-good page: the starter's reveal after #141, a closed dialog, a JS-only banner outside <main>", async () => {
    const o = await run("/good");
    expect(o.status, `${o.note} ${JSON.stringify(o.findings)}`).toBe("pass");
  });

  it("FAILS vida before #51: the <h1> is hidden by its ancestor without JavaScript", async () => {
    const o = await run("/vida-before-51");
    expect(o.findings).toEqual([
      {
        target: "main > section.heart-hero > div.hero-copy.reveal > h1",
        problem: `"Financial relief and support" is hidden without JavaScript ${BOTH}`,
      },
    ]);
  });

  it("FAILS vida before #52: each stat reads its start value without JavaScript", async () => {
    expect(await problems("/vida-before-52")).toEqual([
      `reads "0+" without JavaScript, "100,000+" with it ${BOTH}`,
      `reads "0 people" without JavaScript, "13 people" with it ${BOTH}`,
    ]);
  });

  it("FAILS copy in <main> that only a script renders, at once or late", async () => {
    expect(await problems("/client-only")).toEqual([
      `"Dr. Lee" is not rendered without JavaScript ${BOTH}`,
    ]);
    expect(await problems("/late-copy")).toEqual([
      `"Five stars from 120 patients" is not rendered without JavaScript ${BOTH}`,
    ]);
  });

  it("FAILS a reveal hidden behind no-preference with no <noscript> release: the no-JS render does not emulate reduce", async () => {
    expect(await problems("/starter-141-without-noscript")).toEqual([
      `"Our services" is hidden without JavaScript ${BOTH}`,
    ]);
  });

  it("FAILS a reveal only the phone layout hides, and copy in a shadow root", async () => {
    expect(await problems("/mobile-and-shadow")).toEqual([
      `"Five stars" is hidden without JavaScript ${BOTH}`,
      `"Call us" is hidden without JavaScript (at 390px)`,
    ]);
  });

  it("FAILS copy hidden by a mask, a clip-path, a collapsed box, transparent ink, visibility, or a faint opacity", async () => {
    const hidden = (t: string) => [`"${t}" is hidden without JavaScript ${BOTH}`];
    expect(await problems("/mask")).toEqual(hidden("Masked line"));
    expect(await problems("/clip")).toEqual(hidden("Wiped line"));
    expect(await problems("/collapsed")).toEqual(hidden("Accordion body"));
    expect(await problems("/transparent")).toEqual(hidden("Ghost text"));
    expect(await problems("/visibility")).toEqual(hidden("Hidden text"));
    expect(await problems("/faint")).toEqual(hidden("Faint text"));
    expect(await problems("/filter")).toEqual(hidden("Filtered text"));
  });

  it("FAILS a full-screen preloader only script removes", async () => {
    const o = await run("/preloader");
    expect(o.findings).toEqual([
      { target: "div#pre", problem: `covers the page without JavaScript ${BOTH}` },
    ]);
  });

  it("FAILS an image and a labelled control that a reveal hides", async () => {
    expect(await problems("/image")).toEqual([
      `"image "Volunteers at the walk"" is hidden without JavaScript ${BOTH}`,
      `""Donate now"" is hidden without JavaScript ${BOTH}`,
      `"svg" is hidden without JavaScript ${BOTH}`,
    ]);
  });

  it("FAILS slotted copy a custom element hides until it is defined", async () => {
    expect(await problems("/slotted")).toEqual([
      `"Slotted card copy" is hidden without JavaScript ${BOTH}`,
    ]);
  });

  it("FAILS a reveal far below the fold, which only a scroll shows", async () => {
    expect(await problems("/below-fold")).toEqual([
      `"Below fold" is hidden without JavaScript ${BOTH}`,
    ]);
  });

  it("FAILS copy inside a shadow root whose host's ancestor is hidden", async () => {
    expect(await problems("/shadow-host")).toEqual([
      `"Inside" is hidden without JavaScript ${BOTH}`,
    ]);
  });

  it("FAILS a hidden heading even when its words are visible in a link", async () => {
    expect(await problems("/same-words")).toEqual([
      `"Our Mission" is hidden without JavaScript ${BOTH}`,
    ]);
  });

  it("PASSES what needs no JavaScript to show: a CSS fade-in, split words, a marquee's copy, a <noscript> alternative, a year", async () => {
    for (const path of [
      "/css-fade",
      "/split-words",
      "/marquee-clone",
      "/noscript-widget",
      "/year",
    ]) {
      const o = await run(path);
      expect(o.findings, path).toEqual([]);
    }
  });

  it("PASSES a paragraph script inserts ahead of its siblings, and FAILS only the inserted one", async () => {
    expect(await problems("/inserted")).toEqual([
      `"Injected by script" is not rendered without JavaScript ${BOTH}`,
    ]);
  });

  it("PASSES an autoplay carousel at whatever slide it is sampled on, and a date or hours script rewrites", async () => {
    expect(await problems("/carousel")).toEqual([]);
    expect(await problems("/carousel-loop")).toEqual([]);
    expect(await problems("/carousel-active")).toEqual([]);
    expect(await problems("/crossfade")).toEqual([]);
    expect(await problems("/logo-strip")).toEqual([]);
    expect(await problems("/dates")).toEqual([]);
  });

  it("FAILS a heading masked beside visible copy, and PASSES a source script rewrites", async () => {
    expect(await problems("/mask-beside-copy")).toEqual([
      `"Smile brighter" is hidden without JavaScript ${BOTH}`,
    ]);
    expect(await problems("/src-swap")).toEqual([]);
    expect(await problems("/two-columns")).toEqual([
      `"Right copy slides in" is hidden without JavaScript ${BOTH}`,
    ]);
    expect(await problems("/section-by-width")).toEqual([
      `"Smile brighter" is hidden without JavaScript ${BOTH}`,
    ]);
    expect(await problems("/wrapper-slide-in")).toEqual([
      `"Hero headline" is hidden without JavaScript ${BOTH}`,
    ]);
  });

  it("FAILS an embed only script mounts, and an image whose source only script sets", async () => {
    expect(await problems("/embed")).toEqual([
      `"iframe "Promo video"" is not rendered without JavaScript ${BOTH}`,
    ]);
    expect(await problems("/data-src")).toEqual([
      `"image "Hero photo"" is hidden without JavaScript ${BOTH}`,
    ]);
  });

  it("reads <body> when there is no <main>, leaving out a fixed consent banner", async () => {
    const o = await run("/no-main");
    expect(o.findings).toEqual([]);
    expect(o.note).toMatch(/no <main>, so <body> was read/);
  });

  it("is UNMEASURED, never a pass, when the no-JS render has JavaScript on (negative control)", async () => {
    const o = await checkNoJs(browser, `${base}/vida-before-51`, {
      ...WITHOUT_JS_CONTEXT,
      javaScriptEnabled: true,
    });
    expect(o.status).toBe("unmeasured");
    expect(o.note).toMatch(/emulation did not take/);
  });

  it("is UNMEASURED when the page answers 404", async () => {
    const [o] = await runDesignRules([`${base}/missing`], [noJsRule], browser);
    expect(o!.status).toBe("unmeasured");
    expect(o!.note).toBe("the check threw: the page answered 404");
  });
});

describe("summarizeNoJs", () => {
  const item = (text: string, visible = true, target = "main > p"): TextItem => ({
    target,
    key: target,
    text,
    visible,
  });
  const sample = (scriptingOff: boolean, items: TextItem[]): TextSample => ({
    scriptingOff,
    items,
    noscriptKeys: [],
    cover: null,
    noMain: false,
  });
  const at = (withJs: TextItem[], withoutJs: TextItem[]) => [
    { width: 1440, withJs: sample(false, withJs), withoutJs: sample(true, withoutJs) },
  ];

  it("reports a stat that reads zero at its place even when another reads the same total", () => {
    const o = summarizeNoJs(
      "u",
      at(
        [item("100+", true, "a"), item("100+", true, "b")],
        [item("100+", true, "a"), item("0+", true, "b")],
      ),
    );
    expect(o.findings).toEqual([
      { target: "b", problem: 'reads "0+" without JavaScript, "100+" with it (at 1440px)' },
    ]);
  });

  it("reports a count-up that reads zero without JavaScript, and lets a served year stand", () => {
    const o = summarizeNoJs(
      "u",
      at(
        [item("1,200", true, "a"), item("2026", true, "b")],
        [item("0", true, "a"), item("2024", true, "b")],
      ),
    );
    expect(o.findings).toEqual([
      { target: "a", problem: 'reads "0" without JavaScript, "1,200" with it (at 1440px)' },
    ]);
  });

  it("reports a zeroed stat whose label starts like a month, copy that only mentions today, and a countdown served at zero", () => {
    const o = summarizeNoJs(
      "u",
      at(
        [
          item("1,200 novels", true, "a"),
          item("Reviews loaded today", true, "b"),
          item("Sale ends in 12:30", true, "c"),
        ],
        [
          item("0 novels", true, "a"),
          item("Call today for a quote", true, "b"),
          item("Sale ends in 00:00", true, "c"),
        ],
      ),
    );
    expect(o.findings.map((f) => f.target)).toEqual(["a", "b", "c"]);
  });

  it("reports text whose place holds other, invisible text as not rendered", () => {
    const o = summarizeNoJs("u", at([item("New")], [item("Old", false)]));
    expect(o.findings).toEqual([
      { target: "main > p", problem: '"New" is not rendered without JavaScript (at 1440px)' },
    ]);
  });

  it("is unmeasured with no renders, nothing visible with JS, or scripting off in the JS render", () => {
    expect(summarizeNoJs("u", []).status).toBe("unmeasured");
    expect(summarizeNoJs("u", at([item("x", false)], [])).status).toBe("unmeasured");
    expect(
      summarizeNoJs("u", [
        { width: 1440, withJs: sample(true, [item("x")]), withoutJs: sample(true, []) },
      ]).status,
    ).toBe("unmeasured");
  });

  it("shortens a long text in the finding", () => {
    const long = "a".repeat(80);
    const o = summarizeNoJs("u", at([item(long)], []));
    expect(o.findings[0]!.problem).toBe(
      `"${"a".repeat(57)}…" is not rendered without JavaScript (at 1440px)`,
    );
  });
});
