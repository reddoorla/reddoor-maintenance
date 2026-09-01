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
    const d = deps({ "https://cdn.example/hero.jpg": { status: 404 } });
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

/**
 * The line between "their broken link" and "we could not look".
 *
 * `isOk` used to be 2xx-only, so every non-2xx answer landed in `brokenLinks`
 * or `brokenImages` with its status printed as proof. A CDN that 403s a
 * non-browser user agent for an image the page paints perfectly, or a 429 our
 * own burst of requests provoked, became a defect on a client's report. Both are
 * OUR missing evidence, and missing evidence must never render as a finding.
 */
describe("checkAssets — broken versus could-not-verify", () => {
  const linkPage = (href: string): PageCapture =>
    page("https://acme.example/", { anchors: [link(href)] });

  it("calls a 404 and a 410 broken", async () => {
    const d = deps({
      "https://acme.example/gone": { status: 404 },
      "https://acme.example/retired": { status: 410 },
    });
    const result = await checkAssets(
      [page("https://acme.example/", { anchors: [link("/gone"), link("/retired")] })],
      ORIGIN,
      d,
    );
    expect(result.brokenLinks.map((l) => l.status).sort()).toEqual([404, 410]);
    expect(result.linksUnverified?.count).toBe(0);
  });

  // The fetch follows redirects, so a 3xx arriving here is a redirect that never
  // resolved — a visitor following that link lands nowhere.
  it("calls a redirect that did not resolve broken", async () => {
    const d = deps({ "https://acme.example/loop": { status: 302 } });
    const result = await checkAssets([linkPage("/loop")], ORIGIN, d);
    expect(result.brokenLinks).toHaveLength(1);
  });

  it("does not call a 403 broken, and says why it could not tell", async () => {
    const d = deps({ "https://cdn.example/hero.jpg": { status: 403 } });
    const result = await checkAssets(
      [page("https://acme.example/", { imageSrcs: ["https://cdn.example/hero.jpg"] })],
      ORIGIN,
      d,
    );
    expect(result.brokenImages).toEqual([]);
    expect(result.imagesUnverified?.count).toBe(1);
    expect(result.imagesUnverified?.groups).toEqual([
      {
        reason: "refused",
        count: 1,
        detail: expect.any(String),
        example: "https://cdn.example/hero.jpg",
      },
    ]);
  });

  it("does not call a 401 broken", async () => {
    const d = deps({ "https://acme.example/members": { status: 401 } });
    const result = await checkAssets([linkPage("/members")], ORIGIN, d);
    expect(result.brokenLinks).toEqual([]);
    expect(result.linksUnverified?.groups[0]?.reason).toBe("auth-required");
  });

  // A 429 is the clearest case of all: we caused it.
  it("does not call a 429 broken", async () => {
    const d = deps({ "https://acme.example/a": { status: 429 } });
    const result = await checkAssets([linkPage("/a")], ORIGIN, d);
    expect(result.brokenLinks).toEqual([]);
    expect(result.linksUnverified?.groups[0]?.reason).toBe("rate-limited");
  });

  it("does not call a 5xx broken", async () => {
    const d = deps({ "https://acme.example/a": { status: 503 } });
    const result = await checkAssets([linkPage("/a")], ORIGIN, d);
    expect(result.brokenLinks).toEqual([]);
    expect(result.linksUnverified?.groups[0]?.reason).toBe("server-error");
  });

  // Already excluded from the broken list before this change — but silently, so
  // the report could not say how much of the site it had failed to look at.
  it("counts a transport failure as unverified rather than dropping it", async () => {
    const d = deps({ "https://acme.example/flaky": "throw" });
    const result = await checkAssets([linkPage("/flaky")], ORIGIN, d);
    expect(result.brokenLinks).toEqual([]);
    expect(result.linksUnverified?.groups[0]?.reason).toBe("no-response");
  });

  it("groups several unverifiable answers by reason with one example each", async () => {
    const d = deps({
      "https://acme.example/a": { status: 403 },
      "https://acme.example/b": { status: 403 },
      "https://acme.example/c": { status: 500 },
    });
    const result = await checkAssets(
      [page("https://acme.example/", { anchors: [link("/a"), link("/b"), link("/c")] })],
      ORIGIN,
      d,
    );
    expect(result.linksUnverified?.count).toBe(3);
    expect(result.linksUnverified?.groups.map((g) => [g.reason, g.count])).toEqual([
      ["refused", 2],
      ["server-error", 1],
    ]);
  });

  // The whole point of the split: a healthy site must be able to come back with
  // an empty broken list AND an empty unverified list.
  it("comes back clean for a site whose links and images all answer 200", async () => {
    const result = await checkAssets(
      [page("https://acme.example/", { anchors: [link("/a")], imageSrcs: ["/b.jpg"] })],
      ORIGIN,
      deps({}),
    );
    expect(result.brokenLinks).toEqual([]);
    expect(result.brokenImages).toEqual([]);
    expect(result.linksUnverified).toEqual({ count: 0, groups: [] });
    expect(result.imagesUnverified).toEqual({ count: 0, groups: [] });
  });
});

describe("checkAssets — pacing", () => {
  // The image batch used to start the instant the link batch ended, so the
  // boundary between them was the one unpaced request in the stage — and a
  // burst is exactly what earns the 429 that used to be printed as a defect.
  it("waits between every probe, including the first image after the last link", async () => {
    const waits: number[] = [];
    const d = deps({}, { delayMs: 150, sleep: async (ms) => void waits.push(ms) });
    await checkAssets(
      [
        page("https://acme.example/", {
          anchors: [link("/a"), link("/b")],
          imageSrcs: ["/c.jpg", "/d.jpg"],
        }),
      ],
      ORIGIN,
      d,
    );
    expect(d.asked).toHaveLength(4);
    // Three gaps for four requests: never before the first, always between.
    expect(waits).toEqual([150, 150, 150]);
  });
});
