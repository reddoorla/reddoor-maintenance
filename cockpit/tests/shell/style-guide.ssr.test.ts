import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { canonical, renderPage } from "../_helpers/parity.js";
import HomePage from "../../src/routes/+page.svelte";
import FleetPage from "../../src/routes/fleet/+page.svelte";
import SitePage from "../../src/routes/s/[slug]/+page.svelte";
import SubmissionsPage from "../../src/routes/submissions/+page.svelte";
import AuditsPage from "../../src/routes/audits/+page.svelte";
import { buildCockpitView, buildSitesView, chipClass } from "../../src/lib/cockpit/view.js";
import type { AttentionItem } from "../../../src/alerts/attention.js";
import { buildSiteView, healthPresentation } from "../../src/lib/site/view.js";
import { buildSubmissionsPageData } from "../../src/routes/submissions/data.js";
import { auditsPageView } from "../../src/lib/audits/view.js";
import { buildFleetTableModel, parseFleetTableQuery } from "../../../src/dashboard/fleet-table.js";
import { cases, NOW } from "../home/fixtures.js";
import { CASES as SITE_CASES } from "../site/fixtures.js";
import { model as submissionsModel } from "../submissions/fixtures.js";
import { AUDITS, NOW as AUDITS_NOW } from "../audits/fixtures.js";

/**
 * P1-78e: the Reddoor style guide across the cockpit (workspace
 * briefs/2026-10-26-p1-78e-style-and-dark-mode.md). These pin what a reviewer
 * cannot see in a markup snapshot, which drops <style>: one token sheet, no raw
 * colour, a theme a stored choice can override, no emoji, and red for Broken only.
 */

const SRC = new URL("../../src/", import.meta.url).pathname;

function filesUnder(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return filesUnder(p, ext);
    return p.endsWith(ext) ? [p] : [];
  });
}

