import { describe, it, expect } from "vitest";
import { parseBluxSite } from "../../src/blux/parse.js";
import { modelCollections } from "../../src/blux/collections.js";
import { minimalSite } from "./fixtures/minimal-site.js";

describe("modelCollections", () => {
  const collections = modelCollections(parseBluxSite(minimalSite));
  it("turns the Team feed into a repeatable custom type", () => {
    expect(collections).toHaveLength(1);
    const c = collections[0]!;
    expect(c.apiId).toBe("team");
    expect(c.label).toBe("Team");
    expect(c.publishRoute).toBe("team");
  });
  it("derives a typed schema from declared fields + item keys", () => {
    const keys = collections[0]!.fields.map((f) => `${f.key}:${f.type}`);
    expect(keys).toContain("title:text");
    expect(keys).toContain("role:text");
    expect(keys).toContain("body:richtext");
    expect(keys).toContain("media:image");
  });
  it("emits one record per item with media refs", () => {
    const c = collections[0]!;
    expect(c.records).toHaveLength(2);
    expect(c.records[0]!.values.title).toBe("Jane Doe");
    expect(c.records[0]!.mediaRefs).toEqual(["img-2"]);
    expect(c.records[1]!.mediaRefs).toEqual([]);
  });
});
