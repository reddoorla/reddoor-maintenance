import { describe, it, expect } from "vitest";
import { parseBluxSite } from "../../src/blux/parse.js";
import { normalizePages, normalizeTheme } from "../../src/blux/normalize.js";
import { minimalSite } from "./fixtures/minimal-site.js";

describe("normalizePages", () => {
  const raw = parseBluxSite(minimalSite);
  it("produces one page with hero, media_text, rich_text, grid sections", () => {
    const { pages } = normalizePages(raw);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.sections.map((s) => s.sliceType)).toEqual([
      "hero",
      "media_text",
      "rich_text",
      "grid",
    ]);
  });
  it("nests grid children as SectionIR", () => {
    const { pages } = normalizePages(raw);
    const grid = pages[0]!.sections.find((s) => s.sliceType === "grid")!;
    expect(grid.children).toHaveLength(2);
    expect(grid.children![0]!.fields.media).toBe("img-2");
  });
  it("carries media ids and raises no low-confidence diagnostics for the fixture", () => {
    const { pages, diagnostics } = normalizePages(raw);
    expect(pages[0]!.sections[0]!.fields.backgroundMedia).toBe("img-1");
    expect(diagnostics).toHaveLength(0);
  });
});

// Blux stores display text in `title`/`body`; `_title`/`_body` are per-element
// style config where `class: "disable"` (or the bare string "disable") hides
// the element on the rendered site. Verified against thePointe: the 32
// non-disabled titles are exactly the text visible on www.thepointeburbank.com.
describe("visible text extraction (_title/_body are style config, not text)", () => {
  const rawFor = (block: Record<string, unknown>) =>
    parseBluxSite({
      ...minimalSite,
      content: { pages: [{ title: "Home", description: "", items: [block] }] },
    });

  it("takes heading text from `title`, never stringifying the `_title` style object", () => {
    const { pages } = normalizePages(
      rawFor({ title: "STAND ABOVE <br>THE REST", _title: { color: "#ffffff" }, body: "b" }),
    );
    expect(pages[0]!.sections[0]!.fields.heading).toBe("STAND ABOVE <br>THE REST");
  });

  it("omits a title whose style config is class=disable", () => {
    const { pages } = normalizePages(
      rawFor({ title: "Hero Video", _title: { class: "disable" }, body: "b", _body: {} }),
    );
    const fields = pages[0]!.sections[0]!.fields;
    expect(fields.heading).toBeUndefined();
    expect(fields.body).toBe("b");
  });

  it("omits a body whose style config is the bare string 'disable'", () => {
    const { pages } = normalizePages(rawFor({ title: "t", body: "hidden", _body: "disable" }));
    const fields = pages[0]!.sections[0]!.fields;
    expect(fields.heading).toBe("t");
    expect(fields.body).toBeUndefined();
  });

  it("omits whitespace-only text", () => {
    const { pages } = normalizePages(rawFor({ title: "  \n", _title: {}, body: "b" }));
    expect(pages[0]!.sections[0]!.fields.heading).toBeUndefined();
  });

  it("treats any class list containing 'disable' as hidden", () => {
    const { pages } = normalizePages(
      rawFor({ title: "hidden", _title: { class: "disable fade-up" }, body: "b" }),
    );
    expect(pages[0]!.sections[0]!.fields.heading).toBeUndefined();
  });

  it("trims surrounding whitespace from migrated text", () => {
    const { pages } = normalizePages(rawFor({ title: "\n  Welcome  ", _title: {}, body: "b" }));
    expect(pages[0]!.sections[0]!.fields.heading).toBe("Welcome");
  });

  it("coerces a numeric title to text instead of dropping it", () => {
    const { pages } = normalizePages(rawFor({ title: 2024, _title: {}, body: "b" }));
    expect(pages[0]!.sections[0]!.fields.heading).toBe("2024");
  });
});

