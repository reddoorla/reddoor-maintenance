import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  checkHeadingLevels,
  headingLevelsRule,
  summarizeOutline,
} from "../../../src/audits/design-rules/heading-levels.js";
import { DESIGN_RULES, runDesignRules } from "../../../src/audits/design-rules/index.js";

/**
 * R9, RUN FOR REAL. The /about outline below is reddoor-website's own, before
 * and after #65 (c380b83), heading for heading. Each verdict is also checked
 * against axe's `page-has-heading-one` and `heading-order`, the instrument
 * the fleet a11y audit filters out today: where the two disagree, this check
 * is the suspect.
 */

type H = [tag: string, ariaLevel: number | null, text: string];

/** reddoor-website `src/routes/[[preview=preview]]/about/+page.svelte` at
 *  947683a, in order (the hover tooltip's <h5> left out: it only renders on
 *  hover). */
const ABOUT_BEFORE_65: H[] = [
  ["h5", null, "We save you from drowning in an ocean of noise"],
  ["h3", null, "About"],
  ["h2", null, "Our Promises"],
  ["h5", null, "We will listen"],
  ["h5", null, "We will deliver"],
  ["h5", null, "We will care"],
  ["h3", null, "CA"],
  ["h3", null, "TX"],
  ["h3", null, "ID"],
  ["h2", null, "Serving our clients"],
  ["h6", null, "The Reddoor Story"],
  ["h5", null, "Because of unforeseen circumstances"],
  ["h6", null, 'The original "reddoor" taught'],
  ["h6", null, "Perspective"],
  ["h5", null, '"Time has taught me that true n'],
  ["h2", null, "Isn't it time to arm your brand"],
];

/** The same file at c380b83 (#65): every heading carries its outline level. */
const ABOUT_AFTER_65: H[] = ABOUT_BEFORE_65.map(([tag, , text], i) => [
  tag,
  [1, 2, 2, 3, 3, 3, 2, 2, 2, 2, 2, 3, 3, 2, 3, 2][i]!,
  text,
]);

function outlinePage(hs: H[], extra = ""): string {
  const body = hs
    .map(([tag, level, text]) => `<${tag}${level ? ` aria-level="${level}"` : ""}>${text}</${tag}>`)
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>R9</title></head><body><main>${body}${extra}</main></body></html>`;
}

const PAGES: Record<string, string> = {
  "/about-before-65": outlinePage(ABOUT_BEFORE_65),
  "/about-after-65": outlinePage(ABOUT_AFTER_65),
  // What is not in the outline: a hidden duplicate, an aria-hidden one, an
  // eyebrow whose semantics are removed (gallerysonder #22's fix).
  "/not-in-outline": outlinePage(
    [
      ["h1", null, "Exhibitions"],
      ["h2", null, "Current"],
    ],
    `<h4 style="display:none">Mobile title</h4><h5 aria-hidden="true">Decoration</h5>
     <h5 role="presentation">Eyebrow</h5><h5 role="none">Kicker</h5><h5 role="tab">Tab</h5>
     <h5 hidden>Template</h5><h5 style="visibility:hidden">Spacer</h5><div inert><h5>Closed menu</h5></div>
     <details><summary>FAQ</summary><h4>Question</h4></details><section style="content-visibility:hidden"><h4>Deferred</h4></section>
     <div role="heading">Section</div><h3>Detail</h3>`,
  ),
  // reddoor-website's home: one visible <h1> per opening slide, five in all.
  "/five-h1": outlinePage([
    ["h1", null, "We tell"],
    ["h1", null, "a clear story"],
    ["h1", null, "We make"],
    ["h1", null, "compelling design"],
    ["h1", null, "We tell"],
  ]),
  // A card component: its own <h2> in its shadow root, and an <h4> slotted
  // from the light DOM, a skip.
  "/shadow": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>R9</title></head><body><main><h1>Team</h1><x-card><h4>Slotted role</h4></x-card></main>
<script>customElements.define("x-card", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = "<h2>Card</h2><slot></slot>"; } });</script></body></html>`,
  // A named slot ahead of the shadow root's own <h3>: the slotted <h2> reads
  // first, so there is no skip; a light child no slot takes is not read.
  "/named-slot": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>R9</title></head><body><main><h1>Top</h1><x-panel><h2 slot="a">Slot A</h2><h6>Unslotted</h6></x-panel></main>
<script>customElements.define("x-panel", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = '<slot name="a"></slot><h3>After slot</h3>'; } });</script></body></html>`,
  // Round 2's: aria-hidden and inert around a slot hide what it slots; a
  // display:contents heading is still a heading; a slice that mounts below
  // the fold is read.
  "/hidden-slot": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>R9</title></head><body><main><h1>One</h1><x-a><h2>Hidden slotted</h2></x-a><x-b><h1>Inert slotted</h1></x-b><h2>Two</h2></main>
<script>customElements.define("x-a", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = '<div aria-hidden="true"><slot></slot></div>'; } });
customElements.define("x-b", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = "<div inert><slot></slot></div>"; } });</script></body></html>`,
  "/contents": outlinePage(
    [],
    `<h1 style="display:contents">Main</h1><h2 style="display:contents">Section</h2><h3>Detail</h3>`,
  ),
  // display:contents all the way up: a wrapper, and a heading slotted
  // through a <slot>, which has no box of its own.
  "/contents-chain": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>R9</title></head><body><main><div style="display:contents"><h1 style="display:contents">Main</h1></div><x-p><h2 style="display:contents">Slotted</h2></x-p><h3>Detail</h3></main>
