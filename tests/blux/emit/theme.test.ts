import { describe, it, expect } from "vitest";
import { emitThemeCss, emitRolesCss, emitButtonsCss } from "../../../src/blux/emit/theme.js";
import type { ThemeIR } from "../../../src/blux/ir.js";

describe("emitThemeCss", () => {
  const css = emitThemeCss({
    colors: [
      { role: "c1", value: "#111111" },
      { role: "c2", value: "#ffffff" },
    ],
    fonts: { heading: "Martel", body: "Montserrat" },
    fontLoad: [
      { family: "Martel", weights: ["200"] },
      { family: "Montserrat", weights: ["300", "500"] },
    ],
    textStyles: [
      {
        role: "text5",
        label: "Grid Titles",
        fontFamily: "Montserrat",
        size: "15px",
        weight: 500,
        lineHeight: "26px",
        transform: "uppercase",
        letterSpacing: "1.5px",
        margin: "10px 0",
      },
      {
        role: "text11",
        label: "Page Title Serif",
        fontFamily: "Martel",
        size: "50px",
        weight: 200,
        lineHeight: "80px",
        mobileSize: "40px",
        mobileLineHeight: "60px",
      },
      {
        role: "text1",
        label: "",
        fontFamily: "",
        size: "18px",
        weight: 300,
        lineHeight: "36px",
      },
    ],
    buttonStyles: [],
  });
  it("emits a Tailwind v4 @theme block with color + font vars", () => {
    expect(css).toContain("@theme {");
    expect(css).toContain("--color-c1: #111111;");
    expect(css).toContain("--font-heading: Martel;");
    expect(css).toContain("--font-body: Montserrat;");
  });
  it("leads with a fonts-to-load comment naming families + weights", () => {
    expect(css).toContain("/* Fonts to load — Martel 200; Montserrat 300,500 */");
    // the comment precedes the @theme block
    expect(css.indexOf("Fonts to load")).toBeLessThan(css.indexOf("@theme {"));
  });
  it("emits mobile responsive vars when a role carries them", () => {
    expect(css).toContain("--text-text11--mobile-font-size: 40px;");
    expect(css).toContain("--text-text11--mobile-line-height: 60px;");
    // a role without mobile overrides emits none
    expect(css).not.toContain("--text-text5--mobile-font-size:");
  });
  it("emits the full var set for a named text role, labeled", () => {
    expect(css).toContain("/* text5 — Grid Titles */");
    expect(css).toContain("--text-text5: 15px;");
    expect(css).toContain("--text-text5--line-height: 26px;");
    expect(css).toContain("--text-text5--font-weight: 500;");
    expect(css).toContain("--text-text5--font-family: Montserrat;");
    expect(css).toContain("--text-text5--text-transform: uppercase;");
    expect(css).toContain("--text-text5--letter-spacing: 1.5px;");
  });
  it("omits label comment and optional vars when a role lacks them", () => {
    expect(css).not.toContain("/* text1 —");
    expect(css).toContain("--text-text1: 18px;");
    expect(css).not.toContain("--text-text1--font-family:");
    expect(css).not.toContain("--text-text1--text-transform:");
    expect(css).not.toContain("--text-text1--letter-spacing:");
    expect(css).not.toContain("--text-text1--margin:");
  });

  it("emits the margin var for a role that declares its block rhythm", () => {
    expect(css).toContain("--text-text5--margin: 10px 0;");
    // roles without a margin emit no var (they fall back to 0 in the utility)
    expect(css).not.toContain("--text-text11--margin:");
  });
  it("falls back to sans-serif when a font is blank", () => {
    const c = emitThemeCss({
      colors: [],
      fonts: { heading: "", body: "" },
      fontLoad: [],
      textStyles: [],
      buttonStyles: [],
    });
    expect(c).toContain("--font-heading: sans-serif;");
    expect(c).not.toContain("Fonts to load");
  });
});

