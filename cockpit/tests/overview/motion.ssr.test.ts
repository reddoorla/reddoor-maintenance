import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import {
  BAR_MS,
  BAR_STAGGER_MS,
  COUNT_MS,
  SPARK_MS,
  FEED_MS,
  MAX_MOTION_MS,
  INTRO_MS,
  FAILSAFE_MS,
  introPlayed,
  markIntroPlayed,
  countable,
  countFrame,
  countUp,
  trendKey,
  trendReadout,
} from "../../src/lib/overview/motion.js";
import { HEALTH_CHECK_NAMES } from "../../src/lib/overview/view.js";

/** P1-87 PR 8a: the motion module's durations and its one intro flag. */
describe("the overview's motion module (P1-87 PR 8a)", () => {
  it("holds the plan's durations, and every one is within the five-second rule", () => {
    expect({ BAR_MS, BAR_STAGGER_MS, COUNT_MS, SPARK_MS, FEED_MS, MAX_MOTION_MS }).toEqual({
      BAR_MS: 600,
      BAR_STAGGER_MS: 80,
      COUNT_MS: 900,
      SPARK_MS: 900,
      FEED_MS: 400,
      MAX_MOTION_MS: 5000,
    });
    // The last bar's unknown segment ends after the last bar's fill: seven bars, stagger, two bars.
    const lastBarEnd = (HEALTH_CHECK_NAMES.length - 1) * BAR_STAGGER_MS + 2 * BAR_MS;
    expect(lastBarEnd).toBeLessThanOrEqual(MAX_MOTION_MS);
    // P1-87 PR 8a, round 2 (r1): the intro stays on until the last bar has ended, so a refresh never
    // replays it on a node it inserts (motion.ts INTRO_MS).
    expect(INTRO_MS, "the intro outlasts the last bar").toBeGreaterThanOrEqual(lastBarEnd);
    for (const ms of [BAR_MS, COUNT_MS, SPARK_MS, FEED_MS])
      expect(ms).toBeLessThanOrEqual(MAX_MOTION_MS);
  });

  it("starts with the intro unplayed, and marks it once", () => {
    expect(introPlayed()).toBe(false);
    markIntroPlayed();
    expect(introPlayed()).toBe(true);
    markIntroPlayed();
    expect(introPlayed()).toBe(true);
  });
});

/** P1-87 PR 8a, item 4: the count-up's pure helpers. */
describe("the count-up's helpers (P1-87 PR 8a, item 4)", () => {
  it("counts only a figure of digits with optional thousands commas", () => {
    for (const s of ["0", "248", "1,674", "12,345,678"]) expect(countable(s), s).toBe(true);
    for (const s of [
      "not yet collected",
      "could not be read",
      "—",
      "",
      "1,67",
      "12,34",
      "1234,567",
    ])
      expect(countable(s), s).toBe(false);
  });

  it("writes the model's string exactly at the last frame", () => {
    for (const s of ["1,674", "248", "0", "12,345,678"]) expect(countFrame(s, 1), s).toBe(s);
  });

  it("counts from 0 with an ease-out curve, keeping the model's commas", () => {
    expect(countFrame("1,674", 0)).toBe("0");
    expect(countFrame("1,674", 0.5)).toBe("1,465");
    expect(countFrame("248", 0.5)).toBe("217");
    expect(countFrame("0", 0.5)).toBe("0");
  });

  it("never shows a number above the model's, nor a longer string", () => {
    for (const s of ["1,674", "248", "12,345,678"]) {
      const n = Number(s.replace(/,/g, ""));
      for (let k = 0; k <= 100; k++) {
        const f = countFrame(s, k / 100);
        expect(Number(f.replace(/,/g, "")), `${s} at ${k}%`).toBeLessThanOrEqual(n);
        expect(f.length, `${s} at ${k}%`).toBeLessThanOrEqual(s.length);
      }
    }
  });
});

