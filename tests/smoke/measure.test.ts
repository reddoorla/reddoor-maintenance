import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "@playwright/test";
import { measure } from "../../src/smoke/measure.js";

/**
 * reddoorla/reddoor-maintenance#1892, run for real. Every fixture is a blank
 * page at 390px with one piece of text, and carries the verdict a visitor
 * would give it: "cut" when the text visibly runs off the right edge, "fine"
 * when it does not. #1892's reviewers judged fixtures against paint, not
 * against labels (round 3's own labels were wrong on 4 of 26), so each label is
 * checked against paint here too, before `measure()` is asked: `paintedAtEdge`
 * screenshots the page with its text and again with the text made
 * transparent, and says whether any text pixel lands in the screen's last two
 * columns. A fixture whose label paint contradicts fails as a bad fixture, not
 * as a measure() defect.
 */

const VW = 390;
const LONG = "Cabinetry and millwork for the whole house, from first sketch to final install";

type Fixture = {
  /** What a visitor sees: text running off the right edge, or not. */
  expected: "cut" | "fine";
  html: string;
  /** Set where the verdict is a rule, not paint (the inert skip): what the
   *  screenshot shows, and why the label differs from it. */
  paintOverride?: { painted: boolean; why: string };
  /** The clip leaves nothing of the text: no text pixel anywhere on screen. */
  invisible?: boolean;
  /** The page is wider than the screen by construction; skip that assertion. */
  wide?: boolean;
};

// A full-width clipping section, as a page's sections are. It keeps the page
// itself no wider than the screen, so each fixture tests only the cut check.
const section = (inner: string, style = "") =>
  `<div style="overflow:hidden;${style}">${inner}</div>`;

/** Known-good inputs, which must pass on the copy as the sites have it before
 *  any finding's fixture is trusted. */
const KNOWN: Record<string, Fixture> = {
  "plain text inside the screen": {
    expected: "fine",
    html: `<p style="margin:16px">Short line.</p>`,
  },
  "text cut at the right edge": {
    expected: "cut",
    html: section(`<p style="white-space:nowrap;margin:0">${LONG}</p>`),
  },
  "a truncate block, ellipsis drawn": {
    expected: "fine",
    html: `<p style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0">${LONG}</p>`,
  },
  "the sr-only pattern": {
    expected: "fine",
    html: `<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap">${LONG}</span>`,
  },
  "a slide parked wholly past the edge": {
    expected: "fine",
    html: section(
      `<div style="display:flex;width:${VW * 3}px"><p style="width:${VW}px;flex:none;margin:0">One.</p><p style="width:${VW}px;flex:none;margin:0">Two.</p></div>`,
    ),
  },
  "a clip-path inset with a negative inset reaches past the box": {
    expected: "cut",
    html: section(
      `<div style="width:200px;clip-path:inset(0 -100vmax);white-space:nowrap">${LONG}</div>`,
    ),
  },
  // The rule the six fixes keep: a clipped line that runs past the screen
  // edge is reported even where its box ends inside the screen, because the
  // visitor sees it cut mid-word. A false failure is a clip that leaves
  // nothing of the line, which is what 4 to 6 build.
  "text cut by a box inside the screen": {
    expected: "cut",
    html: section(`<div style="width:200px;overflow:hidden;white-space:nowrap">${LONG}</div>`),
    paintOverride: {
      painted: false,
      why: "the text is cut at its 200px box, short of the screen edge; the check reports a clipped line that runs past the edge",
    },
  },
  "an inert subtree in the light DOM": {
    expected: "fine",
    html: section(`<div inert><p style="white-space:nowrap;margin:0">${LONG}</p></div>`),
    paintOverride: {
      painted: true,
      why: "the inert skip: a carousel's peeking slide paints at the edge by design",
    },
  },
};

/** An open shadow root on `#host`, holding `inner`. */
const shadow = (hostAttrs: string, inner: string) =>
  section(`<div id="host" ${hostAttrs}></div>`) +
  `<script>document.getElementById("host").attachShadow({mode:"open"}).innerHTML=${JSON.stringify(inner)}</script>`;

