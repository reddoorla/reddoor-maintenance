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
function stubProbe(table: Record<string, Partial<BasicsProbe>>): BasicsDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    // The crawler-reachability loop paces itself against a stranger's server.
    // Nothing in this suite wants to spend real seconds proving that.
    sleep: async () => {},
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
    const nginx =
      "<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>nginx</center></body></html>";
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
      stubProbe({
        ...HEALTHY,
        "http://example.com/": { status: 200, finalUrl: "http://example.com/" },
      }),
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
      {
        title: "Acme",
        pages: ["https://example.com/a", "https://example.com/b", "https://example.com/c"],
      },
    ]);
  });

  it("ignores pages with no extract rather than counting them as untitled", async () => {
    const result = await checkBasics(
      crawl({
        pages: [
          page("https://example.com/", { title: "Home" }),
          {
            url: "https://example.com/dead",
            status: 500,
            raw: null,
            rendered: null,
            error: "HTTP 500",
          },
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
    let requests = 0;
    const result = await checkBasics(crawl(), {
      ...stubProbe(HEALTHY),
      probeAs: async (url) => {
        requests += 1;
        return { status: 503, finalUrl: url, body: "" };
      },
    });
    expect(result.crawlerReachability?.measured).toBe(false);
    expect(result.crawlerReachability?.blocked).toEqual([]);
    // And it stops there. With no usable control every answer below would be
    // unattributable, so nine more requests at a struggling server buy nothing.
    expect(requests).toBe(1);
    expect(result.crawlerReachability?.agents).toEqual([]);
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

/**
 * Two requests before naming a vendor, and never our own rate limit.
 *
 * `blocked` used to be `status !== browserStatus` from ONE sample, over an
 * unpaced burst of ten full-body homepage GETs. So a 429 we provoked ourselves,
 * or a single flaky 503, was stored as "this named AI crawler is turned away by
 * your site" — a specific, quotable claim about a named vendor, built out of our
 * own traffic.
 */
describe("checkBasics — crawler reach is a measurement, not an accusation", () => {
  /** A UA-aware probe whose answers can differ between successive requests, so
   *  a test can prove the confirming request is actually made and actually
   *  read. Each entry is consumed in order; the last one repeats. */
  function uaSequence(table: Record<string, (number | "throw")[]>): {
    probeAs: (url: string, ua: string) => Promise<BasicsProbe>;
    asked: string[];
  } {
    const seen = new Map<string, number>();
    const asked: string[] = [];
    return {
      asked,
      async probeAs(url, ua) {
        for (const [needle, outcomes] of Object.entries(table)) {
          if (!ua.includes(needle)) continue;
          asked.push(needle);
          const i = Math.min(seen.get(needle) ?? 0, outcomes.length - 1);
          seen.set(needle, i + 1);
          const outcome = outcomes[i]!;
          if (outcome === "throw") throw new Error("ECONNRESET");
          return { status: outcome, finalUrl: url, body: "" };
        }
        asked.push("browser-or-other");
        return { status: 200, finalUrl: url, body: "<html></html>" };
      },
    };
  }

  const paced = (
    probeAs: (url: string, ua: string) => Promise<BasicsProbe>,
    waits: number[],
  ): BasicsDeps => ({
    ...stubProbe(HEALTHY),
    probeAs,
    crawlerDelayMs: 200,
    sleep: async (ms) => void waits.push(ms),
  });

  it("waits between every crawler request, the way the crawl does", async () => {
    const waits: number[] = [];
    const { probeAs } = uaSequence({});
    await checkBasics(crawl(), paced(probeAs, waits));
    // One gap per agent after the first — never before the first, exactly like
    // `pacedEach` in crawl.ts, whose delay this reuses rather than re-invents.
    expect(waits).toHaveLength(CRAWLER_AGENTS.length - 1);
    expect(new Set(waits)).toEqual(new Set([200]));
  });

  it("does not call a 429 a block — that is our request rate, not their policy", async () => {
    const waits: number[] = [];
    const { probeAs, asked } = uaSequence({ ClaudeBot: [429] });
    const result = await checkBasics(crawl(), paced(probeAs, waits));
    const claude = result.crawlerReachability?.agents.find((a) => a.agent === "ClaudeBot");

    expect(claude?.blocked).toBe(false);
    expect(claude?.measured).toBe(false);
    expect(claude?.unverifiedReason).toMatch(/rate/i);
    expect(result.crawlerReachability?.blocked).toEqual([]);
    expect(result.crawlerReachability?.unverified).toEqual(["ClaudeBot"]);
    // And we did not hammer it a second time to find out.
    expect(asked.filter((a) => a === "ClaudeBot")).toHaveLength(1);
  });

  it("does not call a 5xx on one agent a block", async () => {
    const waits: number[] = [];
    const { probeAs } = uaSequence({ GPTBot: [503] });
    const result = await checkBasics(crawl(), paced(probeAs, waits));
    const gpt = result.crawlerReachability?.agents.find((a) => a.agent === "GPTBot");

    expect(gpt?.blocked).toBe(false);
    expect(gpt?.measured).toBe(false);
    expect(result.crawlerReachability?.unverified).toEqual(["GPTBot"]);
  });

  it("will not name a vendor on one sample that the next request contradicts", async () => {
    const waits: number[] = [];
    const { probeAs, asked } = uaSequence({ PerplexityBot: [403, 200] });
    const result = await checkBasics(crawl(), paced(probeAs, waits));
    const perplexity = result.crawlerReachability?.agents.find((a) => a.agent === "PerplexityBot");

    expect(asked.filter((a) => a === "PerplexityBot")).toHaveLength(2);
    expect(perplexity?.blocked).toBe(false);
    expect(perplexity?.measured).toBe(false);
    expect(result.crawlerReachability?.blocked).toEqual([]);
  });

  it("names a vendor only when a second request agrees", async () => {
    const waits: number[] = [];
    const { probeAs, asked } = uaSequence({ ClaudeBot: [403, 403] });
    const result = await checkBasics(crawl(), paced(probeAs, waits));

    expect(asked.filter((a) => a === "ClaudeBot")).toHaveLength(2);
    expect(result.crawlerReachability?.blocked).toEqual(["ClaudeBot"]);
    const claude = result.crawlerReachability?.agents.find((a) => a.agent === "ClaudeBot");
    expect(claude?.measured).toBe(true);
    expect(claude?.status).toBe(403);
    // The confirming request is paced too: one extra gap on top of the per-agent ones.
    expect(waits).toHaveLength(CRAWLER_AGENTS.length);
  });

  it("does not report a block when the two differing answers disagree with each other", async () => {
    const waits: number[] = [];
    const { probeAs } = uaSequence({ CCBot: [403, 404] });
    const result = await checkBasics(crawl(), paced(probeAs, waits));
    const ccbot = result.crawlerReachability?.agents.find((a) => a.agent === "CCBot");

    expect(ccbot?.blocked).toBe(false);
    expect(ccbot?.measured).toBe(false);
    expect(result.crawlerReachability?.blocked).toEqual([]);
  });

  // The check has to be able to come back clean, or it is a complaint.
  it("reports every agent measured and none blocked on a site that serves them all", async () => {
    const waits: number[] = [];
    const { probeAs } = uaSequence({});
    const result = await checkBasics(crawl(), paced(probeAs, waits));

    expect(result.crawlerReachability?.measured).toBe(true);
    expect(result.crawlerReachability?.blocked).toEqual([]);
    expect(result.crawlerReachability?.unverified).toEqual([]);
    expect(result.crawlerReachability?.agents.every((a) => a.measured)).toBe(true);
  });
});

/**
 * Duplicate titles used to be grouped by the RAW crawled URL, while the crawl
 * dedupes candidates only after stripping the hash. A site that serves the same
 * page at `/x` and `/x/` was crawled twice and then told it had two pages
 * sharing a title — a defect that does not exist and a fix nobody can make.
 */
describe("checkBasics — one page is one page", () => {
  it("does not report a trailing-slash pair as two pages sharing a title", async () => {
    const result = await checkBasics(
      crawl({
        pages: [
          page("https://example.com/", { title: "Home" }),
          page("https://example.com/services", { title: "Services" }),
          page("https://example.com/services/", { title: "Services" }),
        ],
      }),
      stubProbe(HEALTHY),
    );
    expect(result.duplicateTitles).toEqual([]);
  });

  it("does not report a www variant of the same path as a second page", async () => {
    const result = await checkBasics(
      crawl({
        pages: [
          page("https://example.com/about", { title: "About" }),
          page("https://www.example.com/about", { title: "About" }),
        ],
      }),
      stubProbe(HEALTHY),
    );
    expect(result.duplicateTitles).toEqual([]);
  });

  it("still reports two genuinely different pages that share a title", async () => {
    const result = await checkBasics(
      crawl({
        pages: [
          page("https://example.com/a", { title: "Acme" }),
          page("https://example.com/a/", { title: "Acme" }),
          page("https://example.com/b", { title: "Acme" }),
        ],
      }),
      stubProbe(HEALTHY),
    );
    expect(result.duplicateTitles).toEqual([
      { title: "Acme", pages: ["https://example.com/a", "https://example.com/b"] },
    ]);
  });

  // Cloudflare's email-protection URL answers 404 and still paints something
  // parseable. It is not one of the prospect's pages, and counting it as one is
  // how our own crawl artefact became their defect.
  it("does not count an infrastructure URL among the pages examined", async () => {
    const result = await checkBasics(
      crawl({
        pages: [
          page("https://example.com/", { title: "Home" }),
          {
            url: "https://example.com/cdn-cgi/l/email-protection",
            status: 404,
            raw: extract({ title: "Home" }),
            rendered: null,
            error: null,
          },
        ],
      }),
      stubProbe(HEALTHY),
    );
    expect(result.altText.pagesExamined).toBe(1);
    expect(result.duplicateTitles).toEqual([]);
  });

  it("does not count a page the server refused among the pages examined", async () => {
    const result = await checkBasics(
      crawl({
        pages: [
          page("https://example.com/", { title: "Home" }),
          {
            url: "https://example.com/members",
            status: 403,
            raw: extract({ title: "Home" }),
            rendered: null,
            error: null,
          },
        ],
      }),
      stubProbe(HEALTHY),
    );
    expect(result.altText.pagesExamined).toBe(1);
    expect(result.duplicateTitles).toEqual([]);
  });
});
