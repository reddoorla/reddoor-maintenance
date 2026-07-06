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

describe("normalizeTheme", () => {
  it("maps the palette + font pair", () => {
    const theme = normalizeTheme(parseBluxSite(minimalSite));
    expect(theme.colors).toHaveLength(3);
    expect(theme.fonts).toEqual({ heading: "Inter", body: "Inter" });
  });
});