<script>customElements.define("x-p", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = "<div><slot></slot></div>"; } });</script></body></html>`,
  "/lazy-slice": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>R9</title></head><body><main><h1>Top</h1><h2>Intro</h2><div style="height:3000px"></div><div id="s"></div></main>
<script>new IntersectionObserver(([e], o) => { if (e.isIntersecting) { e.target.innerHTML = "<h4>Lazy</h4>"; o.disconnect(); } }).observe(document.getElementById("s"));</script></body></html>`,
  // The smallest skip: one level missing.
  "/one-level-skip": outlinePage([
    ["h1", null, "Services"],
    ["h2", null, "Cleanings"],
    ["h4", null, "What to expect"],
  ]),
  // A heading only the phone layout has, that skips.
  "/mobile-skip": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>R9</title>
<style>.m { display: none } @media (max-width: 768px) { .m { display: block } }</style></head>
<body><main><h1>Team</h1><h4 class="m">Call us</h4></main></body></html>`,
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

/** axe's verdict on the two outline rules, at 1440×900. */
async function axeSays(path: string): Promise<"pass" | "fail"> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(`${base}${path}`);
    const r = await new AxeBuilder({ page })
      .withRules(["page-has-heading-one", "heading-order"])
      .analyze();
    return r.violations.length > 0 ? "fail" : "pass";
  } finally {
    await context.close();
  }
}

describe("design-rules R9 (heading levels), in a real browser", () => {
  it("is registered as R9", () => {
    expect(DESIGN_RULES.R9).toBe(headingLevelsRule);
  });

  it("PASSES reddoor-website /about after #65, and axe agrees", async () => {
    const o = await checkHeadingLevels(browser, `${base}/about-after-65`);
    expect(o.status, o.note).toBe("pass");
    expect(await axeSays("/about-after-65")).toBe("pass");
  });

  it("FAILS /about before #65: no level-1 heading, and the skips, and axe agrees", async () => {
    const o = await checkHeadingLevels(browser, `${base}/about-before-65`);
    expect(o.findings).toEqual([
      { target: "(page)", problem: "has no level-1 heading (at 1440 and 390px)" },
      {
        target: "body > main > h5:nth-of-type(2)",
        problem: 'is level 5 after level 2 ("Our Promises"), skipping level 3 (at 1440 and 390px)',
      },
      {
        target: "body > main > h6:nth-of-type(1)",
        problem:
          'is level 6 after level 2 ("Serving our clients"), skipping level 3 (at 1440 and 390px)',
      },
    ]);
    expect(await axeSays("/about-before-65")).toBe("fail");
  });

  it("leaves out what assistive technology does not read, and reads role=heading", async () => {
    const o = await checkHeadingLevels(browser, `${base}/not-in-outline`);
    // h1, h2, then role=heading (level 2), then h3: no skip.
    expect(o.status, JSON.stringify(o.findings)).toBe("pass");
    expect(o.note).toBe("headings in the outline: 4 at 1440px, 4 at 390px; 0 finding(s)");
    expect(await axeSays("/not-in-outline")).toBe("pass");
  });

  it("FAILS each extra level-1 heading", async () => {
    const o = await checkHeadingLevels(browser, `${base}/five-h1`);
    expect(o.findings.map((f) => f.problem)).toEqual([
      'is a second level-1 heading, "a clear story" (at 1440 and 390px)',
      'is a second level-1 heading, "We make" (at 1440 and 390px)',
      'is a second level-1 heading, "compelling design" (at 1440 and 390px)',
      'is a second level-1 heading, "We tell" (at 1440 and 390px)',
    ]);
  });

  it("FAILS a skip of a single level, and axe agrees", async () => {
    const o = await checkHeadingLevels(browser, `${base}/one-level-skip`);
    expect(o.findings).toEqual([
      {
        target: "body > main > h4",
        problem: 'is level 4 after level 2 ("Cleanings"), skipping level 3 (at 1440 and 390px)',
      },
    ]);
    expect(await axeSays("/one-level-skip")).toBe("fail");
  });

  it("reads a shadow root's headings and the ones it slots", async () => {
    const o = await checkHeadingLevels(browser, `${base}/shadow`);
    expect(o.findings.map((f) => f.problem)).toEqual([
      'is level 4 after level 2 ("Card"), skipping level 3 (at 1440 and 390px)',
    ]);
  });

  it("reads a slotted heading where its slot sits, and not one no slot takes", async () => {
    const o = await checkHeadingLevels(browser, `${base}/named-slot`);
    expect(o.status, JSON.stringify(o.findings)).toBe("pass");
    expect(o.note).toBe("headings in the outline: 3 at 1440px, 3 at 390px; 0 finding(s)");
  });

  it("leaves out what aria-hidden or inert hides through a slot, and reads a display:contents heading", async () => {
    const hidden = await checkHeadingLevels(browser, `${base}/hidden-slot`);
    expect(hidden.status, JSON.stringify(hidden.findings)).toBe("pass");
    expect(hidden.note).toBe("headings in the outline: 2 at 1440px, 2 at 390px; 0 finding(s)");
    const contents = await checkHeadingLevels(browser, `${base}/contents`);
    expect(contents.status, JSON.stringify(contents.findings)).toBe("pass");
    expect(contents.note).toBe("headings in the outline: 3 at 1440px, 3 at 390px; 0 finding(s)");
    const chain = await checkHeadingLevels(browser, `${base}/contents-chain`);
    expect(chain.status, JSON.stringify(chain.findings)).toBe("pass");
    expect(chain.note).toBe("headings in the outline: 3 at 1440px, 3 at 390px; 0 finding(s)");
  });

  it("FAILS a skip in a slice that mounts when scrolled into view", async () => {
    const o = await checkHeadingLevels(browser, `${base}/lazy-slice`);
    expect(o.findings.map((f) => f.problem)).toEqual([
      'is level 4 after level 2 ("Intro"), skipping level 3 (at 1440 and 390px)',
    ]);
  });

  it("FAILS a skip only the phone layout has", async () => {
    const o = await checkHeadingLevels(browser, `${base}/mobile-skip`);
    expect(o.findings).toEqual([
      {
        target: "body > main > h4.m",
        problem: 'is level 4 after level 1 ("Team"), skipping level 2 (at 390px)',
      },
    ]);
  });

  it("is UNMEASURED when the page answers 404", async () => {
    const [o] = await runDesignRules([`${base}/missing`], [headingLevelsRule], browser);
    expect(o!.status).toBe("unmeasured");
  });
});

describe("summarizeOutline", () => {
  it("is unmeasured with no runs", () => {
    expect(summarizeOutline("u", []).status).toBe("unmeasured");
  });

  it("allows going back up any number of levels", () => {
    const o = summarizeOutline("u", [
      {
        width: 1440,
        outline: {
          headings: [
            { target: "a", level: 1, text: "A" },
            { target: "b", level: 2, text: "B" },
            { target: "c", level: 3, text: "C" },
            { target: "d", level: 4, text: "D" },
            { target: "e", level: 2, text: "E" },
          ],
        },
      },
    ]);
    expect(o.status).toBe("pass");
  });
});