/** #1892's six findings, each from its HTML. 1 to 3 are false passes (cut
 *  text reported fine); 4 to 6 are false failures (fine text reported cut). */
const FINDINGS: Record<string, Fixture> = {
  "1a. a flex truncate link with an icon draws no ellipsis": {
    expected: "cut",
    html: `<a style="display:flex;align-items:center;gap:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:300px">${LONG}<svg width="16" height="16"><rect width="16" height="16"/></svg></a>`,
  },
  // #1892 says this one paints cut too; it does not. Chromium draws the
  // ellipsis on the anonymous block (seen in a screenshot, 2026-11-04), so it
  // stays here as the guard on finding 1's fix: crediting no ellipsis beside a
  // block child, as #1892 proposed, would make it a false failure.
  "1b. text beside a block child: the anonymous block draws the ellipsis": {
    expected: "fine",
    html: `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${LONG}<div>Below.</div></div>`,
  },
  // Review round 1: a multi-keyword block container draws its ellipsis.
  "1c. a flow-root list-item truncate block draws the ellipsis": {
    expected: "fine",
    html: `<div style="display:flow-root list-item;list-style:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${LONG}</div>`,
  },
  // Review round 4: a turned box's bounding rect is wider than the box, so
  // it gives no scale; the ellipsis is drawn inside the screen.
  "1h. an ellipsis in a turned box": {
    expected: "fine",
    html: section(
      `<div style="margin:40px 0 0 10px;width:370px;height:300px;rotate:-6deg;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-top:250px;box-sizing:border-box">${LONG}</div>`,
      "height:400px",
    ),
  },
  "2a. ruby does not clip": {
    expected: "cut",
    html: section(
      `<p style="white-space:nowrap;margin:0"><ruby style="overflow:hidden">${LONG}</ruby></p>`,
    ),
  },
  "2b. display: inline list-item does not clip": {
    expected: "cut",
    html: section(
      `<p style="white-space:nowrap;margin:0"><span style="display:inline list-item;overflow:hidden">${LONG}</span></p>`,
    ),
  },
  "3a. transform on a plain inline span is no containing block": {
    expected: "cut",
    html: `<div style="width:100px;overflow:hidden"><span style="transform:translateX(0)"><span style="position:fixed;left:300px;top:0;white-space:nowrap">${LONG}</span></span></div>`,
  },
  "3b. will-change on a plain inline span is no containing block": {
    expected: "cut",
    html: `<div style="width:100px;overflow:hidden"><span style="will-change:transform"><span style="position:fixed;left:300px;top:0;white-space:nowrap">${LONG}</span></span></div>`,
  },
  "3c. contain on a plain inline span is no containing block": {
    expected: "cut",
    html: `<div style="width:100px;overflow:hidden"><span style="contain:layout paint"><span style="position:fixed;left:300px;top:0;white-space:nowrap">${LONG}</span></span></div>`,
  },
  // Controls on 3's fix: filter does make a plain inline span the fixed
  // child's containing block, so the 100px box clips it.
  "3d. filter on a plain inline span is a containing block": {
    expected: "fine",
    html: `<div style="width:100px;overflow:hidden"><span style="filter:opacity(1)"><span style="position:fixed;left:300px;top:0;white-space:nowrap">${LONG}</span></span></div>`,
  },
  "3e. backdrop-filter on a plain inline span": {
    expected: "fine",
    html: `<div style="width:100px;overflow:hidden"><span style="backdrop-filter:opacity(1)"><span style="position:fixed;left:300px;top:0;white-space:nowrap">${LONG}</span></span></div>`,
  },
  "3f. will-change: filter on a plain inline span is a containing block": {
    expected: "fine",
    html: `<div style="width:100px;overflow:hidden"><span style="will-change:filter"><span style="position:fixed;left:300px;top:0;white-space:nowrap">${LONG}</span></span></div>`,
  },
  "4. an outer inline <svg> clips its text": {
    expected: "fine",
    html: section(
      `<div style="padding-left:200px"><svg width="100" height="24"><text x="150" y="18">${LONG}</text></svg></div>`,
    ),
    invisible: true,
  },
  // Review round 4: the outer <svg> clips in CSS pixels too, so under zoom
  // its box must be scaled to the screen like any other.
  "4b. an outer inline <svg> under zoom cuts its text at the edge": {
    expected: "cut",
    html: section(
      `<div style="zoom:2"><svg width="195" height="60"><text x="110" y="30" font-size="14">${LONG}</text></svg></div>`,
      "height:200px",
    ),
  },
  "5a. clip-path: inset(calc(10% - 5px)) is a positive inset": {
    expected: "fine",
    html: section(
      `<div style="width:200px;clip-path:inset(calc(10% - 5px));white-space:nowrap;text-indent:300px">${LONG}</div>`,
    ),
    invisible: true,
  },
  "5b. clip-path: inset(0) margin-box clips to the margin box": {
    expected: "fine",
    html: section(
      `<div style="width:200px;clip-path:inset(0) margin-box;white-space:nowrap;text-indent:300px">${LONG}</div>`,
    ),
    invisible: true,
  },
  // Review round 1: verdicts that hang on the resolved inset, not on the
  // shape alone.
  "5c. clip-path: inset(0 0 0 50%) leaves only the half past the screen": {
    expected: "fine",
    html: section(
      `<div style="width:1000px;clip-path:inset(0 0 0 50%);white-space:nowrap">${LONG} ${LONG}</div>`,
    ),
    invisible: true,
  },
  "5d. clip-path: inset(0) margin-box reaches into the margin": {
    expected: "cut",
    html: section(
      `<div style="width:200px;margin-right:300px;clip-path:inset(0) margin-box;white-space:nowrap;text-indent:300px">${LONG}</div>`,
    ),
  },
  "5e. a page's div:empty rule does not reach the probe": {
    expected: "fine",
    html:
      `<style>div:empty{display:none!important}div{padding:7px!important;max-width:120px}</style>` +
      section(
        `<div style="width:1000px;max-width:none;padding:0!important;clip-path:inset(0 0 0 50%);white-space:nowrap">${LONG} ${LONG}</div>`,
      ),
    invisible: true,
  },
  // Review round 1: at zoom 2 the 500px box is 1000 screen px and the 200px
  // inset 400, so what is left sits wholly past the 390px screen. It is left
  // outside a section, so only the inset's scale decides it; 5l puts a zoomed
  // inset inside one.
  "5f. clip-path insets under zoom": {
    expected: "fine",
    html: `<style>body{zoom:2}</style><div style="width:500px;clip-path:inset(0 0 0 200px);white-space:nowrap;font-size:15px">${LONG}</div>`,
    invisible: true,
    wide: true,
  },
  // Review round 2: a mirrored or rotated box's insets are on its own sides,
  // not the screen's, so the clip falls back to the whole border box.
  "5g. clip-path inset on a mirrored box keeps its left half, which paints on screen": {
    expected: "cut",
    html: section(
      `<div style="width:1000px;transform:scaleX(-1);clip-path:inset(0 0 0 50%);white-space:nowrap;font-size:30px">${LONG}</div>`,
      "height:100px",
    ),
  },
  "5h. clip-path inset under a mirrored ancestor": {
    expected: "cut",
    html: section(
      `<div style="width:1000px;transform:scaleX(-1)"><div style="clip-path:inset(0 0 0 50%);white-space:nowrap;font-size:30px">${LONG}</div></div>`,
      "height:100px",
    ),
  },
  "5i. clip-path inset on a box turned half a circle": {
    expected: "cut",
    html: section(
      `<div style="width:600px;rotate:180deg;clip-path:inset(0 0 0 97%);white-space:nowrap;font-size:30px">${LONG}</div>`,
      "height:100px",
    ),
    paintOverride: {
      painted: false,
      why: "an 18px sliver of the turned line paints at the screen's left; the line runs past the right edge, so the clipped-line rule reports it",
    },
  },
  // The fallback's limit: a negative inset or a margin box reaches past the
  // border box, which here sits wholly past the screen while the mirrored
  // line paints across the edge.
  "5j. a negative inset on a mirrored box is not narrowed to its border box": {
    expected: "cut",
    html: section(
      `<div style="margin-left:400px;width:200px;transform:scaleX(-1);clip-path:inset(0 -100vmax);white-space:nowrap">${LONG}</div>`,
    ),
  },
  "5k. a margin-box inset on a mirrored box is not narrowed to its border box": {
    expected: "cut",
    html: section(
      `<div style="margin-left:400px;margin-right:400px;width:200px;transform:scaleX(-1);clip-path:inset(0) margin-box;white-space:nowrap">${LONG}</div>`,
    ),
  },
  // Review round 2: Chromium lays -webkit-box out as a flex box, which draws
  // no ellipsis, unless -webkit-line-clamp is set.
  "1d. a -webkit-box truncate block draws no ellipsis": {
    expected: "cut",
    html: `<div style="display:-webkit-box;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${LONG}</div>`,
  },
  "1e. a -webkit-inline-box truncate block draws no ellipsis": {
    expected: "cut",
    html: `<div style="display:-webkit-inline-box;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${LONG}</div>`,
  },
  // Controls. -webkit-line-clamp makes display compute as flow-root and
  // text-overflow as clip in this Chromium (checked 2026-11-04), so a
  // computed -webkit-box is never clamped. Tailwind's line-clamp-1 wraps and
  // draws the ellipsis; with nowrap added it paints cut, with none (seen in a
  // screenshot), which round 2's suggested control had wrong.
  "1f. Tailwind's line-clamp-1 draws the ellipsis": {
    expected: "fine",
    html: `<div style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden">${LONG}</div>`,
  },
  "1g. line-clamp-1 with nowrap draws no ellipsis": {
    expected: "cut",
    html: `<div style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden;white-space:nowrap">${LONG}</div>`,
  },
  // Review round 3: overflow's padding box is in CSS pixels, the line in
  // screen pixels, so under zoom or a scaled ancestor the section clipped to
  // half its painted width and the inset's narrowed line left nothing.
  "5l. clip-path inset in a clipping section under zoom": {
    expected: "cut",
    html: `<style>body{zoom:2}</style>${section(`<div style="width:300px;clip-path:inset(0 0 0 150px);white-space:nowrap;font-size:15px">${LONG}</div>`)}`,
  },
  "5m. a line cut at the edge of a scaled clipping section": {
    expected: "cut",
    html: `<div style="overflow:hidden;width:195px;transform:scale(2);transform-origin:0 0"><div style="padding-left:150px;white-space:nowrap;font-size:15px">${LONG}</div></div>`,
  },
  // Review round 5 (the site copy has it too): a display: contents parent
  // has no box, so checkVisibility() said no and its text was never measured.
  "7a. text in a display: contents span": {
    expected: "cut",
    html: section(
      `<p style="white-space:nowrap;margin:0"><span style="display:contents">${LONG}</span></p>`,
    ),
  },
  "7b. fallback text in an empty shadow slot": {
    expected: "cut",
    html: shadow("", `<p style="white-space:nowrap;margin:0"><slot>${LONG}</slot></p>`),
  },
  "7c. a display: contents span keeps visibility: hidden": {
    expected: "fine",
    html: section(
      `<p style="white-space:nowrap;margin:0"><span style="display:contents;visibility:hidden">${LONG}</span></p>`,
    ),
  },
  // Review round 6 (the site copy has both): visibility is the text's own,
  // read where it is laid out, and the nearest box is asked only about
  // opacity, display and content-visibility.
  "7d. a visible display: contents span under a hidden box paints": {
    expected: "cut",
    html: section(
      `<p style="white-space:nowrap;margin:0;visibility:hidden"><span style="display:contents;visibility:visible">${LONG}</span></p>`,
    ),
  },
  "7e. slotted text under an opacity 0 wrapper in the shadow tree": {
    expected: "fine",
    html: shadow("", `<p style="white-space:nowrap;margin:0;opacity:0"><slot></slot></p>`).replace(
      '<div id="host" ></div>',
      `<div id="host" >${LONG}</div>`,
    ),
    invisible: true,
  },
  "7f. slotted text under a hidden wrapper in the shadow tree": {
    expected: "fine",
    html: shadow(
      "",
      `<p style="white-space:nowrap;margin:0;visibility:hidden"><slot></slot></p>`,
    ).replace('<div id="host" ></div>', `<div id="host" >${LONG}</div>`),
    invisible: true,
  },
  "6a. -webkit-mask-box-image masks to the border box": {
    expected: "fine",
    html: section(
      `<div style="width:200px;-webkit-mask-box-image:linear-gradient(#000,#000);white-space:nowrap;text-indent:300px">${LONG}</div>`,
    ),
    invisible: true,
  },
  "6b. text in an inert host's shadow tree is inert": {
    expected: "fine",
    html: shadow("inert", `<p style="white-space:nowrap;margin:0">${LONG}</p>`),
    paintOverride: {
      painted: true,
      why: "the inert skip, as for the light-DOM control above",
    },
  },
};

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: VW, height: 400 } });
});

