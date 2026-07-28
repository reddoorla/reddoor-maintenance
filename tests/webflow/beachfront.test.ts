/** Beachfront page-doc assembly: pageDocs turns a crawled IR into the five
 *  `page` docs that drive the site repo's Plan-B slice models. The IR is built
 *  from the same fixture-backed fakeFetch crawl used in crawl.test.ts. */
import { beforeAll, describe, expect, it } from "vitest";
import { assetFilename, crawlSite } from "../../src/webflow/crawl.js";
import { pageDocs } from "../../src/webflow/sites/beachfront.js";
import type { WfDoc } from "../../src/webflow/to-docs.js";
import type { WebflowIR } from "../../src/webflow/types.js";
import { fakeFetch } from "./_helpers/fixture-fetch.js";

type Slice = {
  slice_type: string;
  variation: string;
  primary: Record<string, unknown>;
  items: Record<string, unknown>[];
};
const slicesOf = (doc: WfDoc): Slice[] => doc.data.slices as Slice[];
const byUid = (docs: WfDoc[], uid: string): WfDoc => {
  const d = docs.find((x) => x.uid === uid);
  if (!d) throw new Error(`no doc ${uid}`);
  return d;
};

describe("beachfront pageDocs", () => {
  let ir: WebflowIR;
  let docs: WfDoc[];

  beforeAll(async () => {
    ir = await crawlSite(
      "https://www.beachfrontdentistry.com",
      fakeFetch,
      () => "2026-07-27T00:00:00Z",
    );
    docs = pageDocs(ir);
  });

  it("returns 5 page docs with the exact uids in order, all page / en-us", () => {
    expect(docs.map((d) => d.uid)).toEqual([
      "home",
      "your-first-visit",
      "our-team",
      "services",
      "ask-the-doctor",
    ]);
    expect(docs.every((d) => d.type === "page")).toBe(true);
    expect(docs.every((d) => d.lang === "en-us")).toBe(true);
  });

  it("home: one carousel/review whose items mirror ir.reviews (quotes, photos, urls)", () => {
    const home = byUid(docs, "home");
    const reviewSlices = slicesOf(home).filter(
      (s) => s.slice_type === "carousel" && s.variation === "review",
    );
    expect(reviewSlices).toHaveLength(1);

    const items = reviewSlices[0]!.items;
    expect(items).toHaveLength(5);
    expect(items.map((i) => i.quote)).toEqual(ir.reviews.map((r) => r.quote));
    items.forEach((item, i) => {
      const r = ir.reviews[i]!;
      const photo = item.reviewer_photo as { __asset: string };
      expect(photo.__asset).toBe(assetFilename(r.reviewerPhoto!.url));
      expect(item.review_url).toEqual({ link_type: "Web", url: r.reviewUrl });
    });
  });

  it("services: exactly 4 service_category_band slices, tags = category names, non-empty intros", () => {
    const bands = slicesOf(byUid(docs, "services")).filter(
      (s) => s.slice_type === "service_category_band",
    );
    expect(bands).toHaveLength(4);
    expect(bands.map((b) => b.primary.category_tag)).toEqual(
      ir.serviceCategories.map((c) => c.name),
    );
    bands.forEach((b) => {
      const intro = b.primary.intro as { text: string }[];
      expect(intro?.[0]?.text?.length ?? 0).toBeGreaterThan(0);
    });
  });

  it("question_list variants + our-team collection_list wiring", () => {
    const teaser = slicesOf(byUid(docs, "home")).find((s) => s.slice_type === "question_list");
    expect(teaser?.variation).toBe("teaser");
    expect(teaser?.primary.max_items).toBe(6);

    const numbered = slicesOf(byUid(docs, "ask-the-doctor")).find(
      (s) => s.slice_type === "question_list",
    );
    expect(numbered?.variation).toBe("numbered");

    const collection = slicesOf(byUid(docs, "our-team")).find(
      (s) => s.slice_type === "collection_list",
    );
    expect(collection?.variation).toBe("grid");
    expect(collection?.primary.collection_type).toBe("person");
  });

  it("every slice carries slice_type + variation + primary + items; __asset only on reviewer photos", () => {
    const all = docs.flatMap(slicesOf);
    all.forEach((s) => {
      expect(typeof s.slice_type).toBe("string");
      expect(typeof s.variation).toBe("string");
      expect(typeof s.primary).toBe("object");
      expect(Array.isArray(s.items)).toBe(true);
    });

    // Reviewer photos are the sole placeholders. The review carousel appears on
    // both home and your-first-visit, so the literal "one __asset per photo"
    // invariant holds per carousel (× the number of carousels).
    const assetCount = (JSON.stringify(docs).match(/"__asset"/g) ?? []).length;
    const reviewsWithPhoto = ir.reviews.filter((r) => r.reviewerPhoto).length;
    const reviewCarousels = all.filter(
      (s) => s.slice_type === "carousel" && s.variation === "review",
    ).length;
    expect(reviewCarousels).toBe(2);
    expect(assetCount).toBe(reviewsWithPhoto * reviewCarousels);
  });

  it("wire-format lock: a sampled slice's key set matches the blux catalog emit precedent", () => {
    // src/blux/emit/plan.ts PlanSlice / catalog-emit sliceOf → exactly these keys.
    const sample = docs.flatMap(slicesOf)[0]!;
    expect(Object.keys(sample).sort()).toEqual(["items", "primary", "slice_type", "variation"]);
  });
});