// styles.text entries are { _label, ".textN": { css props incl "font-ident" } } —
// the values live one level down, keyed by the role's own selector.
describe("normalizeTheme", () => {
  const theme = normalizeTheme(parseBluxSite(minimalSite));
  it("maps the palette + font pair (explicit settings win)", () => {
    expect(theme.colors).toHaveLength(3);
    expect(theme.fonts).toEqual({ heading: "Inter", body: "Inter" });
  });
  it("parses the nested .textN shape into named roles, stripping font quotes", () => {
    const t5 = theme.textStyles.find((t) => t.role === "text5")!;
    expect(t5).toEqual({
      role: "text5",
      label: "Grid Titles",
      fontFamily: "Montserrat",
      size: "15px",
      weight: 500,
      lineHeight: "26px",
      transform: "uppercase",
      letterSpacing: "1.5px",
    });
    const t0 = theme.textStyles.find((t) => t.role === "text0")!;
    expect(t0.fontFamily).toBe("Scope One");
    expect(t0.transform).toBe("capitalize");
    expect(t0.letterSpacing).toBeUndefined();
  });
  it("names roles from the .textN key and skips deleted-style tombstones", () => {
    // fixture index 4 is a { removed: true } tombstone — no phantom text4 role
    expect(theme.textStyles.map((t) => t.role)).toEqual(["text0", "text1", "text5", "text11"]);
    expect(theme.textStyles.find((t) => t.role === "text4")).toBeUndefined();
  });
  it("drops malformed CSS values but keeps a role's real ones + mobile overrides", () => {
    const t11 = theme.textStyles.find((t) => t.role === "text11")!;
    expect(t11).toEqual({
      role: "text11",
      label: "Page Title Serif",
      fontFamily: "Martel",
      size: "50px",
      weight: 200,
      lineHeight: "80px",
      transform: "capitalize",
      mobileSize: "40px",
      mobileLineHeight: "60px",
    });
    // "0.px" is malformed and must not reach the theme
    expect(t11.letterSpacing).toBeUndefined();
  });
  it("parses settings.fonts.google into families + numeric weights", () => {
    expect(theme.fontLoad).toEqual([
      { family: "Scope One", weights: ["400"] },
      { family: "Montserrat", weights: ["300", "500", "400"] },
      { family: "Martel", weights: ["200"] },
    ]);
  });
  it("falls back to Blux's default roles (text0/text1) when settings name no fonts", () => {
    const site = structuredClone(minimalSite) as Record<string, unknown>;
    site.settings = { widgets: {} };
    const t = normalizeTheme(parseBluxSite(site));
    expect(t.fonts).toEqual({ heading: "Scope One", body: "Montserrat" });
    expect(t.fontLoad).toEqual([]);
  });
  it("ignores a non-string font setting instead of stringifying it", () => {
    const site = structuredClone(minimalSite) as {
      settings: { fonts: Record<string, unknown> };
    };
    site.settings.fonts = { heading: { nested: true } };
    const t = normalizeTheme(parseBluxSite(site));
    expect(t.fonts.heading).toBe("Scope One"); // not "[object Object]"
  });
});

// Presentation hints: the text role a block's _title/_body class points at,
// plus the block's own string-valued styles. Never migrated into Prismic —
// they surface through the plan's styles manifest for the design pass.
describe("section presentation extraction", () => {
  const rawFor = (block: Record<string, unknown>) =>
    parseBluxSite({
      ...minimalSite,
      content: { pages: [{ title: "Home", description: "", items: [block] }] },
    });
  const first = (block: Record<string, unknown>) =>
    normalizePages(rawFor(block)).pages[0]!.sections[0]!;

  it("captures heading/body roles from the first textN class token", () => {
    const s = first({
      title: "amenities",
      _title: { class: "text5 fade-up" },
      body: "<p>b</p>",
      _body: { class: "text14" },
    });
    expect(s.presentation).toEqual({ headingRole: "text5", bodyRole: "text14" });
  });
  it("captures string-valued block styles, dropping blanks and bare units", () => {
    const s = first({
      title: "t",
      body: "b",
      styles: {
        "background-color": "#edeff4",
        "text-align": "center",
        _contentPadding: "",
        height: "px",
        ratio: 2,
      },
    });
    expect(s.presentation!.block).toEqual({
      "background-color": "#edeff4",
      "text-align": "center",
    });
  });
  it("assigns no role to hidden text, even when its class also names one", () => {
    const s = first({ title: "hidden", _title: { class: "disable text5" }, body: "b" });
    expect(s.fields.heading).toBeUndefined();
    expect(s.presentation?.headingRole).toBeUndefined();
  });
  it("captures a title's inline overrides (a hero's white color) alongside its role", () => {
    const s = first({
      title: "STAND ABOVE",
      _title: { class: "text0", color: "#ffffff", "font-size": "44px", padding: "px" },
      body: "b",
    });
    expect(s.presentation).toEqual({
      headingRole: "text0",
      headingStyle: { color: "#ffffff", "font-size": "44px" }, // padding "px" dropped
    });
  });
  it("captures inline overrides on a classless title as headingStyle", () => {
    const s = first({ title: "Welcome", _title: { color: "#053a6c", margin: "0" }, body: "b" });
    expect(s.presentation).toEqual({ headingStyle: { color: "#053a6c", margin: "0" } });
  });
  it("drops inline overrides when the text itself is hidden", () => {
    const s = first({ title: "x", _title: { class: "disable", color: "#fff" }, body: "b" });
    expect(s.presentation?.headingStyle).toBeUndefined();
  });
  it("omits presentation entirely when a block carries no hints", () => {
    const s = first({ title: "t", _title: {}, body: "b", styles: {} });
    expect(s.presentation).toBeUndefined();
  });
});
