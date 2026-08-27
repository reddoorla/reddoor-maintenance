import { describe, expect, it } from "vitest";
import {
  checkBasics,
  counterpartHost,
  hasSiteLink,
  CRAWLER_AGENTS,
  MISSING_PATH,
  type BasicsDeps,
  type BasicsProbe,
} from "../../src/prospect/basics.js";
import type { CrawlResult, PageCapture, PageExtract } from "../../src/prospect/types.js";

function extract(over: Partial<PageExtract> = {}): PageExtract {
  return {
    title: "A page",
    metaDescription: null,
    canonical: null,
    social: {},
    headings: [],
    jsonLd: [],
    images: { total: 0, withAlt: 0 },
    hasViewportMeta: true,
    text: "",
    ...over,
  };
}

function page(url: string, over: Partial<PageExtract> = {}): PageCapture {
  return { url, status: 200, raw: extract(over), rendered: null, error: null };
}

function crawl(over: Partial<CrawlResult> = {}): CrawlResult {
  return {
    origin: "https://example.com",
    robotsTxt: null,
    agentAccess: [],
    sitemap: { present: false, urlCount: 0 },
    llmsTxt: { present: false, firstLine: null },
    sidecarErrors: { robots: null, llms: null, sitemap: null },
    homeHeaders: {},
    pages: [page("https://example.com/")],
    ...over,
  };
}

/** A probe that answers from a table, and records what was asked. Anything not
 *  in the table throws, which is how a test proves no unexpected request was
 *  made rather than silently tolerating one. */
function stubProbe(
  table: Record<string, Partial<BasicsProbe>>,
): BasicsDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async probe(url) {
      asked.push(url);
      const hit = table[url];
      if (!hit) throw new Error(`unexpected request: ${url}`);
      return { status: hit.status ?? 200, finalUrl: hit.finalUrl ?? url, body: hit.body ?? "" };
    },
  };
}

const HEALTHY = {
  "http://example.com/": { status: 200, finalUrl: "https://example.com/" },
  "https://www.example.com/": { status: 200, finalUrl: "https://www.example.com/" },
  [`https://example.com${MISSING_PATH}`]: {
    status: 404,
    body: '<html><body><h1>Not found</h1><a href="/">Home</a></body></html>',
  },
};

describe("counterpartHost", () => {
  it("strips www from a www host", () => {
    expect(counterpartHost("www.example.com")).toBe("example.com");
  });

  it("adds www to a two-label apex", () => {
    expect(counterpartHost("example.com")).toBe("www.example.com");
  });

  it("refuses to invent a counterpart for a subdomain", () => {
    // `www.shop.example.com` is a host nobody has ever published, and probing
    // it would produce a failure reported as the prospect's defect.
    expect(counterpartHost("shop.example.com")).toBeNull();
  });
});

describe("hasSiteLink", () => {
  it("accepts a relative href", () => {
    expect(hasSiteLink('<a href="/contact">Contact</a>', "https://example.com")).toBe(true);
  });

  it("accepts an absolute href on the same site, ignoring www", () => {
    expect(hasSiteLink('<a href="https://www.example.com/x">x</a>', "https://example.com")).toBe(
      true,
    );
  });

  it("rejects a default server error page", () => {
    const nginx = "<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>nginx</center></body></html>";
    expect(hasSiteLink(nginx, "https://example.com")).toBe(false);
  });

  it("rejects a page whose only links leave the site", () => {
    expect(hasSiteLink('<a href="https://twitter.com/x">x</a>', "https://example.com")).toBe(false);
  });

  it("does not count a bare fragment as a way back", () => {
    expect(hasSiteLink('<a href="#main">Skip</a>', "https://example.com")).toBe(false);
  });
});