const CSS = filesUnder(SRC, ".css");
const TOKENS = join(SRC, "lib/tokens.css");
const PAGE_SHEETS = CSS.filter((p) => p !== TOKENS);
const rel = (p: string) => p.slice(SRC.length);
const read = (p: string) => readFileSync(p, "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** A colour written as a value: hex, an rgb/hsl function, or a named colour or
 *  system colour as a declaration's value (review round 1: `color: red` slipped by). */
const RAW_COLOUR =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|:\s*(?:[^;]*\s)?(?:red|green|blue|orange|yellow|purple|pink|gray|grey|black|white|silver|maroon|navy|teal|olive|lime|aqua|fuchsia|crimson|tomato|gold|Canvas|CanvasText|ButtonFace|ButtonText)\b/i;

/** Each Svelte component's own <style> block, as [path, css]. */
// Every <style> block, attributes and all (round 3: <style lang="css"> hid one).
const SVELTE_STYLES: Array<[string, string]> = filesUnder(SRC, ".svelte").flatMap((p) => {
  const src = readFileSync(p, "utf8");
  const out: Array<[string, string]> = [];
  for (let at = src.indexOf("<style"); at >= 0; at = src.indexOf("<style", at + 1)) {
    const open = src.indexOf(">", at);
    const close = src.indexOf("</style>", open);
    if (open < 0 || close < 0) break;
    out.push([p, src.slice(open + 1, close)]);
  }
  return out;
});

/** The tokens whose value is red, in either theme: what "paints red" means. */
const RED_HEX = /^#(d71920|ff6b70|c01c21|aa1419)$/i;
const RED_TOKENS: string[] = (() => {
  const t = readFileSync(new URL("../../src/lib/tokens.css", import.meta.url).pathname, "utf8");
  const names = [...t.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
    .filter((m) => RED_HEX.test(m[2]!.trim()))
    .map((m) => m[1]!);
  return [...new Set(names)];
})();
/** A selector names Broken when one of its own classes is "broken" (not inside :not()). */
const namesBroken = (selector: string) => /\.broken\b/.test(selector.replace(/:not\([^)]*\)/g, ""));

describe("one token sheet", () => {
  it("finds the stylesheets it checks", () => {
    // Seven page sheets plus base.css, as the brief counted them.
    expect(PAGE_SHEETS.map(rel).sort()).toEqual(
      expect.arrayContaining(["lib/base.css", "routes/cockpit.css", "routes/s/[slug]/site.css"]),
    );
    expect(PAGE_SHEETS.length).toBeGreaterThanOrEqual(8);
  });

  it("no page stylesheet carries a raw colour", () => {
    const hits = PAGE_SHEETS.flatMap((p) =>
      stripComments(read(p))
        .split("\n")
        .flatMap((line, i) =>
          RAW_COLOUR.test(line) ? [`${rel(p)}:${i + 1}: ${line.trim()}`] : [],
        ),
    );
    expect(hits).toEqual([]);
  });

  it("no component's own <style> block carries a raw colour", () => {
    const hits = SVELTE_STYLES.flatMap(([p, css]) =>
      stripComments(css)
        .split("\n")
        .flatMap((line, i) =>
          RAW_COLOUR.test(line) ? [`${rel(p)}:${i + 1}: ${line.trim()}`] : [],
        ),
    );
    expect(hits).toEqual([]);
  });

  // Round 2: a list of names misses darkred and oklch(). A colour property may
  // take only a token or a CSS-wide keyword, in page sheets and Svelte <style> blocks.
  it("every colour a stylesheet declares is a token", () => {
    // Round 3: any property that can carry a colour, longhands and prefixes included.
    const COLOUR_PROP =
      /(^|-)(color|background|border(?!-(radius|collapse|spacing|width|style))|outline(?!-(offset|width|style))|shadow|fill|stroke|text-decoration|column-rule)(-|$)/;
    const ALLOWED =
      /^(transparent|currentcolor|inherit|initial|unset|none|0|solid|dashed|dotted|double|inset|underline|auto|no-repeat|center|cover|thin|medium|thick|left|right|top|bottom|[\d.]+(px|rem|em|%)?|-[\d.]+(px|rem|em)?)$/i;
    const sheets: Array<[string, string]> = [
      ...PAGE_SHEETS.map((p) => [p, read(p)] as [string, string]),
      ...SVELTE_STYLES,
    ];
    const hits = sheets.flatMap(([p, css]) =>
      [...stripComments(css).matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)]
        .filter((m) => COLOUR_PROP.test(m[1]!))
        .filter((m) => {
          const rest = m[2]!
            .replace(/var\([^)]*\)/g, " ")
            .split(/[\s,]+/)
            .filter(Boolean);
          return rest.some((w) => !ALLOWED.test(w));
        })
        .map((m) => `${rel(p)}: ${m[1]}: ${m[2]!.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  // Round 3: "--tint: darkred; color: var(--tint)" got past every colour check.
  // A colour is a token, and only tokens.css defines one.
  it("no stylesheet but the token sheet defines a custom property", () => {
    const sheets: Array<[string, string]> = [
      ...PAGE_SHEETS.map((p) => [p, read(p)] as [string, string]),
      ...SVELTE_STYLES,
    ];
    const hits = sheets.flatMap(([p, css]) =>
      [...stripComments(css).matchAll(/(^|[;{\s])(--[\w-]+)\s*:/g)].map(
        (m) => `${rel(p)}: ${m[2]}`,
      ),
    );
    expect(hits).toEqual([]);
  });

  // Round 4: a fifth red ("--alert: #c8102e") passed the hex list. The token set
  // is closed: a new colour token fails here and gets reviewed.
  it("the token sheet holds exactly the reviewed tokens", () => {
    const light = declarations(blockAfter(stripComments(read(TOKENS)), ":root {"));
    expect(Object.keys(light).sort()).toEqual(
      [
        "--band",
        "--broken",
        "--broken-fill",
        "--control-border",
        "--focus",
        "--font-sans",
        "--font-serif",
        "--ground",
        "--ink",
        "--ink-dark",
        "--ink-muted",
        "--on-broken",
        "--on-ink",
        "--radius-control",
        "--rule",
        "--space-1",
        "--space-2",
        "--space-3",
        "--space-4",
        "--space-5",
        "--space-6",
        "--surface",
        "--weight-bold",
        "--weight-text",
      ].sort(),
    );
  });

  it("the dark theme defines no token the light theme lacks", () => {
    const t = stripComments(read(TOKENS));
    const light = Object.keys(declarations(blockAfter(t, ":root {")));
    for (const sel of [':root[data-theme="dark"]', ':root:not([data-theme="light"])']) {
      expect(
        Object.keys(declarations(blockAfter(t, sel))).filter((k) => !light.includes(k)),
      ).toEqual([]);
    }
  });

  it("no token is an alias for another, so a red cannot hide behind a new name", () => {
    const t = stripComments(read(TOKENS));
    expect([...t.matchAll(/(--[\w-]+)\s*:\s*var\(/g)].map((m) => m[1])).toEqual([]);
    expect([...RED_TOKENS].sort()).toEqual(["--broken", "--broken-fill", "--focus"]);
  });

  it("the page ground is the paper token and the heading is the serif", () => {
    const base = stripComments(read(join(SRC, "lib/base.css")));
    expect(blockAfter(base, "body {")).toMatch(/background:\s*var\(--ground\)/);
    expect(blockAfter(base, "h1 {")).toMatch(/font-family:\s*var\(--font-serif\)/);
  });

  it("the serif token is Besley, the sans token Pragmatica", () => {
    const t = stripComments(read(TOKENS));
    expect(t).toMatch(/--font-serif:\s*Besley,/);
    expect(t).toMatch(/--font-sans:\s*pragmatica,/);
  });

  it("the control radius is the guide's 4px, and no longhand radius sneaks a curve in", () => {
    expect(stripComments(read(TOKENS))).toMatch(/--radius-control:\s*4px;/);
    const sheets = [...PAGE_SHEETS.map((p) => read(p)), ...SVELTE_STYLES.map(([, c]) => c)];
    // Physical and logical longhands alike (round 3: border-start-start-radius).
    expect(sheets.some((c) => /border-[\w-]+-radius\s*:/.test(c))).toBe(false);
  });

  it("numerals stay tabular: nothing turns them back", () => {
    const sheets = [...PAGE_SHEETS.map((p) => read(p)), ...SVELTE_STYLES.map(([, c]) => c)];
    expect(sheets.some((c) => /font-variant-numeric\s*:\s*normal/.test(c))).toBe(false);
  });

  it("the raw-colour pattern catches a named colour (positive control)", () => {
    expect(RAW_COLOUR.test("  color: red;")).toBe(true);
    expect(RAW_COLOUR.test("  border: 1px solid Canvas;")).toBe(true);
    expect(RAW_COLOUR.test("  color: var(--broken);")).toBe(false);
    expect(RAW_COLOUR.test("  text-decoration: underline;")).toBe(false);
  });

  // The guide: square corners, except its 4px controls, and round dots.
  it("corners are square except the control radius and round dots", () => {
    const sheets: Array<[string, string]> = [
      ...PAGE_SHEETS.map((p) => [p, read(p)] as [string, string]),
      ...SVELTE_STYLES,
    ];
    const hits = sheets.flatMap(([p, css]) =>
      [...stripComments(css).matchAll(/border-radius\s*:\s*([^;]+);/g)]
        .map((m) => m[1]!.trim())
        .filter((v) => !["var(--radius-control)", "50%", "0"].includes(v))
        .map((v) => `${rel(p)}: ${v}`),
    );
    expect(hits).toEqual([]);
  });

  it("no component writes a colour inline", () => {
    const hits = filesUnder(SRC, ".svelte").flatMap((p) =>
      read(p)
        .split("\n")
        .flatMap((line, i) =>
          // An attribute or a style: directive that sets any colour (round 2:
          // style:color={"#666"} and style="color: red" slipped by).
          /style="[^"]*(color|background|border|outline|fill|stroke)/i.test(line) ||
          /style:(color|background|border|outline|fill|stroke)/i.test(line) ||
          /style=\{[^}]*(color|background|border|outline|fill|stroke)/i.test(line)
            ? [`${rel(p)}:${i + 1}`]
            : [],
        ),
    );
    expect(hits).toEqual([]);
  });

  it("the shell loads the token sheet before every other sheet", () => {
    const shell = read(join(SRC, "lib/Shell.svelte"));
    expect(shell).toMatch(/sheets=\{\[tokensCss, baseCss\]\}/);
  });
});

/** The custom properties a selector block sets, as name → value. */
function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

function blockAfter(css: string, selector: string): string {
  // At the start of a line, so "body {" never matches inside "tbody {" (round 4).
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(^|\\n)[ \\t]*${esc}`).exec(css);
  if (!m) return "";
  const at = m.index + m[0].length - selector.length;
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("dark mode", () => {
  const tokens = stripComments(read(TOKENS));

  it("no page stylesheet keeps a prefers-color-scheme block, which a stored 'light' could not override", () => {
    const hits = PAGE_SHEETS.filter((p) => /prefers-color-scheme/.test(read(p))).map(rel);
    expect(hits).toEqual([]);
  });

  it("the token sheet's one media block is guarded, so a stored 'light' wins over a dark system", () => {
    const blocks = [
      ...tokens.matchAll(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*([^{]+)\{/g),
    ];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]![1]!.trim()).toBe(':root:not([data-theme="light"])');
  });

  it("follows the system when nothing is stored: the system block sets the same dark tokens", () => {
    const stored = declarations(blockAfter(tokens, ':root[data-theme="dark"]'));
    const system = declarations(blockAfter(tokens, ':root:not([data-theme="light"])'));
    expect(Object.keys(stored).length).toBeGreaterThan(10);
    expect(system).toEqual(stored);
    const light = declarations(blockAfter(tokens, ":root {"));
    expect(light["--ground"]).not.toBe(stored["--ground"]);
  });

  it("a dark theme, stored or from the system, tells the browser so (native controls, scrollbars)", () => {
    expect(blockAfter(tokens, ':root[data-theme="dark"]')).toMatch(/color-scheme:\s*dark/);
    expect(blockAfter(tokens, ':root:not([data-theme="light"])')).toMatch(/color-scheme:\s*dark/);
  });

  it("every token the light theme sets, the dark theme sets too", () => {
    const light = declarations(blockAfter(tokens, ":root {"));
    const dark = declarations(blockAfter(tokens, ':root[data-theme="dark"]'));
    const colours = Object.keys(light).filter((k) => /^#/.test(light[k]!));
    expect(colours.filter((k) => !(k in dark))).toEqual([]);
  });
});

/** WCAG relative luminance and contrast. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

describe("contrast, measured on the page ground (paper in light), in both themes", () => {
  const tokens = stripComments(read(TOKENS));
  const themes = {
    light: declarations(blockAfter(tokens, ":root {")),
    dark: {
      ...declarations(blockAfter(tokens, ":root {")),
      ...declarations(blockAfter(tokens, ':root[data-theme="dark"]')),
    },
  };

  it("the light ground is the guide's paper, not white", () => {
    expect(themes.light["--ground"]).toBe("#f6f6f6");
  });

  for (const [theme, t] of Object.entries(themes)) {
    for (const fg of ["--ink", "--ink-muted", "--ink-dark", "--broken"]) {
      for (const bg of ["--ground", "--surface"]) {
        it(`${theme}: ${fg} on ${bg} clears 4.5:1`, () => {
          expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    it(`${theme}: text on a Broken fill and on an ink fill clears 4.5:1`, () => {
      expect(contrast(t["--on-broken"]!, t["--broken-fill"]!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["--on-ink"]!, t["--ink"]!)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${theme}: ink on --band (the plain chip) clears 4.5:1`, () => {
      expect(contrast(t["--ink"]!, t["--band"]!)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${theme}: a control's only boundary clears 3:1`, () => {
      expect(contrast(t["--control-border"]!, t["--ground"]!)).toBeGreaterThanOrEqual(3);
    });
  }
});

/** Every rule in a sheet, as [selector, body], media blocks flattened. */
function rules(css: string): Array<[string, string]> {
  const flat = stripComments(css).replace(/@media[^{]+\{([\s\S]*?\})\s*\}/g, "$1");
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!]);
}

describe("red marks Broken only", () => {
  // The red tokens may appear only on Broken markers (the focus ring is --focus).
  // Only "broken": "critical" is a severity, and a critical item can be Attention
  // (review round 1: a stuck vulnerability's chip was red).
  const paintsRed = (body: string) =>
    RED_TOKENS.filter((t) => t !== "--focus").some((t) => body.includes(`var(${t})`));

  it("every rule that paints red is a Broken marker", () => {
    const offenders = PAGE_SHEETS.flatMap((p) =>
      rules(read(p))
        .filter(([, body]) => paintsRed(body))
        // Each selector of a group (round 2: ".chip.broken, .badge" painted badges red),
        // and a class of its own (round 3: ":not(.broken)" matched /broken/).
        .filter(([sel]) => sel.split(",").some((x) => !namesBroken(x)))
        .map(([sel]) => `${rel(p)}: ${sel}`),
    );
    expect(offenders).toEqual([]);
  });

  // Review round 1: on a red fill, text at 0.85 opacity measured 4.04:1, and a
  // descendant rule's ink (.badge, .stuck) or grey (.rf-sub) beat the inherited
  // white. What sits on red is --on-broken, at full strength.
  // Round 2: ".chip.broken > .badge { color: var(--ink) }" names broken, and
  // brought back black on red. A Broken rule's text is white or red, never ink.
  it("a rule naming broken sets its text colour only to the on-broken or broken token", () => {
    const offenders = PAGE_SHEETS.flatMap((p) =>
      rules(read(p))
        .filter(([sel]) => namesBroken(sel))
        .flatMap(([sel, body]) =>
          [...body.matchAll(/(?:^|;|\s)color\s*:\s*([^;]+);/g)]
            .filter((m) => !/^var\(--(on-broken|broken)\)$/.test(m[1]!.trim()))
            .map((m) => `${rel(p)}: ${sel} → ${m[1]!.trim()}`),
        ),
    );
    expect(offenders).toEqual([]);
  });

  it("nothing on a red fill is dimmed", () => {
    const dimmed = PAGE_SHEETS.flatMap((p) =>
      rules(read(p))
        .filter(([sel, body]) => namesBroken(sel) && /opacity\s*:/.test(body))
        .map(([sel]) => `${rel(p)}: ${sel}`),
    );
    expect(dimmed).toEqual([]);
  });

  it("what sits on a red fill keeps the on-broken colour", () => {
    const all = PAGE_SHEETS.flatMap((p) => rules(read(p)));
    const sets = (selector: string, prop: string) =>
      all.some(
        ([sel, body]) =>
          sel.split(",").some((s) => s.trim() === selector) &&
          new RegExp(`${prop}\\s*:\\s*var\\(--on-broken\\)`).test(body),
      );
    // A sheet that colours .badge or .chip.stuck must override it on red in the
    // same sheet: an override elsewhere does not load with that page.
    for (const p of PAGE_SHEETS) {
      const own = rules(read(p));
      const setsInSheet = (selector: string) =>
        own.some(
          ([sel, body]) =>
            sel.split(",").some((x) => x.trim() === selector) &&
            /color\s*:\s*var\(--on-broken\)/.test(body),
        );
      for (const [cls, onRed] of [
        [".badge", ".chip.broken .badge"],
        [".chip.stuck", ".chip.broken.stuck"],
      ] as const) {
        const colours = own.some(
          ([sel, body]) =>
            sel.split(",").some((x) => x.trim() === cls) && /(^|;|\s)color\s*:/.test(body),
        );
        if (colours) expect(setsInSheet(onRed), `${rel(p)}: ${onRed}`).toBe(true);
      }
    }
    expect(sets(".verdict.broken .verdict-meta", "color")).toBe(true);
    expect(sets(".verdict.broken .rf-sub", "color")).toBe(true);
    expect(sets(".verdict.broken a", "color")).toBe(true);
    expect(sets(".verdict.broken :focus-visible", "outline-color")).toBe(true);
  });

  it("no Svelte <style> block paints red", () => {
    const hits = SVELTE_STYLES.filter(([, css]) =>
      /var\(--(broken|broken-fill|focus)\)/.test(css),
    ).map(([p]) => rel(p));
    expect(hits).toEqual([]);
  });

  // Round 3: nothing required Broken to BE red; a grey Broken chip passed.
  it("every Broken marker is filled red", () => {
    const filled = (file: string, selector: string) =>
      rules(read(join(SRC, file))).some(
        ([sel, b]) =>
          sel.split(",").some((x) => x.trim() === selector) &&
          /background:\s*var\(--broken-fill\)/.test(b),
      );
    expect(filled("lib/cockpit/health.css", ".chip.broken")).toBe(true);
    expect(filled("routes/s/[slug]/site.css", ".chip.broken")).toBe(true);
    expect(filled("lib/cockpit/health.css", ".pill.broken")).toBe(true);
    expect(filled("routes/s/[slug]/site.css", ".pill.broken")).toBe(true);
    expect(filled("routes/cockpit.css", ".verdict.broken")).toBe(true);
    expect(filled("routes/cockpit.css", ".dot.broken")).toBe(true);
  });

  // Round 4: red text on the red fill, and ink on an ink fill, both passed. A
  // rule that lays a fill sets that fill's tested partner as its text colour.
  it("every filled rule sets its fill's tested text partner", () => {
    const PARTNER: Record<string, string> = {
      "--broken-fill": "--on-broken",
      "--ink": "--on-ink",
    };
    const offenders = PAGE_SHEETS.flatMap((p) =>
      rules(read(p)).flatMap(([sel, body]) => {
        const fill = /(?:^|;|\s)background(?:-color)?\s*:\s*var\((--[\w-]+)\)/.exec(body)?.[1];
        if (!fill || !(fill in PARTNER)) return [];
        // A dot carries no text.
        if (sel.split(",").every((x) => /\.dot\b/.test(x))) return [];
        const text = /(?:^|;|\s)color\s*:\s*var\((--[\w-]+)\)/.exec(body)?.[1];
        return text === PARTNER[fill]
          ? []
          : [`${rel(p)}: ${sel} (${fill} with ${text ?? "no colour"})`];
      }),
    );
    expect(offenders).toEqual([]);
  });

  // Round 5: the partner rule ran one way only. A rule that sets a fill's text
  // partner must lay that fill (or name broken, inside the red band), or the
  // white text lands on paper.
  it("a fill's text partner is only ever set where that fill is laid", () => {
    const offenders = PAGE_SHEETS.flatMap((p) =>
      rules(read(p)).flatMap(([sel, body]) => {
        const text = /(?:^|;|\s)color\s*:\s*var\((--on-(?:ink|broken))\)/.exec(body)?.[1];
        if (!text) return [];
        const fill = text === "--on-ink" ? "--ink" : "--broken-fill";
        const lays = new RegExp(`background(?:-color)?\\s*:\\s*var\\(${fill}\\)`).test(body);
        const inBand = text === "--on-broken" && sel.split(",").every((x) => namesBroken(x));
        return lays || inBand ? [] : [`${rel(p)}: ${sel} sets ${text} without ${fill}`];
      }),
    );
    expect(offenders).toEqual([]);
  });

  // Round 5: "--rule" (1.74:1) as text passed. Text takes a tested text token.
  it("text colour is only ever a tested text token", () => {
    const TEXT = new Set([
      "--ink",
      "--ink-muted",
      "--ink-dark",
      "--broken",
      "--on-ink",
      "--on-broken",
    ]);
    // Svelte <style> blocks too (round 6: .cockpit-newer in --rule passed).
    const sheets: Array<[string, string]> = [
      ...PAGE_SHEETS.map((p) => [p, read(p)] as [string, string]),
      ...SVELTE_STYLES,
    ];
    const offenders = sheets.flatMap(([p, css]) =>
      rules(css).flatMap(([sel, body]) =>
        [...body.matchAll(/(?:^|;|\s)color\s*:\s*var\((--[\w-]+)\)/g)]
          .filter((m) => !TEXT.has(m[1]!))
          .map((m) => `${rel(p)}: ${sel} → ${m[1]}`),
      ),
    );
    expect(offenders).toEqual([]);
  });

  // Round 5: anything inside the Broken verdict that sets its own colour needs a
  // .verdict.broken override, or it lands on red (.rf-status in muted was 1.03:1).
  it("every class drawn inside the verdict that sets a colour is overridden on the red band", () => {
    const sheet = rules(read(join(SRC, "routes/cockpit.css")));
    const overridden = new Set(
      sheet
        .filter(([, b]) => /var\(--on-broken\)/.test(b))
        .flatMap(([sel]) => sel.split(","))
        .map((x) => x.trim())
        .filter((x) => x.startsWith(".verdict.broken "))
        .map((x) => x.slice(".verdict.broken ".length)),
    );
    const coloured = sheet
      // A colour or a coloured border (round 6: the spinner is drawn by its border).
      .filter(
        ([sel, b]) =>
          /(^|\s|\.)(rf-|verdict-)/.test(sel) &&
          (/(?:^|;|\s)color\s*:/.test(b) || /border(-[a-z]+)?\s*:[^;]*var\(--/.test(b)),
      )
      .flatMap(([sel]) => sel.split(","))
      .map((x) => x.trim())
      .filter((x) => !x.startsWith(".verdict"));
    expect(coloured.filter((c) => !overridden.has(c))).toEqual([]);
  });

  it("the red focus ring appears only on a focus selector", () => {
    const offenders = PAGE_SHEETS.flatMap((p) =>
      rules(read(p))
        .filter(([, body]) => /var\(--focus\)/.test(body))
        .filter(([sel]) => !/:focus/.test(sel))
        .map(([sel]) => `${rel(p)}: ${sel}`),
    );
    expect(offenders).toEqual([]);
  });

  // The brief: Attention and Watch differ by word, weight and position.
  it("an Attention pill is bold and a Watch pill is not", () => {
    const health = rules(read(join(SRC, "lib/cockpit/health.css")));
    const weight = (selector: string) =>
      health
        .filter(([sel]) => sel === selector)
        .map(([, b]) => /font-weight\s*:\s*([^;]+);/.exec(b)?.[1]?.trim())
        .find(Boolean);
    expect(weight(".pill")).toBe("700");
    // Round 4: /s/:slug's own .pill weight was unpinned.
    const sitePill = rules(read(join(SRC, "routes/s/[slug]/site.css")))
      .filter(([sel]) => sel === ".pill")
      .map(([, b]) => /font-weight\s*:\s*([^;]+);/.exec(b)?.[1]?.trim())
      .find(Boolean);
    expect(sitePill).toBe("700");
    expect(weight(".pill.attention")).toBeUndefined();
    expect(weight(".pill.watch")).toBe("var(--weight-text)");
    // Round 3: /s/:slug had its own bold Watch pill.
    const site = rules(read(join(SRC, "routes/s/[slug]/site.css")));
    const siteWatch = site
      .filter(([sel]) => sel === ".pill.watch")
      .map(([, b]) => /font-weight\s*:\s*([^;]+);/.exec(b)?.[1]?.trim())
      .find(Boolean);
    expect(siteWatch).toBe("var(--weight-text)");
  });

  it("an Attention or Watch marker is never red", () => {
    const offenders = PAGE_SHEETS.flatMap((p) =>
      rules(read(p))
        .filter(([sel]) => /attention|watch/.test(sel))
        .filter(([, body]) => /var\(--broken|var\(--focus/.test(body))
        .map(([sel]) => `${rel(p)}: ${sel}`),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * Emoji and glyph icons: the guide allows typographic marks only (:24). Plain
 * arrows (← →) and the typographic set (— · … ’) stay; pictographs and the
 * glyphs the cockpit used as icons go.
 */
// The brief's ranges (U+2190–21FF arrows, U+2500–27BF shapes and dingbats), less
// the four plain arrows the guide allows; plus pictographs and U+FE0F.
const GLYPH = /\p{Extended_Pictographic}|[\u2194-\u21FF\u2500-\u27BF]|\uFE0F/u;

function glyphs(lines: string[]): string[] {
  return lines.filter((l) => GLYPH.test(l));
}

describe("no emoji in the cockpit's code, outside comments", () => {
  // A backstop for strings no fixture renders (review round 1: a warn-only
  // preflight chip). Comments may name the old glyphs; code may not.
  it("no glyph in any .ts or .svelte under cockpit/src, once comments are removed", () => {
    // Cut each block comment out by its delimiters' offsets, keeping its newlines
    // so line numbers hold (CodeQL reads a regex over "<!--" as a sanitiser).
    const cut = (src: string, open: string, close: string): string => {
      let out = "";
      let at = 0;
      for (;;) {
        const start = src.indexOf(open, at);
        if (start < 0) return out + src.slice(at);
        const end = src.indexOf(close, start + open.length);
        const stop = end < 0 ? src.length : end + close.length;
        out += src.slice(at, start) + src.slice(start, stop).replace(/[^\n]/g, "");
        at = stop;
      }
    };
    const code = (src: string) =>
      // A line comment starts a line or follows code's punctuation; "//" inside a
      // string (round 2: `preflight // ⚠`) is left for the scan.
      cut(cut(src, "<!--", "-->"), "/*", "*/").replace(/(^\s*|[;{}),]\s+)\/\/.*$/gm, "$1");
    const hits = [...filesUnder(SRC, ".ts"), ...filesUnder(SRC, ".svelte")].flatMap((p) =>
      code(read(p))
        .split("\n")
        .flatMap((line, i) => (GLYPH.test(line) ? [`${rel(p)}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(hits).toEqual([]);
  });
});

describe("no glyph drawn by a stylesheet", () => {
  // Round 3: ".chip.stuck::before { content: '⚠ ' }" reached every stuck chip,
  // and the page scans drop <style>. CSS escapes (\\26A0) count too.
  it("no content: in a page sheet or a Svelte <style> carries a glyph", () => {
    const sheets: Array<[string, string]> = [
      ...PAGE_SHEETS.map((p) => [p, read(p)] as [string, string]),
      ...SVELTE_STYLES,
    ];
    const ESCAPED = /\\(2[1-7][0-9a-f]{2}|1f[0-9a-f]{3}|fe0f)/i;
    const hits = sheets.flatMap(([p, css]) =>
      [...stripComments(css).matchAll(/content\s*:\s*([^;]+);/g)]
        .filter((m) => GLYPH.test(m[1]!) || ESCAPED.test(m[1]!))
        .map((m) => `${rel(p)}: ${m[1]!.trim()}`),
    );
    expect(hits).toEqual([]);
  });
});

describe("no emoji in any rendered page", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterAll(() => vi.useRealTimers());

  it("finds a glyph when one is there (the instrument's positive control)", () => {
    expect(glyphs(["fine", "📥 3 new", "✓ All clear", "Next →"])).toEqual([
      "📥 3 new",
      "✓ All clear",
    ]);
  });

  it("/ and /fleet, every cockpit case", () => {
    for (const [, model] of cases()) {
      expect(
        glyphs(canonical(renderPage(HomePage, { data: { view: buildCockpitView(model, NOW) } }))),
      ).toEqual([]);
      const table = buildFleetTableModel(
        model.cards.map((c) => c.site),
        parseFleetTableQuery(new URLSearchParams("sort=name&dir=asc")),
      );
      expect(
        glyphs(
          canonical(
            renderPage(FleetPage, { data: { model: table, sites: buildSitesView(model, NOW) } }),
          ),
        ),
      ).toEqual([]);
    }
  });

  it("/s/:slug, every site case", () => {
    for (const [, i] of SITE_CASES) {
      const view = buildSiteView(i.site, i.reports, i.submissions, i.spam, i.now, i.alarm);
      expect(glyphs(canonical(renderPage(SitePage, { data: { view } })))).toEqual([]);
    }
  });

  it("/submissions and /audits", () => {
    expect(
      glyphs(
        canonical(
          renderPage(SubmissionsPage, { data: buildSubmissionsPageData(submissionsModel({})) }),
        ),
      ),
    ).toEqual([]);
    expect(
      glyphs(canonical(renderPage(AuditsPage, { data: auditsPageView(AUDITS, AUDITS_NOW) }))),
    ).toEqual([]);
  });
});

describe("the stored theme is applied before first paint", () => {
  const html = read(join(SRC, "app.html"));
  // Our own app.html's one inline script, cut out by its tags (a regex over HTML
  // reads as a sanitiser to CodeQL; this is not one).
  const open = html.indexOf("<script>");
  const script =
    open < 0 ? "" : html.slice(open + "<script>".length, html.indexOf("</script>", open));

  function runHead(stored: string | null, refuse = false): string | null {
    let theme: string | null = null;
    runInNewContext(script, {
      localStorage: {
        getItem: (k: string) => {
          if (refuse) throw new Error("SecurityError");
          return k === "cockpit-theme" ? stored : null;
        },
      },
      document: {
        documentElement: {
          // The attribute must be data-theme: the tokens key on it (round 2: a
          // renamed attribute applied nothing on reload, and the test passed).
          setAttribute: (name: string, v: string) =>
            (theme = name === "data-theme" ? v : `wrong:${name}`),
        },
      },
    });
    return theme;
  }

  it("is an inline script in the head, before SvelteKit's head and so before every stylesheet", () => {
    const at = html.indexOf("<script>");
    expect(at).toBeGreaterThan(html.indexOf("<head>"));
    expect(at).toBeLessThan(html.indexOf("%sveltekit.head%"));
    expect(at).toBeLessThan(html.indexOf('rel="stylesheet"'));
  });

  it("applies a stored dark or light, and nothing for none, junk or a refused storage", () => {
    expect(runHead("dark")).toBe("dark");
    expect(runHead("light")).toBe("light");
    expect(runHead(null)).toBeNull();
    expect(runHead("purple")).toBeNull();
    expect(runHead("dark", true)).toBeNull();
  });

  it("uses the same key as the toggle", async () => {
    const { THEME_KEY } = await import("../../src/lib/theme.js");
    expect(script).toContain(`"${THEME_KEY}"`);
  });
});

describe("layout and weight the round-2 review pinned", () => {
  // Round 2: ".run-form textarea { font: inherit }" outranked the base rule and
  // carried the label's 600 into what a person types.
  it("a control rule that inherits its font sets the text weight back", () => {
    const offenders = PAGE_SHEETS.flatMap((p) =>
      rules(read(p))
        .filter(([sel]) => /\b(input|textarea|select)\b/.test(sel))
        // base.css's element-only reset is followed by its own weight rule, checked below.
        .filter(([sel]) => /[.[#]/.test(sel))
        .filter(([, b]) => /font\s*:\s*inherit/.test(b) && !/font-weight\s*:/.test(b))
        .map(([sel]) => `${rel(p)}: ${sel}`),
    );
    expect(offenders).toEqual([]);
    const base = rules(read(join(SRC, "lib/base.css")));
    expect(
      base.some(
        ([sel, b]) =>
          /\binput\b/.test(sel) &&
          /\btextarea\b/.test(sel) &&
          /font-weight:\s*var\(--weight-text\)/.test(b),
      ),
    ).toBe(true);
  });

  // Rounds 2 and 3: a floated account block, widened by the toggle, squeezed
  // the nav into a column from 390 to about 800px and overlapped a long email.
  // The header is one wrapping flex row instead; the account wraps above the nav.
  it("the header wraps the account above the nav instead of floating it", () => {
    const base = stripComments(read(join(SRC, "lib/base.css")));
    expect(base).not.toMatch(/\.shell-account\s*\{[^}]*float/);
    const header = blockAfter(base, "header[data-shell] {");
    expect(header).toMatch(/display:\s*flex/);
    expect(header).toMatch(/flex-wrap:\s*wrap-reverse/);
    expect(blockAfter(base, ".shell-account {")).toMatch(/order:\s*1/);
    expect(blockAfter(base, ".shell-nav {")).toMatch(/order:\s*0/);
  });

  // Round 3: the browser's placeholder grey was 4.26:1 on paper, and on the API
  // key field the placeholder is the only sign a key is stored.
  // Round 4: round 3 dropped the toggle's own rule, leaving it at the browser's
  // padding, 23px tall.
  it("the theme toggle keeps its own padding and border", () => {
    const toggle = blockAfter(stripComments(read(join(SRC, "lib/base.css"))), ".theme-toggle {");
    expect(toggle).toMatch(/padding:\s*0\.2rem 0\.6rem/);
    expect(toggle).toMatch(/border:\s*1px solid var\(--control-border\)/);
  });

  // Round 6: links are ink, marked only by their underline, so a rule that drops
  // it left the Sites table's sort headers indistinguishable from plain headers.
  // Only something drawn as a control or badge (with a border) may drop it.
  it("a link keeps its underline unless it is drawn as a control", () => {
    const offenders = PAGE_SHEETS.flatMap((p) => {
      const sheet = rules(read(p));
      const hoverUnderlines = (sel: string) =>
        sheet.some(
          ([h, b]) => h === `a${sel}:hover` && /text-decoration(-line)?\s*:\s*underline/.test(b),
        );
      return sheet
        .filter(([, b]) => /text-decoration(-line)?\s*:\s*none/.test(b))
        .filter(([, b]) => !/(^|;|\s)border(-[a-z]+)?\s*:\s*(?!0|none)/.test(b))
        .filter(([sel]) => !hoverUnderlines(sel))
        .map(([sel]) => `${rel(p)}: ${sel}`);
    });
    expect(offenders).toEqual([]);
  });

  // Round 6: these base rules were unpinned. A control's only boundary must be
  // the 3:1 control token (--rule is 1.74:1), and the focus ring must stay.
  it("controls are bounded by the control token, and focus is always visible", () => {
    const base = rules(read(join(SRC, "lib/base.css")));
    const controlRule = base.filter(
      ([sel, b]) => /\bbutton\b/.test(sel) && /\btextarea\b/.test(sel) && /border\s*:/.test(b),
    );
    expect(controlRule.length).toBeGreaterThan(0);
    for (const [, b] of controlRule)
      expect(b).toMatch(/border:\s*1px solid var\(--control-border\)/);
    const focus = base.find(([sel]) => sel === ":focus-visible")?.[1] ?? "";
    expect(focus).toMatch(/outline:\s*2px solid var\(--focus\)/);
    const sheets = [...PAGE_SHEETS.map((p) => read(p)), ...SVELTE_STYLES.map(([, c]) => c)];
    for (const css of sheets) {
      for (const [sel, b] of rules(css)) {
        if (/:focus/.test(sel)) expect(b, sel).not.toMatch(/outline(-style)?\s*:\s*(none|0)\b/);
      }
    }
  });

  // Round 6: muted text on --band (4.10:1) and a dimmed .meta (about 3:1) passed,
  // because contrast was tested by token pair, not by the pair a rule lays down.
  it("a rule's own text on its own fill clears 4.5:1 in both themes", () => {
    const t = stripComments(read(TOKENS));
    const light = declarations(blockAfter(t, ":root {"));
    const dark = { ...light, ...declarations(blockAfter(t, ':root[data-theme="dark"]')) };
    const offenders = PAGE_SHEETS.flatMap((p) =>
      rules(read(p)).flatMap(([sel, b]) => {
        const fill = /(?:^|;|\s)background(?:-color)?\s*:\s*var\((--[\w-]+)\)/.exec(b)?.[1];
        const text = /(?:^|;|\s)color\s*:\s*var\((--[\w-]+)\)/.exec(b)?.[1];
        if (!fill || !text) return [];
        return [light, dark]
          .filter((th) => th[fill] && th[text] && contrast(th[text]!, th[fill]!) < 4.5)
          .map(() => `${rel(p)}: ${sel} (${text} on ${fill})`);
      }),
    );
    expect([...new Set(offenders)]).toEqual([]);
    for (const f of ["lib/cockpit/health.css", "routes/s/[slug]/site.css"]) {
      const chip = rules(read(join(SRC, f))).find(([sel]) => sel === ".chip")?.[1] ?? "";
      expect(chip, f).not.toMatch(/color:\s*var\(--ink-muted\)/);
    }
  });

  it("text is never dimmed: opacity below 1 only on a disabled, hover or active state", () => {
    const sheets: Array<[string, string]> = [
      ...PAGE_SHEETS.map((p) => [p, read(p)] as [string, string]),
      ...SVELTE_STYLES,
    ];
    const offenders = sheets.flatMap(([p, css]) =>
      rules(css)
        .filter(([, b]) => /(^|;|\s)opacity\s*:\s*(0?\.\d+|0)\s*;/.test(b))
        .filter(([sel]) => !/:(disabled|hover|active)/.test(sel))
        .map(([sel]) => `${rel(p)}: ${sel}`),
    );
    expect(offenders).toEqual([]);
  });

  it("placeholders are the muted ink at full strength", () => {
    const base = stripComments(read(join(SRC, "lib/base.css")));
    const ph = blockAfter(base, "::placeholder {");
    expect(ph).toMatch(/color:\s*var\(--ink-muted\)/);
    expect(ph).toMatch(/opacity:\s*1/);
  });

  it("a Broken chip is bold as well as red, in each sheet that styles it", () => {
    for (const f of ["lib/cockpit/health.css", "routes/s/[slug]/site.css"]) {
      const body = rules(read(join(SRC, f))).find(([sel]) => sel === ".chip.broken")?.[1] ?? "";
      expect(body, f).toMatch(/font-weight:\s*var\(--weight-bold\)/);
    }
  });
});

describe("type", () => {
  const html = read(join(SRC, "app.html"));
  it("loads Pragmatica from the Adobe kit and Besley from Google Fonts", () => {
    expect(html).toContain("https://use.typekit.net/noj4tji.css");
    expect(html).toMatch(/fonts\.googleapis\.com\/css2\?family=Besley/);
  });
  it("swaps each font sheet in once it loads, so it never blocks first paint and does apply", () => {
    for (const href of ["use.typekit.net/noj4tji.css", "fonts.googleapis.com/css2?family=Besley"]) {
      const at = html.indexOf(href);
      const tag = html.slice(html.lastIndexOf("<link", at), html.indexOf("/>", at));
      expect(tag, href).toMatch(/media="print"/);
      expect(tag, href).toMatch(/onload="this\.media\s*=\s*'all'"/);
    }
  });

  it("sets Pragmatica as the body family, with tabular numerals", () => {
    const base = stripComments(read(join(SRC, "lib/base.css")));
    const body = blockAfter(base, "body {");
    expect(body).toMatch(/font-family:\s*var\(--font-sans\)/);
    expect(body).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(stripComments(read(TOKENS))).toMatch(/--font-sans:\s*pragmatica/);
  });
});

describe("a Broken item renders a red chip on the pages", () => {
  // Round 2: no snapshot held a red chip, so dropping chipClass at a call site
  // survived. The fixtures now carry a real Broken item (an uptime fail).
  it("/s/:slug: the Broken item is a red chip and the critical vulnerability is not", () => {
    const [, i] = SITE_CASES.find(([n]) => n.startsWith("alarm: attention items"))!;
    const view = buildSiteView(i.site, i.reports, i.submissions, i.spam, i.now, i.alarm);
    const html = renderPage(SitePage, { data: { view } });
    expect(html).toMatch(/<span class="chip broken">(?:\s|<!--[^>]*-->)*Site down/);
    expect(html).toMatch(/<span class="chip">(?:\s|<!--[^>]*-->)*Critical vuln/);
  });

  it("/fleet: the Broken card's uptime item is a red chip", () => {
    const hits = cases().filter(([, model]) =>
      /<span class="chip broken">(?:\s|<!--[^>]*-->)*Site down/.test(
        renderPage(FleetPage, {
          data: {
            model: buildFleetTableModel(
              model.cards.map((c) => c.site),
              parseFleetTableQuery(new URLSearchParams()),
            ),
            sites: buildSitesView(model, NOW),
          },
        }),
      ),
    );
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("red marks Broken only, in the views", () => {
  // Review round 2: a failing report check rendered "pill broken" (red) beside
  // "advisory — never blocks". A pre-send check is not the ladder's Broken.
  it("a report checklist row is never the Broken class, whatever its result", () => {
    for (const r of ["pass", "fail", "n/a", "unknown"] as const) {
      expect(healthPresentation(r).cls).not.toBe("broken");
    }
    expect(healthPresentation("fail")).toEqual({ cls: "blocks", word: "blocks" });
  });

  // Review round 2: controls inherited the red band's white onto a white surface.
  it("a control's text is ink on its surface, never inherited", () => {
    const base = rules(read(join(SRC, "lib/base.css")));
    const controls = base.filter(([sel]) => /\bbutton\b/.test(sel) && /\binput\b/.test(sel));
    expect(controls.some(([, b]) => /color\s*:\s*var\(--ink\)/.test(b))).toBe(true);
    expect(controls.some(([, b]) => /(^|;|\s)color\s*:\s*inherit/.test(b))).toBe(false);
  });
});

describe("a chip is red by its ladder level, never its severity", () => {
  const item = (over: Partial<AttentionItem>): AttentionItem => ({
    key: "x:rec1",
    kind: "vuln",
    siteName: "Acme",
    title: "t",
    url: "u",
    severity: "critical",
    metric: 1,
    ...over,
  });

  it("a critical Attention item, stuck or not, is not red", () => {
    expect(chipClass(item({ level: "attention" }))).toBe("chip");
    expect(chipClass(item({ level: "attention", autoFixExhausted: true }))).toBe("chip stuck");
  });

  it("a Broken item is red whatever its severity", () => {
    expect(chipClass(item({ kind: "deploy", severity: "warning", level: "broken" }))).toBe(
      "chip broken",
    );
    // A hand-built item with no level set takes the ladder's: deploy is Broken.
    expect(chipClass(item({ kind: "deploy", severity: "warning" }))).toBe("chip broken");
  });
});