afterAll(async () => {
  await browser?.close();
});

async function load(html: string) {
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:16px/1.4 sans-serif}</style></head><body>${html}</body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
}

/** Whether text paints in the screen's last two columns: a screenshot with
 *  the text, against one with every glyph made transparent. */
async function paintedAtEdge(clip = { x: VW - 2, y: 0, width: 2, height: 400 }): Promise<boolean> {
  const withText = await page.screenshot({ clip });
  const style = await page.addStyleTag({
    content: `*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important;caret-color:transparent!important}
      text,tspan,textPath{fill:transparent!important;stroke:transparent!important}`,
  });
  // Shadow trees do not see a document stylesheet.
  await page.evaluate(() => {
    const walk = (root: Document | ShadowRoot) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          const s = document.createElement("style");
          s.dataset.paintProbe = "";
          s.textContent = `*{color:transparent!important;-webkit-text-fill-color:transparent!important}`;
          el.shadowRoot.append(s);
          walk(el.shadowRoot);
        }
      }
    };
    walk(document);
  });
  const without = await page.screenshot({ clip });
  await style.evaluate((s) => (s as Element).remove());
  await page.evaluate(() => {
    const walk = (root: Document | ShadowRoot) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          el.shadowRoot.querySelectorAll("style[data-paint-probe]").forEach((s) => s.remove());
          walk(el.shadowRoot);
        }
      }
    };
    walk(document);
  });
  return !withText.equals(without);
}