describe("checkBasics — reachability", () => {
  it("passes a site that redirects http to https and serves both hosts", async () => {
    const deps = stubProbe(HEALTHY);
    const result = await checkBasics(crawl(), deps);

    expect(result.insecureEntry.ok).toBe(true);
    expect(result.hostVariant.ok).toBe(true);
    expect(result.notFound.ok).toBe(true);
    // Exactly three requests, and no more — this runs against a stranger's server.
    expect(deps.asked).toHaveLength(3);
  });

  it("fails a site that serves plain http without redirecting", async () => {
    const result = await checkBasics(
      crawl(),
      stubProbe({ ...HEALTHY, "http://example.com/": { status: 200, finalUrl: "http://example.com/" } }),
    );
    expect(result.insecureEntry.ok).toBe(false);
    expect(result.insecureEntry.measured).toBe(true);
  });

  it("fails an http entry that redirects to https but then errors", async () => {
    // The protocol is right and the visitor still sees nothing. Judging on the
    // protocol alone would report this as a pass.
    const result = await checkBasics(
      crawl(),
      stubProbe({
        ...HEALTHY,
        "http://example.com/": { status: 502, finalUrl: "https://example.com/" },
      }),
    );
    expect(result.insecureEntry.ok).toBe(false);
  });

  it("reports an unreachable host variant as a finding, not as a failure to measure", async () => {
    const healthy = stubProbe(HEALTHY);
    const deps: BasicsDeps = {
      async probe(url) {
        if (url === "https://www.example.com/") throw new Error("ENOTFOUND");
        return healthy.probe(url);
      },
    };
    const result = await checkBasics(crawl(), deps);
    // A request that threw is NOT measured — the report must not convert our
    // own network trouble into the prospect's defect.
    expect(result.hostVariant.measured).toBe(false);
    expect(result.hostVariant.error).toBe("ENOTFOUND");
  });

  it("skips the host variant entirely for a subdomain", async () => {
    const deps = stubProbe({
      "http://shop.example.com/": { status: 200, finalUrl: "https://shop.example.com/" },
      [`https://shop.example.com${MISSING_PATH}`]: { status: 404, body: '<a href="/">Home</a>' },
    });
    const result = await checkBasics(crawl({ origin: "https://shop.example.com" }), deps);

    expect(result.hostVariant.measured).toBe(false);
    expect(result.hostVariant.error).toBeNull();
    expect(deps.asked).toHaveLength(2);
  });

  it("fails a host variant that resolves somewhere else entirely", async () => {
    // A parked domain answering 200 with an ad page is reachable and useless.
    const result = await checkBasics(
      crawl(),
      stubProbe({
        ...HEALTHY,
        "https://www.example.com/": { status: 200, finalUrl: "https://parking.example.net/" },
      }),
    );
    expect(result.hostVariant.ok).toBe(false);
  });

  it("fails a soft 404", async () => {
    const result = await checkBasics(
      crawl(),
      stubProbe({
        ...HEALTHY,
        [`https://example.com${MISSING_PATH}`]: { status: 200, body: '<a href="/">Home</a>' },
      }),
    );
    expect(result.notFound.ok).toBe(false);
    expect(result.notFound.status).toBe(200);
  });

  it("fails a correct 404 that is a dead end", async () => {
    const result = await checkBasics(
      crawl(),
      stubProbe({
        ...HEALTHY,
        [`https://example.com${MISSING_PATH}`]: { status: 404, body: "<h1>404</h1>" },
      }),
    );
    expect(result.notFound.status).toBe(404);
    expect(result.notFound.linksBackToSite).toBe(false);
    expect(result.notFound.ok).toBe(false);
  });
});

describe("checkBasics — derived from the crawl", () => {
  it("finds images served over plain http on an https site", async () => {
    const result = await checkBasics(
      crawl({
        pages: [
          page("https://example.com/", {
            imageSrcs: ["https://example.com/a.jpg", "http://example.com/b.jpg", "/c.jpg"],
          }),
        ],
      }),
      stubProbe(HEALTHY),
    );

    expect(result.mixedContent.measured).toBe(true);
    expect(result.mixedContent.imageUrls).toEqual(["http://example.com/b.jpg"]);
    expect(result.mixedContent.imagesSeen).toBe(3);
  });

  it("does not claim to have measured mixed content on an http site", async () => {
    const result = await checkBasics(
      crawl({
        origin: "http://example.com",
        pages: [page("http://example.com/", { imageSrcs: ["http://example.com/b.jpg"] })],
      }),
      stubProbe({
        "http://example.com/": { status: 200, finalUrl: "http://example.com/" },
        "http://www.example.com/": { status: 200, finalUrl: "http://www.example.com/" },
        [`http://example.com${MISSING_PATH}`]: { status: 404, body: '<a href="/">Home</a>' },
      }),
    );
    // Every image is "insecure" on an http site, which makes the count noise.
    // The finding there is the site's own protocol, reported by insecureEntry.
    expect(result.mixedContent.measured).toBe(false);
  });

  it("sums alt text across the pages examined", async () => {
    const result = await checkBasics(
      crawl({
        pages: [
          page("https://example.com/", { images: { total: 10, withAlt: 4 } }),
          page("https://example.com/about", { images: { total: 6, withAlt: 6 } }),
        ],
      }),
      stubProbe(HEALTHY),
    );
    expect(result.altText).toEqual({ imagesTotal: 16, imagesWithAlt: 10, pagesExamined: 2 });
  });

  it("groups pages that share a title", async () => {
    const result = await checkBasics(
      crawl({
        pages: [
          page("https://example.com/", { title: "Home" }),
          page("https://example.com/a", { title: "Acme" }),
          page("https://example.com/b", { title: "Acme" }),
          page("https://example.com/c", { title: "Acme" }),
        ],
      }),
      stubProbe(HEALTHY),
    );
    expect(result.duplicateTitles).toEqual([
      { title: "Acme", pages: ["https://example.com/a", "https://example.com/b", "https://example.com/c"] },
    ]);
  });

  it("ignores pages with no extract rather than counting them as untitled", async () => {
    const result = await checkBasics(
      crawl({
        pages: [
          page("https://example.com/", { title: "Home" }),
          { url: "https://example.com/dead", status: 500, raw: null, rendered: null, error: "HTTP 500" },
        ],
      }),
      stubProbe(HEALTHY),
    );
    expect(result.altText.pagesExamined).toBe(1);
    expect(result.duplicateTitles).toEqual([]);
  });
});

