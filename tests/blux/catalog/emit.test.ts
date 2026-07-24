import { describe, it, expect } from "vitest";
import type { BluxSectionSpec } from "../../../src/blux/catalog/index.js";
import { catalogSpecToPlanSlice, buildCatalogPlan } from "../../../src/blux/catalog/index.js";

const spec: BluxSectionSpec = {
  slice: "BluxSection",
  index: 2,
  backgroundColor: "#f4f4f4",
  heading: "<h2>Amenities</h2>",
  cells: [
    { kind: "text", title: "<h3>Pool</h3>", bodyHtml: "<p>Heated</p>" },
    // Real `Media` requires a `kind` discriminant → `kind: "image"` added here.
    {
      kind: "media",
      media: { kind: "image", assetId: "u1", base: "https://cdn/", ext: "jpg" },
      mediaRatio: "4:3",
    },
  ],
};

describe("catalogSpecToPlanSlice", () => {
  it("emits a blux_section slice with the heading + cells as nested groups", () => {
    const slice = catalogSpecToPlanSlice(spec);
    expect(slice.slice_type).toBe("blux_section");
    expect(slice.variation).toBe("default");
    expect(slice.items).toEqual([]);
    expect(slice.primary.background_color).toBe("#f4f4f4");
    expect(slice.primary.heading).toEqual({ __richtext_html: "<h2>Amenities</h2>" });
    const cells = slice.primary.cells as Record<string, unknown>[];
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({
      kind: "text",
      title: { __richtext_html: "<h3>Pool</h3>" },
      body_html: "<p>Heated</p>",
    });
    expect(cells[1]).toMatchObject({
      kind: "media",
      media: { __asset_id: "u1" },
      media_ratio: "4:3",
    });
  });
});

describe("emit-boundary sanitizing", () => {
  it("sanitizes embed_html: scripts and on* handlers never reach the plan", () => {
    const s: BluxSectionSpec = {
      slice: "BluxSection",
      index: 0,
      cells: [
        {
          kind: "text",
          title: "<h3>Visit</h3>",
          embedHtml:
            '<a onclick="hack()" href="https://x.com">Visit Website</a><script>track()</script>',
        },
      ],
    };
    const cells = catalogSpecToPlanSlice(s).primary.cells as Record<string, unknown>[];
    const embed = cells[0]?.embed_html as string;
    expect(embed).toContain("Visit Website");
    expect(embed).not.toContain("onclick");
    expect(embed).not.toContain("<script");
  });

  it("sanitizes body_html but preserves the txt-role-* class the roled render needs", () => {
    const s: BluxSectionSpec = {
      slice: "BluxSection",
      index: 0,
      cells: [
        {
          kind: "text",
          bodyHtml:
            '<div class="txt-role-text2" onclick="steal()"><h3>The Pointe</h3></div><script>alert(1)</script>',
        },
      ],
    };
    const cells = catalogSpecToPlanSlice(s).primary.cells as Record<string, unknown>[];
    const body = cells[0]?.body_html as string;
    // Active content is stripped …
    expect(body).not.toContain("onclick");
    expect(body).not.toContain("<script");
    // … but the role wrapper + heading survive — the scalpel keeps the class the
    // starter theme sizes on (this is why body_html CAN be sanitized).
    expect(body).toContain('class="txt-role-text2"');
    expect(body).toContain("The Pointe");
  });

  it("sanitizes every html leaf of a BluxBlock payload at the boundary", () => {
    const json = JSON.stringify(
      catalogSpecToPlanSlice({
        slice: "BluxBlock",
        index: 5,
        payload: {
          tag: "div",
          children: [{ html: "<script>var x</script><span>Legend</span>" }],
        },
        media: [],
      }),
    );
    expect(json).toContain("Legend");
    expect(json).not.toContain("var x");
    expect(json).not.toContain("<script");
  });

  it("drops an embed cell whose html has no visible content after sanitize", () => {
    const s: BluxSectionSpec = {
      slice: "BluxSection",
      index: 3,
      cells: [
        { kind: "embed", embedHtml: '<div data-exec="custom_abc"><script>boot()</script></div>' },
        { kind: "text", bodyHtml: "<p>kept</p>" },
      ],
    };
    const cells = catalogSpecToPlanSlice(s).primary.cells as Record<string, unknown>[];
    expect(cells).toHaveLength(1);
    expect(cells[0]?.kind).toBe("text");
  });
});

describe("buildCatalogPlan", () => {
  it("wraps specs in one page document and collects the referenced assets", () => {
    const plan = buildCatalogPlan([{ uid: "home", title: "Home", specs: [spec] }], {
      assets: [
        { id: "u1", url: "https://cdn/u1.jpg", alt: "pool", sourceUrl: "https://cdn/u1.jpg" },
      ],
      diagnostics: [],
    });
    expect(plan.documents).toHaveLength(1);
    expect(plan.documents[0]).toMatchObject({ type: "page", uid: "home" });
    const slices = (plan.documents[0]!.data as { slices: unknown[] }).slices;
    expect(slices).toHaveLength(1);
    expect(plan.assets.find((a) => a.id === "u1")?.url).toBe("https://cdn/u1.jpg");
  });

  it("emits band-visual primary fields and per-cell visual fields", () => {
    const gridSpec = {
      slice: "BluxGrid",
      index: 0,
      columns: 2,
      minHeight: "100vh",
      contentPadding: "100px 4%",
      contentPaddingMobile: "40px 4%",
      maxContentWidth: "1280px",
      verticalAlign: "middle",
      textAlign: "center",
      headingRole: "text2",
      cells: [
        {
          kind: "text",
          title: "<h3>A</h3>",
          titleRole: "text5",
          width: "70%",
          backgroundColor: "#fff",
          contentPadding: "100px 4% 80px",
          valign: true,
        },
        {
          kind: "media",
          media: { kind: "image", assetId: "u1" },
          width: "30%",
          cover: true,
          mediaRatio: "4:3",
        },
      ],
    } as unknown as import("../../../src/blux/catalog/spec.js").CatalogSpec;
    const slice = catalogSpecToPlanSlice(gridSpec);
    expect(slice.primary).toMatchObject({
      min_height: "100vh",
      content_padding: "100px 4%",
      content_padding_mobile: "40px 4%",
      max_content_width: "1280px",
      vertical_align: "middle",
      text_align: "center",
      heading_role: "text2",
    });
    const cells = slice.primary.cells as Record<string, unknown>[];
    expect(cells[0]).toMatchObject({
      width: "70%",
      background_color: "#fff",
      content_padding: "100px 4% 80px",
      valign: "on",
      title_role: "text5",
    });
    expect(cells[1]).toMatchObject({
      width: "30%",
      cover: "on",
      media_ratio: "4:3",
    });
  });
});