/** P1-87 PR 8a, item 5: the trend hover and keyboard readout's pure helpers. */
describe("the trend readout's helpers (P1-87 PR 8a, item 5)", () => {
  it("moves one night on ArrowRight, one at a time, stopping at the last (from no selection, see round 2 H)", () => {
    expect(trendKey("ArrowRight", 0, 21)).toBe(1);
    expect(trendKey("ArrowRight", 1, 21)).toBe(2);
    expect(trendKey("ArrowRight", 20, 21)).toBe(20);
  });

  it("moves back one night on ArrowLeft, stops at the first (no wrap), and from no selection steps back from the newest (round 2 H)", () => {
    expect(trendKey("ArrowLeft", 2, 21)).toBe(1);
    expect(trendKey("ArrowLeft", 0, 21)).toBe(0);
  });

  // P1-87 PR 8a, round 2 (H, R3): the slider reports the newest night when none is selected, so the
  // first key steps from it. Right never jumps to the oldest; Left steps back one from the newest.
  it("steps from the newest night when none is selected: Right and End select the newest, Left the one before, Home the oldest (round 2 H)", () => {
    expect(trendKey("ArrowRight", null, 17), "Right").toBe(16);
    expect(trendKey("End", null, 17), "End").toBe(16);
    expect(trendKey("ArrowLeft", null, 17), "Left").toBe(15);
    expect(trendKey("Home", null, 17), "Home").toBe(0);
  });

  it("with one night and none selected, ArrowLeft selects it (round 2 H)", () => {
    expect(trendKey("ArrowLeft", null, 1)).toBe(0);
    expect(trendKey("ArrowRight", null, 1)).toBe(0);
  });

  it("goes to the first and last nights with Home and End, clears with Escape, and leaves other keys unhandled", () => {
    expect(trendKey("End", 7, 21)).toBe(20);
    expect(trendKey("Home", 7, 21)).toBe(0);
    expect(trendKey("Escape", 7, 21)).toBeNull();
    expect(trendKey("a", 7, 21)).toBeUndefined();
    expect(trendKey("Enter", null, 21)).toBeUndefined();
    expect(trendKey("ArrowRight", null, 0)).toBeNull();
  });

  it("reads the selected night's own title, and nothing with no selection", () => {
    const titles = ["Oct 1: Broken: 0", "Oct 2: no count that night", "Oct 3: Broken: 2"];
    expect(trendReadout(titles, 0)).toBe("Oct 1: Broken: 0");
    expect(trendReadout(titles, 1)).toBe("Oct 2: no count that night");
    expect(trendReadout(titles, 2)).toBe("Oct 3: Broken: 2");
    expect(trendReadout(titles, null)).toBe("");
  });
});

/** P1-87 PR 8a, review round 1 (F1): the count-up action, run on a hand-cranked frame clock. The
 *  node is a stand-in: the action reads only `.ov-num-count` and the node's attributes. */
