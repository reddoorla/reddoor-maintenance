import { describe, it, expect } from "vitest";
import { emitThemeCss } from "../../../src/blux/emit/theme.js";

describe("emitThemeCss", () => {
  const css = emitThemeCss({
    colors: [
      { role: "c1", value: "#111111" },
      { role: "c2", value: "#ffffff" },
    ],
    fonts: { heading: "Martel", body: "Montserrat" },
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
    const c = emitThemeCss({ colors: [], fonts: { heading: "", body: "" }, textStyles: [] });
    expect(c).toContain("--font-heading: sans-serif;");
  });
});
