/** to-plan adapts a Webflow capture (docs + asset manifest) into the blux
 *  MigrationPlan the shared runner consumes. The load-bearing assertion is that
 *  the rewritten media marker is one resolveDocData actually resolves — so we
 *  call resolveDocData on the adapter's own output rather than eyeballing shapes. */
import { describe, it, expect } from "vitest";
import { resolveDocData } from "../../src/blux/emit/resolve-doc.js";
import { webflowToPlan } from "../../src/webflow/to-plan.js";
import type { AssetRef } from "../../src/webflow/crawl.js";
import type { WfDoc } from "../../src/webflow/to-docs.js";

const mediaDoc: WfDoc = {
  type: "person",
  uid: "dr-quan",
  lang: "en-us",
  data: {
    title: [{ type: "heading1", text: "Dr. Quan", spans: [] }],
    media: { __asset: "photo.jpg", alt: "Dr. Quan" },
  },
};
const asset: AssetRef = { filename: "photo.jpg", url: "https://cdn/x/photo.jpg" };

describe("webflowToPlan", () => {
  it("(a) rewrites a media placeholder into a marker resolveDocData resolves for the same filename", () => {
    const plan = webflowToPlan({ docs: [mediaDoc], assets: [asset] });
    const planDoc = plan.documents[0];
    expect(planDoc).toBeDefined();
    // The convention resolveDocData reads is `{ __asset_id: <filename> }`.
    expect(planDoc?.data.media).toEqual({ __asset_id: "photo.jpg" });

    // Lock it end-to-end: resolveDocData on the adapter's output, with a fake
    // filename → Prismic-asset-id map, must yield the Prismic image `{ id }`.
    const resolved = resolveDocData(planDoc?.data ?? {}, new Map([["photo.jpg", "ASSET_ID_ABC"]]));
    expect(resolved.missingAssets).toEqual([]);
    expect((resolved.data as { media: unknown }).media).toEqual({ id: "ASSET_ID_ABC" });
  });

  it("(b) passes assets through with url + filename intact (id = the dedupe filename)", () => {
    const plan = webflowToPlan({ docs: [mediaDoc], assets: [asset] });
    // PlanAsset.id IS the filename runMigration dedupes the media library by,
    // and the alt from the placeholder rides along onto the upload.
    expect(plan.assets).toEqual([
      { id: "photo.jpg", url: "https://cdn/x/photo.jpg", alt: "Dr. Quan" },
    ]);
  });

  it("(c) emits zero custom types (the site repo's types come from Slice Machine)", () => {
    const plan = webflowToPlan({ docs: [mediaDoc], assets: [asset] });
    expect(plan.customTypes).toEqual([]);
  });

  it("(d) leaves no placeholder residue for a doc with no media", () => {
    const noMedia: WfDoc = {
      type: "news_article",
      uid: "a-question",
      lang: "en-us",
      data: {
        title: [{ type: "heading1", text: "Q", spans: [] }],
        body: [{ type: "paragraph", text: "answer", spans: [] }],
        date: "2026-06-01",
      },
    };
    const plan = webflowToPlan({ docs: [noMedia], assets: [] });
    expect(JSON.stringify(plan)).not.toContain("__asset");
  });

  it("alt collision: two docs referencing the same filename keep the FIRST alt", () => {
    const second: WfDoc = {
      type: "collection_item",
      uid: "reuse",
      lang: "en-us",
      data: { media: { __asset: "photo.jpg", alt: "Different alt" } },
    };
    const plan = webflowToPlan({ docs: [mediaDoc, second], assets: [asset] });
    // Per-doc alt is architecturally unavailable (resolveDocData emits a bare
    // { id }), so the asset carries ONE library alt — first-wins, doc order.
    expect(plan.assets).toEqual([
      { id: "photo.jpg", url: "https://cdn/x/photo.jpg", alt: "Dr. Quan" },
    ]);
  });

  it("deep nesting: a placeholder at data.slices[0].items[0].image rewrites and resolves", () => {
    const nested: WfDoc = {
      type: "page",
      uid: "home",
      lang: "en-us",
      data: {
        slices: [
          {
            slice_type: "gallery",
            items: [{ image: { __asset: "deep.png", alt: "Deep" }, caption: "c" }],
          },
        ],
      },
    };
    const plan = webflowToPlan({
      docs: [nested],
      assets: [{ filename: "deep.png", url: "https://cdn/x/deep.png" }],
    });
    type Nested = { slices: { items: { image: unknown }[] }[] };
    const data = plan.documents[0]?.data as Nested | undefined;
    expect(data?.slices[0]?.items[0]?.image).toEqual({ __asset_id: "deep.png" });

    const resolved = resolveDocData(
      plan.documents[0]?.data ?? {},
      new Map([["deep.png", "DEEP_ID"]]),
    );
    expect(resolved.missingAssets).toEqual([]);
    const out = resolved.data as Nested;
    expect(out.slices[0]?.items[0]?.image).toEqual({ id: "DEEP_ID" });
  });
});