describe("emitButtonsCss", () => {
  const theme: ThemeIR = {
    colors: [],
    fonts: { heading: "", body: "" },
    fontLoad: [],
    textStyles: [],
    buttonStyles: [
      {
        role: "buttons2",
        label: "Blue Buttons",
        // Declaration order is load-bearing: border shorthand first, then the
        // side zero-overrides net a bottom-only rule.
        css: {
          padding: "6px 0 6px 0",
          "font-size": "18px",
          border: "1px solid #053a6c",
          "font-family": "'Montserrat'",
          "font-weight": "300",
          color: "#053a6c",
          "border-top": "0",
          "border-right": "0",
          "border-left": "0",
        },
        hover: { "background-color": "transparent" },
      },
    ],
  };
  const css = emitButtonsCss(theme);

  it("emits the .ib inline-block base plus one rule per skin, labeled", () => {
    expect(css).toContain(".ib {\n  display: inline-block;\n}");
    expect(css).toContain("/* buttons2 — Blue Buttons */");
    expect(css).toContain(".buttons2 {");
  });

  it("preserves the export's declaration order (border shorthand before side overrides)", () => {
    const rule = css.slice(css.indexOf(".buttons2 {"));
    expect(rule.indexOf("border: 1px solid #053a6c;")).toBeGreaterThan(-1);
    expect(rule.indexOf("border: 1px solid #053a6c;")).toBeLessThan(rule.indexOf("border-top: 0;"));
  });

  it("emits :hover variants when declared", () => {
    expect(css).toContain(".buttons2:hover {\n  background-color: transparent;\n}");
  });

  it("is empty when the theme declares no button styles", () => {
    expect(
      emitButtonsCss({
        colors: [],
        fonts: { heading: "", body: "" },
        fontLoad: [],
        textStyles: [],
        buttonStyles: [],
      }),
    ).toBe("");
  });
});

describe("emitRolesCss", () => {
  const theme: ThemeIR = {
    colors: [],
    fonts: { heading: "Martel", body: "Montserrat" },
    fontLoad: [],
    buttonStyles: [],
    textStyles: [
      {
        role: "text5",
        label: "Grid Titles",
        fontFamily: "Montserrat",
        size: "15px",
        weight: 500,
        lineHeight: "26px",
        transform: "uppercase",
        letterSpacing: "1.5px",
      },
      {
        role: "text11",
        label: "Page Title Serif",
        fontFamily: "Martel",
        size: "50px",
        weight: 200,
        lineHeight: "80px",
      },
      {
        role: "text1",
        label: "Body (Default)",
        fontFamily: "",
        size: "18px",
        weight: 300,
        lineHeight: "36px",
      },
    ],
  };
  const css = emitRolesCss(theme);

  it("emits one .txt-role-textN utility per text style, scoped to headings/paragraphs", () => {
    expect(css).toContain(".txt-role-text5 :is(h1, h2, h3, h4, h5, h6, p) {");
    expect(css).toContain(".txt-role-text11 :is(h1, h2, h3, h4, h5, h6, p) {");
  });

  it("maps each role's @theme vars onto font/size/weight/line-height/spacing/transform", () => {
    expect(css).toContain("font-size: var(--text-text5);");
    expect(css).toContain("font-weight: var(--text-text5--font-weight);");
    expect(css).toContain("line-height: var(--text-text5--line-height);");
    expect(css).toContain("font-family: var(--text-text5--font-family);");
  });

  it("sets font-family only for a role that declares one, so a family-less body role keeps the natural cascade", () => {
    // text1 declares no family — the utility must NOT force one (a fallback to
    // the heading font would render body paragraphs in the serif display face).
    // The trailing space disambiguates .txt-role-text1 from .txt-role-text11.
    const from = css.indexOf(".txt-role-text1 ");
    const rule = css.slice(from, from + css.slice(from).indexOf("}"));
    expect(rule).not.toContain("font-family");
    // it still sets the role's size/weight
    expect(rule).toContain("font-size: var(--text-text1);");
  });

  it("defaults letter-spacing/text-transform so a role that omits them is inert", () => {
    // text11 defines neither; the var falls back to the CSS initial value
    expect(css).toContain("letter-spacing: var(--text-text11--letter-spacing, normal);");
    expect(css).toContain("text-transform: var(--text-text11--text-transform, none);");
  });

  it("applies the role's own margin, falling back to 0 — Blux's stack rhythm", () => {
    // The text style's block margin (e.g. Grid Titles' 10px 0) IS the vertical
    // rhythm between stacked blocks; a role without one sits flush.
    expect(css).toContain("margin: var(--text-text5--margin, 0);");
    expect(css).toContain("margin: var(--text-text11--margin, 0);");
    expect(css).not.toContain("  margin: 0;");
  });

  it("is empty when the theme carries no text styles", () => {
    expect(
      emitRolesCss({
        colors: [],
        fonts: { heading: "", body: "" },
        fontLoad: [],
        textStyles: [],
        buttonStyles: [],
      }),
    ).toBe("");
  });
});
