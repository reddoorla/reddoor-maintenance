import { describe, it, expect } from "vitest";
import { archetype } from "../../src/blux/archetype.js";

describe("archetype", () => {
  it("maps bg-media + copy to hero", () => {
    const r = archetype({
      _title: "<h1>x</h1>",
      _body: "<p>y</p>",
      backgroundMedia: { media: "m" },
    });
    expect(r.sliceType).toBe("hero");
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });
  it("maps heading+text+media to media_text", () => {
    expect(
      archetype({ _title: "<h2>x</h2>", _body: "<p>y</p>", media: { media: "m" } }).sliceType,
    ).toBe("media_text");
  });
  it("maps heading+text to rich_text", () => {
    expect(archetype({ _title: "<h2>x</h2>", _body: "<p>y</p>" }).sliceType).toBe("rich_text");
  });
  it("maps a grid container to grid", () => {
    expect(archetype({ class: "grid", items: [{ _title: "a" }] }).sliceType).toBe("grid");
  });
  it("maps a slides container to slider", () => {
    expect(archetype({ class: "slides", items: [{ _title: "a" }] }).sliceType).toBe("slider");
  });
  it("flags an empty/unknown block as low confidence", () => {
    expect(archetype({}).confidence).toBeLessThan(0.5);
  });
});
