import { describe, it, expect } from "vitest";
import { emitThemeCss } from "../../../src/blux/emit/theme.js";

describe("emitThemeCss", () => {
  const css = emitThemeCss({
    colors: [
      { role: "c1", value: "#111111" },
      { role: "c2", value: "#ffffff" },
    ],
    fonts: { heading: "Inter", body: "Georgia" },
    textStyles: [{ role: "t1", size: "16px", weight: 400, lineHeight: 1.5 }],
  });
  it("emits a Tailwind v4 @theme block with color + font vars", () => {
    expect(css).toContain("@theme {");
    expect(css).toContain("--color-c1: #111111;");
    expect(css).toContain("--font-heading: Inter;");
    expect(css).toContain("--font-body: Georgia;");
    expect(css).toContain("--text-t1: 16px;");
  });
  it("falls back to sans-serif when a font is blank", () => {
    const c = emitThemeCss({ colors: [], fonts: { heading: "", body: "" }, textStyles: [] });
    expect(c).toContain("--font-heading: sans-serif;");
  });
});
