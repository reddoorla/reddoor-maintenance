import { describe, expect, it } from "vitest";
import {
  normalizeCategory,
  normalizeSubCategory,
  productSlug,
  materializeProducts,
  type ProductRecord,
} from "../../src/blux/products.js";

describe("normalizeCategory", () => {
  it("folds whitespace/case variants onto the canonical form", () => {
    for (const raw of ["Upholstered", "Upholstered ", "upholstered", "  UPHOLSTERED  "])
      expect(normalizeCategory(raw)).toBe("Upholstered");
    for (const raw of ["Case", "Case ", "case"]) expect(normalizeCategory(raw)).toBe("Case");
    expect(normalizeCategory("Exterior")).toBe("Exterior");
  });

  it("folds the known typos onto Upholstered", () => {
    expect(normalizeCategory("Upholstrered")).toBe("Upholstered");
    expect(normalizeCategory("Upholsered")).toBe("Upholstered");
  });

  it("keeps an unrecognized category (title-cased) rather than dropping it", () => {
    expect(normalizeCategory("outdoor seating")).toBe("Outdoor Seating");
  });

  it("returns '' for an empty/missing category", () => {
    expect(normalizeCategory("")).toBe("");
    expect(normalizeCategory(undefined)).toBe("");
  });
});

describe("normalizeSubCategory", () => {
  it("folds word-order + typo variants", () => {
    expect(normalizeSubCategory("Banuette")).toBe("Banquette");
    expect(normalizeSubCategory("Benches & Ottomans")).toBe("Ottomans & Benches");
    expect(normalizeSubCategory("miscellaneous")).toBe("Misc.");
  });

  it("title-cases and trims a normal sub-category", () => {
    expect(normalizeSubCategory("  lounge ")).toBe("Lounge");
    expect(normalizeSubCategory("ottomans & benches")).toBe("Ottomans & Benches");
  });

  it("returns '' when absent", () => {
    expect(normalizeSubCategory("")).toBe("");
  });
});

describe("productSlug", () => {
  it("derives from the title (lowercase, non-alnum → single hyphen, trimmed)", () => {
    expect(productSlug({ title: "Aero Sofa" })).toBe("aero-sofa");
    expect(productSlug({ title: "CSG-SPE-258" })).toBe("csg-spe-258");
    expect(productSlug({ title: "Chair 287" })).toBe("chair-287");
  });

  it("uses the stored url when present, overriding derivation", () => {
    expect(productSlug({ title: "Howdy Set", url: "/products/howdyset" })).toBe("howdyset");
    expect(productSlug({ title: "Nia Set", url: "/products/niaset" })).toBe("niaset");
  });

  it("strips a /products/ prefix and surrounding slashes from a stored url", () => {
    expect(productSlug({ title: "X", url: "/products/beverlywood-sofa" })).toBe("beverlywood-sofa");
  });
});

describe("materializeProducts", () => {
  const resolve = (uuid: string) => (uuid === "missing" ? null : `https://cdn/${uuid}.jpg`);

  it("materializes a record with cleaned category, main image, and gallery", () => {
    const recs: ProductRecord[] = [
      {
        title: "Aria",
        category: "Upholstered ",
        sub_category: "Lounge",
        dimensions: '30"W x 30"D',
        tags: ["leather", "lounge"],
        media: { media: "main-1" },
        items: [{ title: "", media: { media: "gal-1" } }],
      },
    ];
    const p = materializeProducts(recs, resolve)[0]!;
    expect(p).toMatchObject({
      slug: "aria",
      title: "Aria",
      category: "Upholstered",
      subCategory: "Lounge",
      dimensions: '30"W x 30"D',
      disabled: false,
    });
    expect(p.image?.url).toBe("https://cdn/main-1.jpg");
    expect(p.gallery).toEqual([{ assetId: "gal-1", url: "https://cdn/gal-1.jpg" }]);
  });

  it("omits an image that can't be resolved (no dead url)", () => {
    const p = materializeProducts([{ title: "NoPic", media: { media: "missing" } }], resolve)[0]!;
    expect(p.image).toBeUndefined();
    expect(p.gallery).toEqual([]);
  });

  it("keeps disabled products (Blux still serves their detail page)", () => {
    const p = materializeProducts([{ title: "Amos", disabled: true }], resolve)[0]!;
    expect(p.disabled).toBe(true);
    expect(p.slug).toBe("amos");
  });

  it("dedupes a slug collision, preferring the enabled record", () => {
    const recs: ProductRecord[] = [
      { title: "Regis", disabled: true, dimensions: "old" },
      { title: "Regis", disabled: false, dimensions: "new" },
    ];
    const out = materializeProducts(recs, resolve);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ slug: "regis", disabled: false, dimensions: "new" });
  });

  it("drops a record with no derivable slug", () => {
    expect(materializeProducts([{ title: "" }], resolve)).toHaveLength(0);
  });
});
