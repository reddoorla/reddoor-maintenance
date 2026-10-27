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
import { buildSiteView } from "../../src/lib/site/view.js";
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

/** A colour written as a value: hex, or an rgb/hsl function. */
const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;

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

  it("no component writes a colour inline", () => {
    const hits = filesUnder(SRC, ".svelte").flatMap((p) =>
      read(p)
        .split("\n")
        .flatMap((line, i) =>
          /style="[^"]*(#[0-9a-fA-F]{3,8}\b|rgba?\()/.test(line) ? [`${rel(p)}:${i + 1}`] : [],
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
  const at = css.indexOf(selector);
  if (at < 0) return "";
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
  const BROKEN_SELECTOR = /broken/;

  it("every rule that paints red is a Broken marker", () => {
    const offenders = PAGE_SHEETS.flatMap((p) =>
      rules(read(p))
        .filter(([, body]) => /var\(--broken(-fill)?\)/.test(body))
        .filter(([sel]) => !BROKEN_SELECTOR.test(sel))
        .map(([sel]) => `${rel(p)}: ${sel}`),
    );
    expect(offenders).toEqual([]);
  });

  // Review round 1: on a red fill, text at 0.85 opacity measured 4.04:1, and a
  // descendant rule's ink (.badge, .stuck) or grey (.rf-sub) beat the inherited
  // white. What sits on red is --on-broken, at full strength.
  it("nothing on a red fill is dimmed", () => {
    const dimmed = PAGE_SHEETS.flatMap((p) =>
      rules(read(p))
        .filter(([sel, body]) => /broken/.test(sel) && /opacity\s*:/.test(body))
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
const GLYPH = /\p{Extended_Pictographic}|[✓✗↻▸↗▲▼☐]|️/u;

function glyphs(lines: string[]): string[] {
  return lines.filter((l) => GLYPH.test(l));
}

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
        documentElement: { setAttribute: (_: string, v: string) => (theme = v) },
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

describe("type", () => {
  const html = read(join(SRC, "app.html"));
  it("loads Pragmatica from the Adobe kit and Besley from Google Fonts", () => {
    expect(html).toContain("https://use.typekit.net/noj4tji.css");
    expect(html).toMatch(/fonts\.googleapis\.com\/css2\?family=Besley/);
  });
  it("sets Pragmatica as the body family, with tabular numerals", () => {
    const base = stripComments(read(join(SRC, "lib/base.css")));
    const body = blockAfter(base, "body {");
    expect(body).toMatch(/font-family:\s*var\(--font-sans\)/);
    expect(body).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(stripComments(read(TOKENS))).toMatch(/--font-sans:\s*pragmatica/);
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
