import { describe, it, expect } from "vitest";
import {
  frozenPageCustomType,
  FROZEN_PAGE_TYPE,
} from "../../../src/blux/freeze/frozen-page-type.js";

type Field = { type: string; config?: Record<string, unknown> };
type Group = {
  type: string;
  config: { label: string; fields: { key: Field; kind: Field; text: Field; image: Field } };
};
type Model = {
  id: string;
  label: string;
  format: string;
  repeatable: boolean;
  status: boolean;
  json: {
    Main: { uid: Field; title: Field; slots: Group };
    "SEO & Metadata": { meta_title: Field; meta_description: Field; meta_image: Field };
  };
};

describe("frozenPageCustomType", () => {
  it("is a repeatable page-format PlanCustomType with id frozen_page", () => {
    const t = frozenPageCustomType();
    expect(FROZEN_PAGE_TYPE).toBe("frozen_page");
    expect(t.id).toBe("frozen_page");
    expect(t.repeatable).toBe(true);
    const model = t.json as Model;
    expect(model.id).toBe("frozen_page");
    expect(model.format).toBe("page");
    expect(model.repeatable).toBe(true);
    expect(model.status).toBe(true);
  });

  it("its json round-trips through JSON.parse (a shippable Custom Types API body)", () => {
    const t = frozenPageCustomType();
    const round = JSON.parse(JSON.stringify(t.json)) as Model;
    expect(round.id).toBe("frozen_page");
    // Serialization is lossless — the full model survives the wire.
    expect(round).toEqual(t.json);
  });

  it("has a Main tab: uid + a plain-Text title", () => {
    const main = (frozenPageCustomType().json as Model).json.Main;
    expect(main.uid.type).toBe("UID");
    expect(main.title.type).toBe("Text");
  });

  it("declares a repeatable slots Group with key/kind/text/image fields", () => {
    const slots = (frozenPageCustomType().json as Model).json.Main.slots;
    expect(slots.type).toBe("Group");
    const fields = slots.config.fields;
    expect(Object.keys(fields)).toEqual(["key", "kind", "text", "image"]);
    // key → Text, kind → Select(text|image), text → Rich Text, image → Image.
    expect(fields.key.type).toBe("Text");
    expect(fields.kind.type).toBe("Select");
    expect(fields.kind.config).toMatchObject({ options: ["text", "image"] });
    expect(fields.text.type).toBe("StructuredText");
    expect(fields.image.type).toBe("Image");
  });

  it("has an SEO & Metadata tab with Text metas + an Image meta_image", () => {
    const seo = (frozenPageCustomType().json as Model).json["SEO & Metadata"];
    expect(seo.meta_title.type).toBe("Text");
    expect(seo.meta_description.type).toBe("Text");
    expect(seo.meta_image.type).toBe("Image");
  });
});
