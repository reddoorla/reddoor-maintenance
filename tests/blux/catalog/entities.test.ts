import { describe, it, expect } from "vitest";
import {
  buildEntityEmit,
  normalizeDate,
} from "../../../src/blux/catalog/entities.js";

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
    // Spec §8: link is EXTERNAL-only — a bare slug ('steel-chair') is a
    // detail-page slug, NOT a link. The raw url still rides as an extension
    // field (Phase 7 detail pages).
    expect(chair!.data.link).toBeUndefined();
    expect(chair!.data.url).toBe("steel-chair");
    // link_url feeds the link field (external)
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
    // extensions typed by the observed value shape (url rides as Text)
    expect(main.url!.type).toBe("Text");
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

  it("(e) uid collisions dedupe enabled-over-disabled, never silently", () => {
    const dups = productDocs.filter((d) => d.uid === "dup-chair");
    expect(dups).toHaveLength(1);
    expect(dups[0]!.data.category).toBe("Case"); // the enabled record won
    const collisions = emit.diagnostics.filter((d) => d.kind === "uid-collision");
    expect(collisions).toHaveLength(1);
    expect(collisions[0]!.message).toContain("Dup Chair");
    expect(collisions[0]!.message).toContain("dup-chair");
  });

  it("collects every record media as kind:image for the plan-asset walk", () => {
    const ids = emit.media.map((m) => m.assetId);
    expect(ids).toContain("uuid-main");
    expect(ids).toContain("uuid-g1");
    expect(ids).toContain("uuid-g2");
    expect(emit.media.every((m) => m.kind === "image")).toBe(true);
  });
});

describe("buildEntityEmit — record uids (url-first slugging, real fleet urls)", () => {
  const emit = buildEntityEmit({
    f1: {
      name: "News",
      items: [
        // absolute url (strategyAdvantage Outside The Lines ×46) → title slug
        { title: "Big Announcement!", url: "https://mailchi.mp/abc/news-1" },
        // path url (/news/<slug> tosa ×49) → title slug, NOT news/<slug>
        { title: "Hello World", url: "/news/hello-world" },
        // bare slug → used verbatim
        { title: "Something Else", url: "plain-slug" },
        // /products/ prefix strips (productSlug semantics), rest is bare
        { title: "Prefixed", url: "/products/steel-chair/" },
      ],
    },
  });
  const uids = emit.documents.map((d) => d.uid);

  it("uses the url as uid ONLY when it is a bare slug", () => {
    expect(uids).toEqual([
      "big-announcement",
      "hello-world",
      "plain-slug",
      "steel-chair",
    ]);
  });

  it("keeps the raw url riding as an extension field for Phase 7", () => {
    expect(emit.documents[0]!.data.url).toBe("https://mailchi.mp/abc/news-1");
    expect(emit.documents[1]!.data.url).toBe("/news/hello-world");
    // external urls ALSO feed the link field; paths/bare slugs never do
    expect(emit.documents[0]!.data.link).toEqual({
      link_type: "Web",
      url: "https://mailchi.mp/abc/news-1",
    });
    expect(emit.documents[1]!.data.link).toBeUndefined();
  });
});

describe("normalizeDate", () => {
  it("passes already-valid ISO through verbatim", () => {
    expect(normalizeDate("2024-01-05", null)).toEqual({ date: "2024-01-05" });
    expect(normalizeDate("2017-03-23", "year-day-month")).toEqual({
      date: "2017-03-23",
    });
  });
  it("middle > 12 → year-DAY-month (the composition '2017-23-3' case)", () => {
    expect(normalizeDate("2017-23-3", null)).toEqual({ date: "2017-03-23" });
  });
  it("last > 12 → year-month-day", () => {
    expect(normalizeDate("2017-3-23", null)).toEqual({ date: "2017-03-23" });
  });
  it("both ≤ 12 resolves by the feed vote; no evidence → ymd + ambiguous", () => {
    expect(normalizeDate("2017-3-4", "year-day-month")).toEqual({
      date: "2017-04-03",
    });
    expect(normalizeDate("2017-3-4", "year-month-day")).toEqual({
      date: "2017-03-04",
    });
    expect(normalizeDate("2017-3-4", null)).toEqual({
      date: "2017-03-04",
      issue: "ambiguous",
    });
  });
  it("unparseable values are flagged", () => {
    expect(normalizeDate("March 5, 2017", null)).toEqual({ issue: "unparseable" });
    expect(normalizeDate("2017-13-13", null)).toEqual({ issue: "unparseable" });
    expect(normalizeDate("2017-0-5", null)).toEqual({ issue: "unparseable" });
    expect(normalizeDate(20170305, null)).toEqual({ issue: "unparseable" });
  });
});

