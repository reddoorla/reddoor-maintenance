import { describe, it, expect } from "vitest";
import { emitThemeCss, emitRolesCss } from "../../../src/blux/emit/theme.js";
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
  });
  it("falls back to sans-serif when a font is blank", () => {
    const c = emitThemeCss({
      colors: [],
      fonts: { heading: "", body: "" },
      fontLoad: [],
      textStyles: [],
    });
    expect(c).toContain("--font-heading: sans-serif;");
    expect(c).not.toContain("Fonts to load");
  });
});

describe("emitRolesCss", () => {
  const theme: ThemeIR = {
    colors: [],
    fonts: { heading: "Martel", body: "Montserrat" },
    fontLoad: [],
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
    expect(css).toContain("font-family: var(--text-text5--font-family, var(--font-heading));");
  });

  it("defaults letter-spacing/text-transform so a role that omits them is inert", () => {
    // text11 defines neither; the var falls back to the CSS initial value
    expect(css).toContain("letter-spacing: var(--text-text11--letter-spacing, normal);");
    expect(css).toContain("text-transform: var(--text-text11--text-transform, none);");
  });

  it("zeroes the wrapped element's margin so role type sits flush", () => {
    expect(css).toContain("  margin: 0;");
  });

  it("is empty when the theme carries no text styles", () => {
    expect(
      emitRolesCss({
        colors: [],
        fonts: { heading: "", body: "" },
        fontLoad: [],
        textStyles: [],
      }),
    ).toBe("");
  });
});