async function verdicts(fx: Fixture) {
  await load(fx.html);
  const painted = await paintedAtEdge();
  const anywhere = fx.invisible
    ? await paintedAtEdge({ x: 0, y: 0, width: VW, height: 400 })
    : undefined;
  const m = await measure(page);
  return { painted, anywhere, measured: m.cut.length > 0 ? "cut" : "fine", m };
}

function checkFixtures(fixtures: Record<string, Fixture>) {
  for (const [name, fx] of Object.entries(fixtures)) {
    it(`${name}: ${fx.expected}`, async () => {
      const { painted, anywhere, measured, m } = await verdicts(fx);
      // The label first: a fixture paint contradicts is a bad fixture.
      const paintSays = fx.paintOverride ? fx.paintOverride.painted : fx.expected === "cut";
      expect(painted, `paint at the edge (the fixture's label is "${fx.expected}")`).toBe(
        paintSays,
      );
      if (fx.invisible) expect(anywhere, "text painted somewhere on screen").toBe(false);
      if (!fx.wide) {
        expect(m.scrollWidth, "page wider than the screen").toBeLessThanOrEqual(m.clientWidth);
      }
      expect(measured, `measure() said ${JSON.stringify(m.cut)}`).toBe(fx.expected);
    });
  }
}

describe("measure(): known-good inputs", () => {
  checkFixtures(KNOWN);
});

describe("measure(): #1892's findings", () => {
  checkFixtures(FINDINGS);
});