describe("the count-up action on a refresh (P1-87 PR 8a, review round 1, F1)", () => {
  let now = 0;
  let seq = 0;
  let pending = new Map<number, FrameRequestCallback>();
  /** Advances the clock and runs the frames requested so far, once each. */
  const tick = (ms: number) => {
    now += ms;
    const cbs = [...pending.values()];
    pending = new Map();
    for (const cb of cbs) cb(now);
  };
  const setup = () => {
    const writes: string[] = [];
    let text = "";
    const digits = {
      get textContent() {
        return text;
      },
      set textContent(v: string) {
        text = v;
        writes.push(v);
      },
    };
    const attrs = new Set<string>();
    const node = {
      querySelector: () => digits,
      setAttribute: (k: string) => void attrs.add(k),
      removeAttribute: (k: string) => void attrs.delete(k),
      hasAttribute: (k: string) => attrs.has(k),
    } as unknown as HTMLElement;
    return { node, writes, attrs, text: () => text };
  };

  it("a refresh to a word ends the count at once: no frame writes NaN, and the figure is marked counted", () => {
    now = 0;
    pending = new Map();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = ++seq;
      pending.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => void pending.delete(id));
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      const { node, writes, attrs, text } = setup();
      const action = countUp(node, { to: "1,674", enabled: true });
      expect(attrs.has("data-counting")).toBe(true);
      tick(300);
      expect(text(), "the count is under way").not.toBe("");
      expect(attrs.has("data-counting")).toBe(true);

      action.update({ to: "could not be read", enabled: true });
      tick(16);

      expect(text(), "the count span is empty").toBe("");
      expect(attrs.has("data-counted"), "the figure is marked counted").toBe(true);
      expect(attrs.has("data-counting"), "the figure is no longer counting").toBe(false);
      expect(
        writes.filter((w) => w.includes("NaN")),
        "no frame wrote NaN",
      ).toEqual([]);
      expect(pending.size, "no frame is left to run").toBe(0);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});

/** The body of the first rule in `css` whose prelude is `prelude` (whitespace collapsed),
 *  braces matched, so a rule nested in a media query or a keyframe step is found too. */
function ruleBody(css: string, prelude: string): string {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const want = prelude.replace(/\s+/g, " ").trim();
  for (let i = flat.indexOf("{"); i !== -1; i = flat.indexOf("{", i + 1)) {
    const start = Math.max(flat.lastIndexOf("}", i), flat.lastIndexOf("{", i - 1)) + 1;
    if (flat.slice(start, i).replace(/\s+/g, " ").trim() !== want) continue;
    let depth = 1;
    let j = i + 1;
    for (; j < flat.length && depth > 0; j++)
      depth += flat[j] === "{" ? 1 : flat[j] === "}" ? -1 : 0;
    return flat.slice(i + 1, j - 1);
  }
  throw new Error(`no rule ${want} in overview.css`);
}
/** One declaration's value in a rule body, or null. */
const decl = (body: string, prop: string): string | null =>
  body.match(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`))?.[1]?.trim() ?? null;

/** P1-87 minors, #2162 and #2163: the stylesheet's motion numbers and properties that no browser
 *  check reads. The stylesheet cannot import motion.ts, so these tie the two together. */
describe("the overview stylesheet's motion rules (P1-87 minors)", () => {
  const css = readFileSync(new URL("../../src/lib/overview/overview.css", import.meta.url), "utf8");

  it("delays the CSS fail-safe by FAILSAFE_MS, the count-up's own skip threshold (#2162)", () => {
    const body = ruleBody(
      css,
      "html.motion-intro .ov-tiles[data-intro] .ov-num[data-countable]:not([data-counted]):not([data-counting]) .ov-num-final",
    );
    const anim = decl(body, "animation");
    expect(anim, "the fail-safe rule runs ov-failsafe").toMatch(/^ov-failsafe\b/);
    // The shorthand's second time is the delay (the first is the 0s duration).
    const times = [...anim!.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)].map(
      ([, n, unit]) => Number(n) * (unit === "s" ? 1000 : 1),
    );
    expect(times, "a duration and a delay").toHaveLength(2);
    expect(times[1], "the fail-safe's delay is FAILSAFE_MS").toBe(FAILSAFE_MS);
  });

  it("reveals a new feed line from a clip, top to bottom (#2163)", () => {
    const keys = ruleBody(css, "@keyframes ov-feed-in");
    expect(decl(ruleBody(keys, "from"), "clip-path"), "the line starts clipped away").toBe(
      "inset(0 0 100% 0)",
    );
    expect(decl(ruleBody(keys, "to"), "clip-path"), "and ends whole").toBe("inset(0)");
  });

  it("grows the sparkline's dot from its own centre (#2163)", () => {
    const body = ruleBody(css, ".ov-tiles[data-intro] .ov-spark circle");
    expect(decl(body, "animation")).toMatch(/^ov-spark-dot\b/);
    expect(decl(body, "transform-box"), "the dot's own box, not the svg's").toBe("fill-box");
    expect(decl(body, "transform-origin")).toBe("center");
  });
});
