import { describe, it, expect } from "vitest";
import { archetype } from "../../src/blux/archetype.js";

describe("archetype", () => {
  it("maps bg-media + copy to hero", () => {
    const r = archetype({
      title: "x",
      _title: { color: "#fff" },
      body: "<p>y</p>",
      backgroundMedia: { media: "m" },
    });
    expect(r.sliceType).toBe("hero");
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });
  it("maps a bare background banner (all text disabled) to hero", () => {
    const r = archetype({
      title: "Hero Video",
      _title: { class: "disable" },
      backgroundMedia: { media: "m" },
    });
    expect(r.sliceType).toBe("hero");
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
  });
  it("maps heading+text+media to media_text", () => {
    expect(archetype({ title: "x", body: "<p>y</p>", media: { media: "m" } }).sliceType).toBe(
      "media_text",
    );
  });
  it("maps heading+media without body to media_text (image is kept)", () => {
    const r = archetype({ title: "x", _title: { color: "#000" }, media: { media: "m" } });
    expect(r.sliceType).toBe("media_text");
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
  });
  it("maps heading+text to rich_text", () => {
    expect(archetype({ title: "x", body: "<p>y</p>" }).sliceType).toBe("rich_text");
  });
  it("does not count disabled text as content", () => {
    const r = archetype({
      title: "x",
      _title: { class: "disable" },
      body: "y",
      _body: "disable",
    });
    expect(r.confidence).toBeLessThan(0.5);
  });
  it("maps a grid container to grid", () => {
    expect(archetype({ class: "grid", items: [{ title: "a" }] }).sliceType).toBe("grid");
  });
  it("maps a slides container to slider", () => {
    expect(archetype({ class: "slides", items: [{ title: "a" }] }).sliceType).toBe("slider");
  });
  it("keeps a slides container a slider even with a background image", () => {
    const r = archetype({
      class: "slides",
      backgroundMedia: { media: "m" },
      items: [{ title: "a" }],
    });
    expect(r.sliceType).toBe("slider");
  });
  it("flags an empty/unknown block as low confidence", () => {
    expect(archetype({}).confidence).toBeLessThan(0.5);
  });
});
