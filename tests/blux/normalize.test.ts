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

describe("normalizeTheme", () => {
  it("maps the palette + font pair", () => {
    const theme = normalizeTheme(parseBluxSite(minimalSite));
    expect(theme.colors).toHaveLength(3);
    expect(theme.fonts).toEqual({ heading: "Inter", body: "Inter" });
  });
});
