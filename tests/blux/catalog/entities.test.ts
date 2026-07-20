import { describe, it, expect } from "vitest";
import { buildEntityEmit } from "../../../src/blux/catalog/entities.js";

// Composition-shaped fixture: a Products feed with extension keys
// (category/sub_category/dimensions/disabled), a base-only Reps feed, and a
// DO-NOT-USE feed that must be skipped with a diagnostic.
const feeds = {
  f1: {
    name: "Products",
    items: [
      {
        // url slug beats the title slug (productSlug semantics)
        title: "Steel Chair Deluxe",
        url: "steel-chair",
        body: "<h2>Strong</h2><p>Very strong.</p>",
        category: "Metal",
        sub_category: "Chairs",
        dimensions: '20"W x 18"D',
        tags: ["metal", "chair"],
        date: "2024-01-05",
        media: { media: "uuid-main" },
        items: [
          { media: { media: "uuid-g1" }, caption: "Side view" },
          { media: { media: "uuid-g2" } },
        ],
        // underscore keys are per-element style config — never content
        _title: { class: "text5" },
      },
      // uid collision pair: the disabled record comes first, the enabled one
      // must win the slug anyway
      { title: "Dup Chair", disabled: true, category: "Metal" },
      { title: "Dup Chair", disabled: false, category: "Case" },
      { title: "Linked", link_url: "https://example.com/x" },
    ],
  },
  f2: {
    name: "Reps",
    items: [{ title: "Jane Doe", body: "<p>Bio.</p>", tags: ["west"] }],
  },
  f3: { name: "DO NOT USE — legacy", items: [{ title: "X" }] },
  f4: undefined,
};

describe("buildEntityEmit", () => {
  const emit = buildEntityEmit(feeds);
  const productDocs = emit.documents.filter((d) => d.type === "product");
  const chair = productDocs.find((d) => d.uid === "steel-chair");

  it("(a) maps base fields onto the mapped entity type", () => {
    expect(chair).toBeDefined();
    expect(chair!.data.title).toEqual({
      __richtext_html: "<h1>Steel Chair Deluxe</h1>",
    });
    // body headings demote (the base type's body allows no heading blocks)
    expect(chair!.data.body).toEqual({
      __richtext_html: "<p>Strong</p><p>Very strong.</p>",
    });
    expect(chair!.data.media).toEqual({ __asset_id: "uuid-main" });
    expect(chair!.data.gallery).toEqual([
      { image: { __asset_id: "uuid-g1" }, caption: "Side view" },
      { image: { __asset_id: "uuid-g2" }, caption: "" },
    ]);
    expect(chair!.data.tags).toBe("metal,chair");
    expect(chair!.data.date).toBe("2024-01-05");
    expect(chair!.data.link).toEqual({ link_type: "Web", url: "steel-chair" });
    // link_url also feeds the link field
    const linked = productDocs.find((d) => d.uid === "linked");
    expect(linked!.data.link).toEqual({
      link_type: "Web",
      url: "https://example.com/x",
    });
    // Reps → person, base-only
    const jane = emit.documents.find((d) => d.type === "person");
    expect(jane).toMatchObject({ uid: "jane-doe" });
    expect(jane!.data.tags).toBe("west");
  });

  it("(b) extension keys land verbatim in data; style keys never leak", () => {
    expect(chair!.data.category).toBe("Metal");
    expect(chair!.data.sub_category).toBe("Chairs");
    expect(chair!.data.dimensions).toBe('20"W x 18"D');
    expect(chair!.data).not.toHaveProperty("_title");
    const dup = productDocs.find((d) => d.uid === "dup-chair");
    expect(dup!.data.disabled).toBe(false);
  });

  it("(c) each used entity type yields a base+extension custom type", () => {
    const ids = emit.customTypes.map((c) => c.id);
    expect(ids).toContain("product");
    expect(ids).toContain("person");
    const product = emit.customTypes.find((c) => c.id === "product")!;
    expect(product.repeatable).toBe(true);
    const main = (
      product.json as { json: { Main: Record<string, { type: string }> } }
    ).json.Main;
    // frozen Plan-2 base fields
    for (const key of ["uid", "title", "body", "media", "gallery", "tags", "date", "link"])
      expect(main).toHaveProperty(key);
    expect(main.title!.type).toBe("StructuredText");
    // extensions typed by the observed value shape
    expect(main.category!.type).toBe("Text");
    expect(main.sub_category!.type).toBe("Text");
    expect(main.dimensions!.type).toBe("Text");
    expect(main.disabled!.type).toBe("Boolean");
    // person carries NO product extensions
    const person = emit.customTypes.find((c) => c.id === "person")!;
    const personMain = (
      person.json as { json: { Main: Record<string, unknown> } }
    ).json.Main;
    expect(personMain).not.toHaveProperty("category");
  });

  it("(d) DO-NOT-USE feeds emit no documents, one skipped-feed diagnostic", () => {
    expect(emit.documents.some((d) => d.uid === "x")).toBe(false);
    const skips = emit.diagnostics.filter((d) => d.kind === "skipped-feed");
    expect(skips).toHaveLength(1);
    expect(skips[0]!.where).toBe("f3");
  });

  it("(e) uid collisions dedupe enabled-over-disabled", () => {
    const dups = productDocs.filter((d) => d.uid === "dup-chair");
    expect(dups).toHaveLength(1);
    expect(dups[0]!.data.category).toBe("Case"); // the enabled record won
  });

  it("collects every record media as kind:image for the plan-asset walk", () => {
    const ids = emit.media.map((m) => m.assetId);
    expect(ids).toContain("uuid-main");
    expect(ids).toContain("uuid-g1");
    expect(ids).toContain("uuid-g2");
    expect(emit.media.every((m) => m.kind === "image")).toBe(true);
  });
});
