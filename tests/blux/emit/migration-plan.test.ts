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
});
