import { describe, it, expect } from "vitest";
import { checkAssets, HEAVY_IMAGE_BYTES, type AssetCheckDeps } from "../../src/prospect/assets.js";
import type { PageAnchor, PageCapture, PageExtract } from "../../src/prospect/types.js";

function extract(over: Partial<PageExtract> = {}): PageExtract {
  return {
    title: null,
    metaDescription: null,
    canonical: null,
    social: {},
    headings: [],
    jsonLd: [],
    images: { total: 0, withAlt: 0 },
    hasViewportMeta: true,
    text: "",
    anchors: [],
    anchorCount: 0,
    imageSrcs: [],
    forms: [],
    ...over,
  };
}

function page(url: string, over: Partial<PageExtract> = {}): PageCapture {
  return { url, status: 200, raw: extract(over), rendered: extract(over), error: null };
}

const link = (href: string): PageAnchor => ({ href, text: href, rel: "" });

/** A probe driven by a lookup table. Anything absent is a 200 with no size. */
function deps(
  table: Record<string, { status: number; bytes?: number } | "throw">,
  over: Partial<AssetCheckDeps> = {},
): AssetCheckDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    maxLinks: 50,
    maxImages: 50,
    delayMs: 0,
    sleep: async () => {},
    probe: async (url) => {
      asked.push(url);
      const entry = table[url];
      if (entry === "throw") throw new Error("connection reset");
      const status = entry?.status ?? 200;
      const headers: Record<string, string> = {};
      if (entry?.bytes !== undefined) headers["content-length"] = String(entry.bytes);
      return { status, headers };
    },
    ...over,
  };
}

const ORIGIN = "https://acme.example";

describe("checkAssets — broken links", () => {
  it("reports an internal link that 404s, and says which page it is on", async () => {
    const d = deps({ "https://acme.example/gone": { status: 404 } });
    const result = await checkAssets(
      [page("https://acme.example/about", { anchors: [link("/gone"), link("/fine")] })],
      ORIGIN,
      d,
    );
    expect(result.brokenLinks).toHaveLength(1);
    expect(result.brokenLinks[0]?.url).toBe("https://acme.example/gone");
    expect(result.brokenLinks[0]?.referencedBy).toEqual(["https://acme.example/about"]);
  });

  it("does not probe links to other sites", async () => {
    const d = deps({});
    await checkAssets(
      [page("https://acme.example/", { anchors: [link("https://elsewhere.example/x")] })],
      ORIGIN,
      d,
    );
    expect(d.asked).toEqual([]);
  });

  // Every URL probed here came out of the prospect's markup, so a hostile page
  // controls what we fetch. Same guard the crawler applies to its own entry.
  it("refuses to probe a private address a page links to", async () => {
    const d = deps({});
    await checkAssets(
      [
        page("https://acme.example/", {
          anchors: [link("http://169.254.169.254/latest/meta-data/")],
          imageSrcs: ["http://127.0.0.1:8080/x.png"],
        }),
      ],
      ORIGIN,
      d,
    );
    expect(d.asked).toEqual([]);
  });

  // A 404 is the prospect's broken link. A connection reset might be our
  // network, and only the first belongs in a report as their defect.
  it("does not report a transport failure as a broken link", async () => {
    const d = deps({ "https://acme.example/flaky": "throw" });
    const result = await checkAssets(
      [page("https://acme.example/", { anchors: [link("/flaky")] })],
      ORIGIN,
      d,
    );
    expect(result.brokenLinks).toEqual([]);
  });

  it("probes one url once however many pages link to it", async () => {
    const d = deps({ "https://acme.example/shared": { status: 404 } });
    const result = await checkAssets(
      [
        page("https://acme.example/a", { anchors: [link("/shared")] }),
        page("https://acme.example/b", { anchors: [link("/shared")] }),
      ],
      ORIGIN,
      d,
    );
    expect(d.asked).toEqual(["https://acme.example/shared"]);
    expect(result.brokenLinks[0]?.referencedBy).toEqual([
      "https://acme.example/a",
      "https://acme.example/b",
    ]);
  });

  it("reports the true total alongside how many it checked", async () => {
    const anchors = Array.from({ length: 10 }, (_, i) => link(`/p${i}`));
    const result = await checkAssets([page("https://acme.example/", { anchors })], ORIGIN, {
      ...deps({}),
      maxLinks: 4,
    });
    expect(result.linksFound).toBe(10);
    expect(result.linksChecked).toBe(4);
  });
});

