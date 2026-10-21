import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "@playwright/test";
import {
  checkFocusRing,
  contrast,
  focusRingRule,
} from "../../../src/audits/design-rules/focus-ring.js";
import { DESIGN_RULES } from "../../../src/audits/design-rules/index.js";

/**
 * R12, RUN FOR REAL: each page is tabbed through in a real Chromium, every
 * stop captured focused and unfocused. The grounds and the ring are
 * roalson-interests' own (`--color-primary` #652323, `--color-dark` #3d0707,
 * `--color-background` #f6f1ea), before and after #23 (d7ca791).
 */

const THEME = `:root { --color-primary: #652323; --color-dark: #3d0707; --color-background: #f6f1ea; }
body { margin: 0; background: var(--color-background); font: 16px/1.5 sans-serif; }
section { padding: 40px; } a { display: inline-block; margin: 8px; color: inherit; }
.bg-primary { background: var(--color-primary); color: var(--color-background); }
.bg-dark { background: var(--color-dark); color: var(--color-background); }`;

/** roalson `src/app.css` at 1187981 (before #23): garnet on every ground. */
const RING_BEFORE_23 = `:where(a, button, summary, [tabindex]:not([tabindex="-1"])):focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }`;

/** The same at d7ca791 (#23): the ring takes its colour from its ground. */
const RING_AFTER_23 = `:where(a, button, summary, [tabindex]:not([tabindex="-1"])):focus-visible { outline: 2px solid var(--focus-ring, var(--color-primary)); outline-offset: 2px; }
:where(.bg-primary, .bg-dark, .bg-black, .from-primary, .from-dark, [data-floating]) > * { --focus-ring: var(--color-background); }
:where(.bg-background, .bg-light, .bg-white, .from-background, .from-light) > * { --focus-ring: var(--color-primary); }`;

const BANDS = `<main>
<section><a href="#a" id="on-light">Properties</a></section>
<section class="bg-primary"><div><a href="#b" id="on-primary">Learn more</a></div></section>
<section class="bg-dark"><div><a href="#c" id="on-dark">Contact</a></div></section>
</main>`;

function page(css: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>R12</title><style>${THEME}\n${css}</style></head><body>${body}</body></html>`;
}

const PAGES: Record<string, string> = {
  "/after-23": page(RING_AFTER_23, BANDS),
  "/before-23": page(RING_BEFORE_23, BANDS),
  "/outline-none": page(`a:focus { outline: none; }`, `<main><a href="#x" id="x">Book</a></main>`),
  // A faint ring with a small dark mark: most of the indicator is under 3:1,
  // so its 90th percentile is, though its darkest pixels are not.
  "/faint-with-mark": page(
    `a { position: relative } a:focus-visible { outline: 3px solid #e6e1da; outline-offset: 2px; }
     a:focus-visible::after { content: ""; position: absolute; left: 0; top: 0; width: 3px; height: 3px; background: #000; }`,
    `<main><section><a href="#x" id="x">Book</a></section></main>`,
  ),
  // A focus style below the eye's threshold: a #fafafa tint on white.
  "/tint-only": page(
    `body { background: #fff } a:focus { outline: none; } a:focus-visible { background: #fbfbfb; }`,
    `<main><section><a href="#x" id="x">Book</a></section></main>`,
  ),
  // A ring an ancestor's overflow cuts off.
  "/clipped": page(
    `${RING_AFTER_23} .clip { overflow: hidden; padding: 0; }`,
    `<main><section><div class="clip"><a href="#x" id="x" style="margin:0">Book</a></div></section></main>`,
  ),
  // A 1px ring on a box at a fractional position, anti-aliased into two
  // half-strength rows: vidalegacy.org's footer links, measured.
  "/subpixel": page(
    `a:focus-visible { outline: 1px solid #01263f; outline-offset: 0; } .shift { position: relative; top: 0.4375px; }`,
    `<main><section><div class="shift"><a href="#x" id="x" style="line-height:8.4px">726-234-6910</a></div></section></main>`,
  ),
  // A pinned bar over the top 70% of the screen: wherever focus scrolls the
  // link to (Chromium centres it), the bar is over it.
  "/pinned": page(
    `${RING_AFTER_23} .bar { position: fixed; left: 0; right: 0; top: 0; height: 70vh; background: #222; color: #fff; }`,
    `<main><section style="height:2000px"></section><section><a href="#x" id="x">Book</a></section><section style="height:2000px"></section></main><div class="bar" id="bar">We use cookies</div>`,
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

describe("design-rules R12 (focus ring), in a real browser", () => {
  it("is registered as R12", () => {
    expect(DESIGN_RULES.R12).toBe(focusRingRule);
  });

  it("measures roalson's grounds as #23 says: garnet on garnet 1:1, on dark 1.48:1", () => {
    expect(contrast([0x65, 0x23, 0x23], [0x65, 0x23, 0x23])).toBe(1);
    expect(contrast([0x65, 0x23, 0x23], [0x3d, 0x07, 0x07])).toBeCloseTo(1.48, 2);
  });

  it("PASSES roalson after #23: the ring takes its colour from its ground", async () => {
    const o = await checkFocusRing(browser, `${base}/after-23`);
    expect(o.status, `${o.note} ${JSON.stringify(o.findings)}`).toBe("pass");
  });

  it("FAILS roalson before #23: no ring on garnet, a faint one on dark", async () => {
    const o = await checkFocusRing(browser, `${base}/before-23`);
    expect(o.findings.map((f) => `${f.target}: ${f.problem.replace(/ \(at .*\)$/, "")}`)).toEqual([
      "a#on-primary: has no visible focus indicator",
      "a#on-dark: focus indicator reaches only 1.48:1 against its ground (needs 3:1)",
    ]);
  });

  it("PASSES a thin ring anti-aliased across two pixel rows", async () => {
    const o = await checkFocusRing(browser, `${base}/subpixel`);
    expect(o.status, JSON.stringify(o.findings)).toBe("pass");
  });

  it("FAILS outline: none", async () => {
    const o = await checkFocusRing(browser, `${base}/outline-none`);
    expect(o.findings.map((f) => f.problem.replace(/ \(at .*\)$/, ""))).toEqual([
      "has no visible focus indicator",
    ]);
  });

  it("FAILS a faint ring a few dark pixels do not rescue, and a tint too faint to see", async () => {
    const faint = await checkFocusRing(browser, `${base}/faint-with-mark`);
    expect(faint.findings.map((f) => f.problem.replace(/ \(at .*\)$/, ""))).toEqual([
      expect.stringMatching(
        /^focus indicator reaches only 1\.\d\d:1 against its ground \(needs 3:1\)$/,
      ),
    ]);
    const tint = await checkFocusRing(browser, `${base}/tint-only`);
    expect(tint.findings.map((f) => f.problem.replace(/ \(at .*\)$/, ""))).toEqual([
      "has no visible focus indicator",
    ]);
  });

  it("FAILS a ring an ancestor's overflow cuts off", async () => {
    const o = await checkFocusRing(browser, `${base}/clipped`);
    expect(o.status).toBe("fail");
    expect(o.findings[0]!.target).toBe("a#x");
  });

  it("FAILS a focused element under a pinned bar", async () => {
    const o = await checkFocusRing(browser, `${base}/pinned`);
    expect(o.findings).toContainEqual(
      expect.objectContaining({
        target: "a#x",
        problem: expect.stringMatching(/^is under div#bar/),
      }),
    );
  });
});