describe("buildEntityEmit — date normalization rides the feed's majority vote", () => {
  it("resolves ambiguous dates by the feed's unambiguous majority, silently", () => {
    const emit = buildEntityEmit({
      f1: {
        name: "Products",
        items: [
          { title: "A", date: "2017-23-3" }, // year-DAY-month evidence
          { title: "B", date: "2018-20-5" }, // year-DAY-month evidence
          { title: "C", date: "2019-3-4" }, // ambiguous → resolved by vote
        ],
      },
    });
    const dates = emit.documents.map((d) => d.data.date);
    expect(dates).toEqual(["2017-03-23", "2018-05-20", "2019-04-03"]);
    expect(emit.diagnostics.filter((d) => d.kind === "ambiguous-date")).toEqual([]);
  });

  it("tie/no-evidence → year-month-day + an ambiguous-date diagnostic", () => {
    const emit = buildEntityEmit({
      f1: { name: "Products", items: [{ title: "X", date: "2019-2-3" }] },
    });
    expect(emit.documents[0]!.data.date).toBe("2019-02-03");
    const diags = emit.diagnostics.filter((d) => d.kind === "ambiguous-date");
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("2019-2-3");
  });

  it("unparseable dates are omitted with a diagnostic — never a bad Date value", () => {
    const emit = buildEntityEmit({
      f1: { name: "Products", items: [{ title: "X", date: "next Tuesday" }] },
    });
    expect(emit.documents[0]!.data).not.toHaveProperty("date");
    const diags = emit.diagnostics.filter((d) => d.kind === "malformed-feed-field");
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("next Tuesday");
  });
});

describe("buildEntityEmit — extension-field integrity", () => {
  const emit = buildEntityEmit({
    f1: {
      name: "News",
      items: [
        {
          title: "Post",
          // deriveFields convention: description (like body) is richtext
          description: "<h2>Teaser</h2><p>Body text.</p>",
          // array extensions match their Group{value:Text} model
          sizes: ["S", "M", 3],
          // record keys shadowing base fields must NOT clobber them
          uid: "sneaky-uid",
          gallery: "not-a-gallery",
          link: "not-a-link",
        },
      ],
    },
  });
  const doc = emit.documents[0]!;
  const main = (
    emit.customTypes[0]!.json as { json: { Main: Record<string, { type: string }> } }
  ).json.Main;

  it("description emits as demoted richtext and models StructuredText", () => {
    expect(doc.data.description).toEqual({
      __richtext_html: "<p>Teaser</p><p>Body text.</p>",
    });
    expect(main.description!.type).toBe("StructuredText");
  });

  it("array extensions emit Group-shaped items matching the model", () => {
    expect(doc.data.sizes).toEqual([{ value: "S" }, { value: "M" }, { value: "3" }]);
    expect(main.sizes!.type).toBe("Group");
  });

  it("uid/gallery/link record keys cannot shadow base fields", () => {
    expect(doc.uid).toBe("post");
    expect(doc.data.uid).toBeUndefined();
    expect(doc.data.gallery).toBeUndefined();
    expect(doc.data.link).toBeUndefined();
    for (const key of ["uid", "gallery", "link"] as const)
      expect(main[key]!.type).not.toBe("Text");
  });
});