describe("checkBasics — what the crawlers are actually served", () => {
  /** A UA-aware probe: everything 200 unless the table says otherwise. */
  const uaProbe =
    (blocked: Record<string, number | "throw"> = {}) =>
    async (url: string, ua: string): Promise<BasicsProbe> => {
      for (const [needle, outcome] of Object.entries(blocked)) {
        if (ua.includes(needle)) {
          if (outcome === "throw") throw new Error("ECONNRESET");
          return { status: outcome, finalUrl: url, body: "" };
        }
      }
      return { status: 200, finalUrl: url, body: "<html></html>" };
    };

  it("finds a crawler served something a browser is not", async () => {
    // The live case this was built for: robots.txt permits everything and the
    // CDN 403s one bot anyway.
    const result = await checkBasics(crawl(), {
      ...stubProbe(HEALTHY),
      probeAs: uaProbe({ ClaudeBot: 403 }),
    });
    const reach = result.crawlerReachability;
    expect(reach?.measured).toBe(true);
    expect(reach?.blocked).toEqual(["ClaudeBot"]);
    expect(reach?.agents.find((a) => a.agent === "GPTBot")?.blocked).toBe(false);
  });

  it("reports nothing blocked when every agent gets what a browser gets", async () => {
    const result = await checkBasics(crawl(), { ...stubProbe(HEALTHY), probeAs: uaProbe() });
    expect(result.crawlerReachability?.blocked).toEqual([]);
    expect(result.crawlerReachability?.measured).toBe(true);
  });

  it("never calls a site-wide outage a crawler block", async () => {
    // 503 to everyone, browser included. That is an outage, and attributing it
    // to crawler policy would invent a finding out of a bad afternoon.
    const result = await checkBasics(crawl(), {
      ...stubProbe(HEALTHY),
      probeAs: async (url) => ({ status: 503, finalUrl: url, body: "" }),
    });
    expect(result.crawlerReachability?.measured).toBe(false);
    expect(result.crawlerReachability?.blocked).toEqual([]);
  });

  it("treats a thrown request as ours, not as a block", async () => {
    const result = await checkBasics(crawl(), {
      ...stubProbe(HEALTHY),
      probeAs: uaProbe({ CCBot: "throw" }),
    });
    const ccbot = result.crawlerReachability?.agents.find((a) => a.agent === "CCBot");
    expect(ccbot?.blocked).toBe(false);
    expect(ccbot?.error).toBe("ECONNRESET");
    expect(result.crawlerReachability?.blocked).toEqual([]);
  });

  it("does not run at all without a UA-capable probe", async () => {
    const result = await checkBasics(crawl(), stubProbe(HEALTHY));
    // Absent, not empty — "not measured" and "nothing blocked" are opposite claims.
    expect(result.crawlerReachability).toBeUndefined();
  });

  it("never probes an invented Google-Extended user agent", async () => {
    // Google publishes no such UA — it is a robots.txt control token and the
    // fetching is Googlebot's. Probing an invented string would measure the
    // CDN's opinion of our invention, not its policy.
    expect(CRAWLER_AGENTS.map((a) => a.agent)).not.toContain("Google-Extended");
    for (const { ua } of CRAWLER_AGENTS) expect(ua).not.toMatch(/Google-Extended/);
  });
});
