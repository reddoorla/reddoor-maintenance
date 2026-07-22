import { describe, it, expect } from "vitest";
import type { BluxCollectionSpec } from "../../../src/blux/catalog/index.js";
import { buildCatalogPlan, catalogSpecToPlanSlice } from "../../../src/blux/catalog/index.js";

describe("catalogSpecToPlanSlice — BluxCollection", () => {
  it("emits the full snake_case query-spec primary", () => {
    const spec: BluxCollectionSpec = {
      slice: "BluxCollection",
      index: 4,
      backgroundColor: "#f4f4f4",
      heading: "<h2>Our Team</h2>",
      entityType: "person",
      feedIds: ["feed1", "feed2"],
      filterTag: "west&&coast",
      sort: "fdate",
      limit: 8,
      mediaRatio: "4:3",
      layout: "grid",
      scrollLoadMore: true,
    };
    const slice = catalogSpecToPlanSlice(spec);
    expect(slice.slice_type).toBe("blux_collection");
    expect(slice.variation).toBe("default");
    expect(slice.items).toEqual([]);
    expect(slice.primary).toEqual({
      background_color: "#f4f4f4",
      heading: { __richtext_html: "<h2>Our Team</h2>" },
      collection_type: "person",
      feed_ids: "feed1,feed2",
      filter_tag: "west&&coast",
      sort: "fdate",
      limit: 8,
      media_ratio: "4:3",
      layout: "grid",
      scroll_load_more: "on",
    });
  });

  it("omits absent optionals (lean primary)", () => {
    const slice = catalogSpecToPlanSlice({
      slice: "BluxCollection",
      index: 0,
      entityType: "product",
      feedIds: ["f1"],
      layout: "carousel",
    });
    expect(slice.primary).toEqual({
      collection_type: "product",
      feed_ids: "f1",
      layout: "carousel",
    });
  });

  it("carries decision-B widget fields (Collection is a container)", () => {
    const slice = catalogSpecToPlanSlice({
      slice: "BluxCollection",
      index: 1,
      entityType: "product",
      feedIds: ["f1"],
      layout: "grid",
      widgetKind: "map",
      widgetHtml: '<div id="m"><script>evil()</script>Legend</div>',
      mapConfig: { center: { lat: 1, lng: 2 } } as never,
    });
    expect(slice.primary.widget_kind).toBe("map");
    const html = slice.primary.widget_html as string;
    // sanitized + wrapped in the .blux-map mount exactly like BluxSection
    expect(html).toContain('class="blux-map"');
    expect(html).toContain("data-map-config=");
    expect(html).toContain("Legend");
    expect(html).not.toContain("<script>");
  });
});

describe("buildCatalogPlan — feeds ride the plan", () => {
  const pages = [
    {
      uid: "home",
      title: "Home",
      specs: [
        {
          slice: "BluxCollection",
          index: 0,
          entityType: "person",
          feedIds: ["feed-1"],
          layout: "grid",
        } as BluxCollectionSpec,
      ],
    },
  ];
  const ir = {
    assets: [
      {
        id: "img-2",
        url: "https://cdn/img-2.jpg",
        alt: "",
        sourceUrl: "https://cdn/img-2.jpg",
      },
    ],
    diagnostics: [],
  };
  const feeds = {
    "feed-1": {
      name: "Team",
      items: [{ title: "Jane Doe", media: { media: "img-2" } }],
    },
    "feed-2": { name: "DO NOT USE old", items: [{ title: "X" }] },
  };

  it("merges entity documents, custom types, diagnostics, and media", () => {
    const plan = buildCatalogPlan(pages, ir, feeds);
    // page doc + one person doc
    expect(plan.documents.map((d) => d.type)).toEqual(["page", "person"]);
    expect(plan.documents[1]).toMatchObject({ uid: "jane-doe" });
    expect(plan.customTypes.map((c) => c.id)).toEqual(["person"]);
    // the record's media joined the asset walk and resolved via the IR index
    expect(plan.assets).toEqual([{ id: "img-2", url: "https://cdn/img-2.jpg", alt: "" }]);
    expect(plan.diagnostics.some((d) => d.kind === "skipped-feed")).toBe(true);
  });

  it("without feeds the plan stays entity-free (back-compat)", () => {
    const plan = buildCatalogPlan(pages, ir);
    expect(plan.documents.map((d) => d.type)).toEqual(["page"]);
    expect(plan.customTypes).toEqual([]);
  });
});
