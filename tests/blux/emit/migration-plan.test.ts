import { describe, it, expect } from "vitest";
import { assembleIR } from "../../../src/blux/assemble.js";
import { buildMigrationPlan } from "../../../src/blux/emit/migration-plan.js";
import { minimalSite, minimalHtml } from "../fixtures/minimal-site.js";

describe("buildMigrationPlan", () => {
  const plan = buildMigrationPlan(assembleIR({ siteJson: minimalSite, htmls: [minimalHtml] }));
  it("emits a custom type per collection", () => {
    expect(plan.customTypes.map((c) => c.id)).toEqual(["team"]);
  });
  it("emits a page document with slices + a doc per collection record", () => {
    const pages = plan.documents.filter((d) => d.type === "page");
    const team = plan.documents.filter((d) => d.type === "team");
    expect(pages).toHaveLength(1);
    expect((pages[0]!.data.slices as unknown[]).length).toBe(4);
    expect(team).toHaveLength(2);
  });
  it("marks record rich-text + media fields", () => {
    const jane = plan.documents.find((d) => d.type === "team" && d.uid === "jane-doe")!;
    expect(jane.data.body).toEqual({ __richtext_html: "<p>Bio.</p>" });
    expect(jane.data.media).toEqual({ __asset_id: "img-2" });
  });
  it("lists only resolved assets", () => {
    expect(plan.assets.every((a) => a.url.startsWith("https://"))).toBe(true);
    expect(plan.assets.map((a) => a.id).sort()).toEqual(["img-1", "img-2"]);
  });
  it("emits the page title as single-heading1 rich text", () => {
    const page = plan.documents.find((d) => d.type === "page")!;
    expect(page.data.title).toEqual({ __richtext_html: "<h1>Home</h1>" });
  });
  it("is deterministic", () => {
    const again = buildMigrationPlan(assembleIR({ siteJson: minimalSite, htmls: [minimalHtml] }));
    expect(again).toEqual(plan);
  });

  it("skips empty pages with a diagnostic instead of emitting hollow documents", () => {
    const ir = assembleIR({ siteJson: minimalSite, htmls: [minimalHtml] });
    ir.pages.push({ uid: "stub", title: "", description: "", sections: [] });
    const p = buildMigrationPlan(ir);
    expect(p.documents.find((d) => d.uid === "stub")).toBeUndefined();
    expect(p.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "empty-page", where: "stub" }),
    );
  });

  it("drops non-image assets from image fields with a diagnostic", () => {
    const ir = assembleIR({ siteJson: minimalSite, htmls: [minimalHtml] });
    const bgId = ir.pages[0]!.sections[0]!.fields.backgroundMedia!;
    ir.assets.find((a) => a.id === bgId)!.mime = "video/mp4";
    const p = buildMigrationPlan(ir);
    const hero = (
      p.documents[0]!.data.slices as { slice_type: string; primary: Record<string, unknown> }[]
    ).find((s) => s.slice_type === "hero")!;
    expect(hero.primary.background_image).toBeUndefined();
    expect(p.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "non-image-in-image-field" }),
    );
  });

  it("applies flattening before emitting slices", () => {
    const ir = assembleIR({ siteJson: minimalSite, htmls: [minimalHtml] });
    ir.pages[0]!.sections = [
      {
        sliceType: "grid",
        variation: "default",
        confidence: 1,
        fields: {},
        children: [
          {
            sliceType: "grid",
            variation: "default",
            confidence: 1,
            fields: {},
            children: [
              {
                sliceType: "media_text",
                variation: "imageRight",
                confidence: 1,
                fields: { body: "<p>deep</p>" },
              },
            ],
          },
        ],
      },
    ];
    const p = buildMigrationPlan(ir);
    const slices = p.documents[0]!.data.slices as {
      slice_type: string;
      items: Record<string, unknown>[];
    }[];
    expect(slices.map((s) => s.slice_type)).toEqual(["section_grid"]);
    // the deep media_text survived as an item of the hoisted inner grid
    expect(slices[0]!.items[0]!.item_body).toEqual({ __richtext_html: "<p>deep</p>" });
  });
});