describe("checkAssets — images", () => {
  it("reports a broken image wherever it is hosted", async () => {
    const d = deps({ "https://cdn.example/hero.jpg": { status: 403 } });
    const result = await checkAssets(
      [page("https://acme.example/", { imageSrcs: ["https://cdn.example/hero.jpg"] })],
      ORIGIN,
      d,
    );
    expect(result.brokenImages).toHaveLength(1);
  });

  it("names the heavy images, heaviest first", async () => {
    const d = deps({
      "https://acme.example/huge.jpg": { status: 200, bytes: 4_200_000 },
      "https://acme.example/big.jpg": { status: 200, bytes: 900_000 },
      "https://acme.example/small.jpg": { status: 200, bytes: 12_000 },
    });
    const result = await checkAssets(
      [
        page("https://acme.example/", {
          imageSrcs: ["/small.jpg", "/big.jpg", "/huge.jpg"],
        }),
      ],
      ORIGIN,
      d,
    );
    expect(result.heaviestImages.map((i) => i.bytes)).toEqual([4_200_000, 900_000]);
    expect(result.heaviestImages[0]?.url).toBe("https://acme.example/huge.jpg");
    expect(HEAVY_IMAGE_BYTES).toBeGreaterThan(12_000);
  });

  it("sums only the images whose size the server actually reported", async () => {
    const d = deps({
      "https://acme.example/known.jpg": { status: 200, bytes: 500_000 },
      // No content-length — common, and unknown is not zero.
      "https://acme.example/quiet.jpg": { status: 200 },
    });
    const result = await checkAssets(
      [page("https://acme.example/", { imageSrcs: ["/known.jpg", "/quiet.jpg"] })],
      ORIGIN,
      d,
    );
    expect(result.imageBytesMeasured).toBe(500_000);
    expect(result.imagesWithKnownSize).toBe(1);
    expect(result.imagesChecked).toBe(2);
  });

  // Never print "0 MB of images" for a page full of pictures whose server is
  // quiet about sizes. Null says "we could not measure"; 0 says "they weigh
  // nothing", and only one of those is true.
  it("reports null rather than zero when no size was knowable", async () => {
    const d = deps({ "https://acme.example/a.jpg": { status: 200 } });
    const result = await checkAssets(
      [page("https://acme.example/", { imageSrcs: ["/a.jpg"] })],
      ORIGIN,
      d,
    );
    expect(result.imageBytesMeasured).toBeNull();
  });

  it("does not count a broken image's bytes toward the page weight", async () => {
    const d = deps({ "https://acme.example/gone.jpg": { status: 404, bytes: 900_000 } });
    const result = await checkAssets(
      [page("https://acme.example/", { imageSrcs: ["/gone.jpg"] })],
      ORIGIN,
      d,
    );
    expect(result.imageBytesMeasured).toBeNull();
    expect(result.heaviestImages).toEqual([]);
  });

  it("treats a malformed content-length as unknown, not as zero", async () => {
    const result = await checkAssets(
      [page("https://acme.example/", { imageSrcs: ["/a.jpg"] })],
      ORIGIN,
      {
        ...deps({}),
        probe: async () => ({ status: 200, headers: { "content-length": "banana" } }),
      },
    );
    expect(result.imagesWithKnownSize).toBe(0);
    expect(result.imageBytesMeasured).toBeNull();
  });
});

describe("checkAssets — nothing to do", () => {
  it("returns an empty, non-crashing shape for a site with no links or images", async () => {
    const result = await checkAssets([page("https://acme.example/")], ORIGIN, deps({}));
    expect(result.brokenLinks).toEqual([]);
    expect(result.brokenImages).toEqual([]);
    expect(result.linksFound).toBe(0);
    expect(result.imageBytesMeasured).toBeNull();
  });

  it("skips pages that produced no extract", async () => {
    const d = deps({});
    const result = await checkAssets(
      [{ url: "https://acme.example/x", status: null, raw: null, rendered: null, error: "boom" }],
      ORIGIN,
      d,
    );
    expect(result.linksFound).toBe(0);
    expect(d.asked).toEqual([]);
  });
});
