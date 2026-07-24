import { describe, it, expect } from "vitest";
import { catalogPageCustomType } from "../../../src/blux/catalog/index.js";

type Field = { type: string; config?: Record<string, unknown> };
type Model = {
  id: string;
  label: string;
  format: string;
  repeatable: boolean;
  status: boolean;
  json: {
    Main: {
      uid: Field;
      title: Field;
      slices: { type: string; config: { choices: Record<string, { type: string }> } };
    };
    "SEO & Metadata": { meta_title: Field; meta_description: Field; meta_image: Field };
  };
};

describe("catalogPageCustomType", () => {
  it("is a repeatable page-format PlanCustomType with id catalog_page", () => {
    const t = catalogPageCustomType();
    expect(t.id).toBe("catalog_page");
    expect(t.repeatable).toBe(true);
    // `json` is the FULL Prismic Custom Types API definition pushCustomTypes ships.
    const model = t.json as Model;
    expect(model.id).toBe("catalog_page");
    expect(model.format).toBe("page");
    expect(model.repeatable).toBe(true);
    expect(model.status).toBe(true);
  });

  it("has a Main tab: uid + title + a blux_* SharedSlices zone (native choices dropped)", () => {
    const main = (catalogPageCustomType().json as Model).json.Main;
    expect(main.uid.type).toBe("UID");
    expect(main.title.type).toBe("StructuredText");
    expect(main.slices.type).toBe("Slices");
    const choices = Object.keys(main.slices.config.choices);
    expect(choices).toEqual([
      "blux_section",
      "blux_text",
      "blux_block",
      "blux_grid",
      "blux_gallery",
      "blux_carousel",
      "blux_media",
      "blux_media_text",
      "blux_embed",
      "blux_table",
      "blux_collection",
    ]);
    // No native (lead_text/hero/…) choices — a migrated page only holds blux_*.
    expect(choices.every((c) => c.startsWith("blux_"))).toBe(true);
    expect(Object.values(main.slices.config.choices).every((c) => c.type === "SharedSlice")).toBe(
      true,
    );
  });

  it("has an SEO & Metadata tab matching the starter render's field types", () => {
    const seo = (catalogPageCustomType().json as Model).json["SEO & Metadata"];
    // Text (plain string) for the two text metas; Image for meta_image — exactly
    // what the starter blux-catalog/page-doc.ts pageMeta reads.
    expect(seo.meta_title.type).toBe("Text");
    expect(seo.meta_description.type).toBe("Text");
    expect(seo.meta_image.type).toBe("Image");
    expect(seo.meta_image.config).toMatchObject({ constraint: { width: 2400, height: 1260 } });
  });
});
