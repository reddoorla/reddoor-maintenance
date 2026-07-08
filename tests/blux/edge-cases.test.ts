import { describe, it, expect } from "vitest";
import { archetype } from "../../src/blux/archetype.js";
import { parseBluxSite } from "../../src/blux/parse.js";
import { normalizePages } from "../../src/blux/normalize.js";
import { modelCollections } from "../../src/blux/collections.js";
import { normalizeCdnUrl } from "../../src/blux/assets.js";
import { assembleIR } from "../../src/blux/assemble.js";

describe("archetype — lower-confidence branches", () => {
  it("maps media-only to media_text at reduced confidence", () => {
    const r = archetype({ media: { media: "m" } });
    expect(r.sliceType).toBe("media_text");
    expect(r.confidence).toBeCloseTo(0.6);
  });
  it("maps text-only to rich_text at reduced confidence", () => {
    const r = archetype({ body: "<p>only body</p>" });
    expect(r.sliceType).toBe("rich_text");
    expect(r.confidence).toBeCloseTo(0.6);
  });
  it("maps a non-grid/non-slides container to grid at reduced confidence", () => {
    const r = archetype({ class: "columns", items: [{ title: "a" }] });
    expect(r.sliceType).toBe("grid");
    expect(r.confidence).toBeCloseTo(0.7);
  });
});

describe("normalizePages — low-confidence diagnostic", () => {
  it("raises a diagnostic for an empty block", () => {
    const raw = parseBluxSite({
      name: "P",
      id: "s",
      content: { pages: [{ title: "Home", items: [{}] }] },
    });
    const { diagnostics } = normalizePages(raw);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.kind).toBe("low-confidence-block");
    expect(diagnostics[0]!.where).toBe("home");
  });
});

describe("modelCollections — field-type inference + no publish route", () => {
  const raw = parseBluxSite({
    name: "x",
    id: "s",
    feeds: {
      f: {
        name: "Events",
        items: [
          {
            title: "T",
            date: "2020-01-01",
            featured: true,
            count: 3,
            url_more: "https://x",
            tags: ["a", "b"],
          },
        ],
      },
    },
  });
  const c = modelCollections(raw)[0]!;
  it("has a null publishRoute when the feed has no publish", () => {
    expect(c.publishRoute).toBeNull();
  });
  it("infers date/boolean/number/link/group field types", () => {
    const byKey = Object.fromEntries(c.fields.map((f) => [f.key, f.type]));
    expect(byKey.date).toBe("date");
    expect(byKey.featured).toBe("boolean");
    expect(byKey.count).toBe("number");
    expect(byKey.url_more).toBe("link");
    expect(byKey.tags).toBe("group");
  });
  it("falls back to item-0 uid when title is absent", () => {
    const raw2 = parseBluxSite({
      name: "x",
      id: "s",
      feeds: { f: { name: "X", items: [{ body: "<p>b</p>" }] } },
    });
    expect(modelCollections(raw2)[0]!.records[0]!.uid).toBe("item-0");
  });
});

describe("normalizeCdnUrl — video host + malformed", () => {
  it("normalizes the video CDN host", () => {
    expect(normalizeCdnUrl("https://dv4tl7yyk1zlp.cloudfront.net/site-1/w:400/vid.mp4")).toBe(
      "https://dv4tl7yyk1zlp.cloudfront.net/site-1/vid.mp4",
    );
  });
  it("returns null when the path has too few segments", () => {
    expect(normalizeCdnUrl("https://d3syaxnfm3oj0e.cloudfront.net/only")).toBeNull();
  });
  it("returns null for an unparseable url", () => {
    expect(normalizeCdnUrl("not a url")).toBeNull();
  });
});

describe("assembleIR — unresolved asset diagnostic", () => {
  it("flags a media entry that no HTML references", () => {
    const ir = assembleIR({
      siteJson: { name: "x", id: "s", media: { "img-x": { name: "X.jpg", type: "image/jpeg" } } },
      htmls: [],
    });
    const asset = ir.assets.find((a) => a.id === "img-x")!;
    expect(asset.sourceUrl).toBeNull();
    expect(ir.diagnostics.some((d) => d.kind === "unresolved-asset" && d.where === "img-x")).toBe(
      true,
    );
  });
});
