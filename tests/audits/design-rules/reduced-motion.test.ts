import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "@playwright/test";
import {
  reducedMotionRule,
  summarizeReducedMotion,
  type MotionSample,
} from "../../../src/audits/design-rules/reduced-motion.js";
import { DESIGN_RULES, runDesignRules } from "../../../src/audits/design-rules/index.js";

/**
 * R2, RUN FOR REAL. Each page below is served to a real Chromium, and the rule
 * is run the way scripts/design-rules.mts runs it. The known-good page passes
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
  // No reset at all, and an infinite animation.
  "/no-reset": page(
    `@keyframes pos-y-wiggle { 0% { transform: translateY(1px) } 100% { transform: translateY(-1px) } }
     .wiggle { animation: 1s infinite pos-y-wiggle ease-out; }`,
    `<span class="wiggle">↓</span>`,
  ),
  // A Web Animations API entrance (what Svelte transitions run on), which the
  // CSS reset cannot reach: the good reset is present and does not help.
  "/waapi": page(
    RESET_AFTER_135,
    `<p id="intro">Hello</p>`,
    `document.getElementById("intro").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 4000, fill: "both" });`,
  ),
  // Motion that only starts once its element is scrolled into view, two
  // screens down: only a sampler that scrolls can see it.
  "/below-fold": page(
    `@keyframes spin { to { transform: rotate(1turn) } }
     .spacer { height: 2400px } .spin { animation: spin 2s linear infinite; }`,
    `<div class="spacer"></div><div id="late">Late</div>`,
    `new IntersectionObserver(([e], o) => { if (e.isIntersecting) { e.target.classList.add("spin"); o.disconnect(); } }).observe(document.getElementById("late"));`,
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

async function run(path: string) {
  const [outcome] = await runDesignRules([`${base}${path}`], [reducedMotionRule], browser);
  return outcome!;
}

describe("design-rules R2 (reduced motion), in a real browser", () => {
  it("is registered as R2", () => {
    expect(DESIGN_RULES.R2).toBe(reducedMotionRule);
  });

  it("PASSES the known-good page: the starter's reset after #135, over motion that is fine without reduce", async () => {
    const o = await run("/good");
    expect(o.status, o.note).toBe("pass");
    expect(o.findings).toEqual([]);
  });

  it("FAILS the reset before #135: the transition delay survives under reduce", async () => {
    const o = await run("/before-135");
    expect(o.status).toBe("fail");
    expect(o.findings).toContainEqual({
      target: "body > main > div.animate-in-triggered",
      problem: "transition-delay 1000ms under reduce",
    });
    expect(o.findings).toContainEqual({
      target: "body > main > h2.entrance",
      problem: "animation-delay 1200ms under reduce",
    });
  });

  it("FAILS a page whose only defect is an animation delay, read from the computed style", async () => {
    const o = await run("/animation-delay-only");
    expect(o.status).toBe("fail");
    expect(o.findings).toContainEqual({
      target: "body > main > h2.entrance",
      problem: "animation-delay 1500ms under reduce",
    });
  });

  it("FAILS an infinite animation on a page with no reset", async () => {
    const o = await run("/no-reset");
    expect(o.status).toBe("fail");
    expect(o.findings).toEqual([
      {
        target: "body > main > span.wiggle",
        problem: "animation pos-y-wiggle still running under reduce (no end)",
      },
    ]);
  });

  it("FAILS a Web Animations API entrance that the CSS reset cannot reach", async () => {
    const o = await run("/waapi");
    expect(o.status).toBe("fail");
    expect(o.findings).toHaveLength(1);
    expect(o.findings[0]!.target).toBe("p#intro");
    expect(o.findings[0]!.problem).toMatch(
      /^Web Animation still running under reduce \(\d+ms left\)$/,
    );
  });

  it("FAILS motion that starts only when scrolled into view", async () => {
    const o = await run("/below-fold");
    expect(o.status).toBe("fail");
    expect(o.findings).toEqual([
      {
        target: "div#late",
        problem: "animation spin still running under reduce (no end)",
      },
    ]);
  });

  it("is UNMEASURED, never a pass, when the context does not emulate reduce (negative control)", async () => {
    const noReduce = {
      ...reducedMotionRule,
      contextOptions: { reducedMotion: "no-preference" as const },
    };
    const [o] = await runDesignRules([`${base}/before-135`], [noReduce], browser);
    expect(o!.status).toBe("unmeasured");
    expect(o!.note).toMatch(/did not take/);
  });

  it("is UNMEASURED when the page cannot load", async () => {
    const [o] = await runDesignRules(["http://127.0.0.1:9/"], [reducedMotionRule], browser);
    expect(o!.status).toBe("unmeasured");
    expect(o!.note).toMatch(/^the check threw: /);
  });
});

describe("summarizeReducedMotion", () => {
  const clean: MotionSample = { reduceMatched: true, scrollY: 0, delays: [], running: [] };

  it("is unmeasured with no samples", () => {
    expect(summarizeReducedMotion("u", []).status).toBe("unmeasured");
  });

  it("reports a finding seen at several steps once, at its worst", () => {
    const o = summarizeReducedMotion("u", [
      { ...clean, delays: [{ target: "a", property: "transition-delay", ms: 300 }] },
      { ...clean, scrollY: 450, delays: [{ target: "a", property: "transition-delay", ms: 900 }] },
      { ...clean, running: [{ target: "b", name: "Web Animation", remainingMs: 120.4 }] },
    ]);
    expect(o).toEqual({
      rule: "R2",
      url: "u",
      status: "fail",
      findings: [
        { target: "a", problem: "transition-delay 900ms under reduce" },
        { target: "b", problem: "Web Animation still running under reduce (120ms left)" },
      ],
      note: "3 samples under reduce; 2 finding(s)",
    });
  });

  it("is unmeasured when any one sample lost the emulation", () => {
    expect(summarizeReducedMotion("u", [clean, { ...clean, reduceMatched: false }]).status).toBe(
      "unmeasured",
    );
  });
});
