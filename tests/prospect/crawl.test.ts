import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  crawlSite,
  pacedEach,
  sameOriginLinks,
  settledOverflow,
  robotsAllowsUs,
  USER_AGENT,
  defaultCrawlDeps,
  MAX_RESPONSE_BYTES,
  ResponseTooLargeError,
  isContactLike,
  isPostSitemap,
  navLinks,
  contactLinks,
  rankCandidates,
  normalizeCandidates,
  budgetedFormProbe,
  toSameOrigin,
  type CrawlDeps,
  type FetchResponse,
} from "../../src/prospect/crawl.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(here, "../fixtures/prospect", name), "utf-8");

/** URL-routed fetch stub: anything not in the map is a 404. */
function stubDeps(
  routes: Record<string, Partial<FetchResponse>>,
  over: Partial<CrawlDeps> = {},
): CrawlDeps {
  return {
    async fetchUrl(url) {
      const hit = routes[url];
      if (!hit) return { status: 404, body: "", headers: {} };
      return {
        status: hit.status ?? 200,
        body: hit.body ?? "",
        headers: hit.headers ?? {},
        ...(hit.url !== undefined ? { url: hit.url } : {}),
      };
    },
    async renderPages(urls) {
      return new Map(urls.map((u) => [u, fixture("rich.html")]));
    },
    maxPages: 20,
    delayMs: 0,
    ...over,
  };
}

const HOME = "https://acme.example/";

/** A home page with no links at all. */
const NO_MENU_HOME = "<html><head><title>Acme</title></head><body><h1>Acme</h1></body></html>";

describe("crawlSite", () => {
  it("captures the raw and rendered extract of every discovered page", async () => {
    const deps = stubDeps({
      [HOME]: { body: fixture("bare.html"), headers: { "x-frame-options": "SAMEORIGIN" } },
      "https://acme.example/services": { body: fixture("bare.html") },
      "https://acme.example/about": { body: fixture("bare.html") },
    });
    const result = await crawlSite(HOME, deps);

    expect(result.origin).toBe("https://acme.example");
    expect(result.pages.map((p) => p.url)).toEqual([HOME]);
    expect(result.pages[0]!.raw!.text).toBe("");
    expect(result.pages[0]!.rendered!.text).toContain("Treasure Valley");
    expect(result.homeHeaders["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("discovers pages from nav links when there is no sitemap", async () => {
    const deps = stubDeps({
      [HOME]: { body: fixture("rich.html") },
      "https://acme.example/services": { body: fixture("rich.html") },
      "https://acme.example/about": { body: fixture("rich.html") },
    });
    const result = await crawlSite(HOME, deps);
    expect(result.pages.map((p) => p.url)).toEqual([
      HOME,
      "https://acme.example/services",
      "https://acme.example/about",
    ]);
    expect(result.sitemap).toEqual({
      present: false,
      urlCount: 0,
      sample: [],
      // No sitemap at all is not a truncated read of one.
      truncated: false,
    });
  });

  it("spends the page budget on distinct paths before query variants", async () => {
    // apple.com handed us /accessibility/features/ five times under ?vision,
    // ?hearing, ?speech and ?cognitive — tab deep-links into one page — plus
    // /airpods-pro/?campaign=true. Six of twenty slots went to two pages.
    const variants = ["?vision", "?hearing", "?speech", "?cognitive"].map(
      (q) => `<url><loc>https://acme.example/features${q}</loc></url>`,
    );
    const others = ["a", "b", "c"].map((n) => `<url><loc>https://acme.example/${n}</loc></url>`);
    const routes: Record<string, Partial<FetchResponse>> = {
      // A home page with no menu, so the sitemap is the only source of pages:
      // a menu's links are read before the sitemap's (rankCandidates).
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/sitemap.xml": {
        body: `<urlset><url><loc>https://acme.example/features</loc></url>${variants.join("")}${others.join("")}</urlset>`,
      },
    };
    for (const u of [
      "features",
      "features?vision",
      "features?hearing",
      "features?speech",
      "features?cognitive",
      "a",
      "b",
      "c",
    ])
      routes[`https://acme.example/${u}`] = { body: fixture("rich.html") };

    const result = await crawlSite(HOME, stubDeps(routes, { maxPages: 4 }));
    expect(result.pages.map((p) => p.url)).toEqual([
      HOME,
      "https://acme.example/features",
      "https://acme.example/a",
      "https://acme.example/b",
    ]);
  });

  it("still crawls a site whose only pages ARE query variants", async () => {
    // A PREFERENCE, never a filter: `?page=2` genuinely is another page, and
    // dropping it would silently remove paginated content from the crawl.
    const locs = [2, 3, 4].map((n) => `<url><loc>https://acme.example/?page=${n}</loc></url>`);
    // A body with no internal links of its own, so the sitemap's query variants
    // are the only candidates left. With a richer home page the distinct paths
    // it links to would rightly take the budget first — that is the preference
    // working, not a variant being dropped.
    const BARE = "<html><head><title>Acme</title></head><body><h1>Acme</h1></body></html>";
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: BARE },
      "https://acme.example/sitemap.xml": { body: `<urlset>${locs.join("")}</urlset>` },
    };
    for (const n of [2, 3, 4]) routes[`https://acme.example/?page=${n}`] = { body: BARE };

    const result = await crawlSite(HOME, stubDeps(routes, { maxPages: 4 }));
    expect(result.pages).toHaveLength(4);
    expect(result.pages.map((p) => p.url)).toContain("https://acme.example/?page=3");
  });

  // REWRITTEN BY THE AUDIT-SYSTEM REVIEW (W3). This test used to be "prefers
  // sitemap URLs and honours maxPages" and asserted exactly [HOME, p0, p1]:
  // the sitemap in file order, ahead of the home page's own menu. That order
  // is the bug (TEC-01): one stored crawl spent all 20 pages on the home page,
  // `/blog/` and 18 posts while the menu linked to the contact page. The menu
  // is now read before the sitemap; the cap and the sitemap counts are as
  // they were.
  it("reads the home page's menu before the sitemap, and honours maxPages", async () => {
    const locs = Array.from(
      { length: 5 },
      (_, i) => `<url><loc>https://acme.example/p${i}</loc></url>`,
    ).join("");
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: fixture("rich.html") },
      "https://acme.example/sitemap.xml": { body: `<urlset>${locs}</urlset>` },
    };
    for (let i = 0; i < 5; i++)
      routes[`https://acme.example/p${i}`] = { body: fixture("rich.html") };
    const result = await crawlSite(HOME, stubDeps(routes, { maxPages: 3 }));

    expect(result.sitemap).toMatchObject({ present: true, urlCount: 5 });
    // The sample is what Tier 2 probes: five URLs is under the cap, so it is
    // the whole sitemap and `sitemap-coverage` may name a page it omits.
    expect(result.sitemap.sample).toHaveLength(5);
    expect(result.pages).toHaveLength(3);
    // rich.html's <nav> links /services and /about.
    expect(result.pages.map((p) => p.url)).toEqual([
      HOME,
      "https://acme.example/services",
      "https://acme.example/about",
    ]);
    // Home, its two menu pages and the five sitemap pages.
    expect(result.selection?.pagesConsidered).toBe(8);
  });

  it("follows one level of sitemap index", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps({
        [HOME]: { body: fixture("rich.html") },
        "https://acme.example/sitemap.xml": {
          body: `<sitemapindex><sitemap><loc>https://acme.example/sm-1.xml</loc></sitemap></sitemapindex>`,
        },
        "https://acme.example/sm-1.xml": {
          body: `<urlset><url><loc>https://acme.example/deep</loc></url></urlset>`,
        },
        "https://acme.example/deep": { body: fixture("rich.html") },
      }),
    );
    expect(result.pages.map((p) => p.url)).toContain("https://acme.example/deep");
  });

  it("reads robots.txt into the agent matrix", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps({
        [HOME]: { body: fixture("rich.html") },
        "https://acme.example/robots.txt": { body: "User-agent: GPTBot\nDisallow: /" },
      }),
    );
    expect(result.robotsTxt).toContain("GPTBot");
    expect(result.agentAccess.find((a) => a.agent === "GPTBot")!.allowed).toBe(false);
  });

  it("ignores an SPA catch-all HTML response for robots.txt and llms.txt", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps({
        [HOME]: { body: fixture("rich.html") },
        "https://acme.example/robots.txt": { body: "<!doctype html><html><body>404</body></html>" },
        "https://acme.example/llms.txt": { body: "<!doctype html><html><body>404</body></html>" },
      }),
    );
    expect(result.robotsTxt).toBeNull();
    expect(result.llmsTxt).toEqual({ present: false, firstLine: null });
  });

  it("records llms.txt when it is real text", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps({
        [HOME]: { body: fixture("rich.html") },
        "https://acme.example/llms.txt": { body: "# Acme Roofing\n\nCommercial roofing in Boise." },
      }),
    );
    expect(result.llmsTxt).toEqual({ present: true, firstLine: "# Acme Roofing" });
  });

  it("drops a page that errors without losing the crawl", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps(
        { [HOME]: { body: fixture("rich.html") } },
        {
          async fetchUrl(url) {
            if (url === HOME) return { status: 200, body: fixture("rich.html"), headers: {} };
            if (url === "https://acme.example/services") throw new Error("ECONNRESET");
            return { status: 404, body: "", headers: {} };
          },
        },
      ),
    );
    const services = result.pages.find((p) => p.url === "https://acme.example/services")!;
    expect(services.error).toContain("ECONNRESET");
    expect(services.raw).toBeNull();
    expect(result.pages[0]!.raw).not.toBeNull();
  });

  it("throws when the homepage itself is unreachable", async () => {
    await expect(crawlSite(HOME, stubDeps({ [HOME]: { status: 503, body: "" } }))).rejects.toThrow(
      /503/,
    );
  });

  it("survives a renderer that fails entirely", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps(
        { [HOME]: { body: fixture("rich.html") } },
        {
          async renderPages() {
            throw new Error("playwright missing");
          },
        },
      ),
    );
    expect(result.pages[0]!.rendered).toBeNull();
    expect(result.pages[0]!.raw).not.toBeNull();
  });

  it("derives the origin from where the homepage actually landed, not the requested URL", async () => {
    // apex -> www is the most common redirect in production hosting. Nav links
    // are already www-absolute (as they would be on the real, redirected page)
    // and the sitemap is fetched from the resolved www origin.
    const wwwHome = `<html><body><a href="https://www.acme.example/services">Services</a></body></html>`;
    const result = await crawlSite(
      HOME,
      stubDeps({
        [HOME]: { body: wwwHome, url: "https://www.acme.example/" },
        "https://www.acme.example/sitemap.xml": {
          body: `<urlset><url><loc>https://www.acme.example/about</loc></url></urlset>`,
        },
        "https://www.acme.example/services": { body: fixture("rich.html") },
        "https://www.acme.example/about": { body: fixture("rich.html") },
      }),
    );

    expect(result.origin).toBe("https://www.acme.example");
    expect(result.pages.map((p) => p.url)).toEqual([
      "https://www.acme.example/",
      "https://www.acme.example/about",
      "https://www.acme.example/services",
    ]);
  });

  it("fetches the homepage exactly once despite a URL fragment", async () => {
    const calls: string[] = [];
    const deps: CrawlDeps = {
      async fetchUrl(url) {
        calls.push(url);
        return { status: 200, body: fixture("bare.html"), headers: {} };
      },
      async renderPages(urls) {
        return new Map(urls.map((u) => [u, fixture("bare.html")]));
      },
      maxPages: 20,
      delayMs: 0,
    };
    await crawlSite("https://acme.example/#top", deps);
    // Sidecars (robots.txt/llms.txt/sitemap.xml) are each fetched once too —
    // only the homepage itself is at risk of the fragment-mismatch double-fetch.
    const homeCalls = calls.filter((u) => u === "https://acme.example/");
    expect(homeCalls).toEqual(["https://acme.example/"]);
  });

  it("retries robots.txt once on a transport error, and records the failure", async () => {
    let robotsAttempts = 0;
    const deps: CrawlDeps = {
      async fetchUrl(url) {
        if (url === "https://acme.example/robots.txt") {
          robotsAttempts++;
          throw new Error("ECONNRESET");
        }
        if (url === HOME) return { status: 200, body: fixture("rich.html"), headers: {} };
        return { status: 404, body: "", headers: {} };
      },
      async renderPages(urls) {
        return new Map(urls.map((u) => [u, fixture("rich.html")]));
      },
      maxPages: 20,
      delayMs: 0,
    };
    const result = await crawlSite(HOME, deps);
    expect(robotsAttempts).toBe(2);
    expect(result.sidecarErrors.robots).toContain("ECONNRESET");
    // A transport failure must never be reported as "no robots.txt".
    expect(result.robotsTxt).toBeNull();
  });

  it("leaves sidecarErrors.robots null when robots.txt is a plain 404", async () => {
    const result = await crawlSite(HOME, stubDeps({ [HOME]: { body: fixture("rich.html") } }));
    expect(result.sidecarErrors).toEqual({ robots: null, llms: null, sitemap: null });
  });

  it("treats a non-HTML content-type as unusable, naming the type", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps({
        [HOME]: { body: fixture("rich.html") },
        "https://acme.example/sitemap.xml": {
          body: `<urlset><url><loc>https://acme.example/brochure</loc></url></urlset>`,
        },
        "https://acme.example/brochure": {
          body: "%PDF-1.4 binary garbage",
          headers: { "content-type": "application/pdf" },
        },
      }),
    );
    const brochure = result.pages.find((p) => p.url === "https://acme.example/brochure")!;
    expect(brochure.raw).toBeNull();
    expect(brochure.error).toBe("not HTML (application/pdf)");
  });

  it("treats a page over the size ceiling as unusable and keeps crawling, rather than losing the run", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps(
        { [HOME]: { body: fixture("rich.html") } },
        {
          async fetchUrl(url) {
            if (url === HOME) return { status: 200, body: fixture("rich.html"), headers: {} };
            if (url === "https://acme.example/services") throw new ResponseTooLargeError(url);
            return { status: 404, body: "", headers: {} };
          },
        },
      ),
    );
    const services = result.pages.find((p) => p.url === "https://acme.example/services")!;
    expect(services.error).toMatch(/large|limit|ceiling|byte/i);
    expect(services.raw).toBeNull();
    expect(result.pages[0]!.raw).not.toBeNull();
  });

  it("treats a sidecar over the size ceiling as simply absent, not a sidecar error", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps(
        { [HOME]: { body: fixture("rich.html") } },
        {
          async fetchUrl(url) {
            if (url === HOME) return { status: 200, body: fixture("rich.html"), headers: {} };
            if (url === "https://acme.example/robots.txt") throw new ResponseTooLargeError(url);
            return { status: 404, body: "", headers: {} };
          },
        },
      ),
    );
    expect(result.robotsTxt).toBeNull();
    expect(result.sidecarErrors.robots).toBeNull();
  });

  it("refuses to crawl when the post-redirect location is a link-local literal address", async () => {
    await expect(
      crawlSite(
        HOME,
        stubDeps({
          [HOME]: { body: fixture("bare.html"), url: "http://169.254.169.254/" },
        }),
      ),
    ).rejects.toThrow(/169\.254\.169\.254|private|internal|loopback|link-local/i);
  });

  it("refuses to crawl when the post-redirect location is a loopback literal address", async () => {
    await expect(
      crawlSite(
        HOME,
        stubDeps({
          [HOME]: { body: fixture("bare.html"), url: "http://127.0.0.1:8080/" },
        }),
      ),
    ).rejects.toThrow(/127\.0\.0\.1|private|internal|loopback/i);
  });

  it("strips userinfo from the URL so credentials never reach the origin, page list, or a fetch call", async () => {
    const calls: string[] = [];
    const deps: CrawlDeps = {
      async fetchUrl(url) {
        calls.push(url);
        return { status: 200, body: fixture("bare.html"), headers: {} };
      },
      async renderPages(urls) {
        return new Map(urls.map((u) => [u, fixture("bare.html")]));
      },
      maxPages: 20,
      delayMs: 0,
    };
    const result = await crawlSite("http://user:hunter2@acme.example/", deps);
    expect(result.origin).toBe("http://acme.example");
    expect(result.pages.map((p) => p.url)).toEqual(["http://acme.example/"]);
    expect(calls.some((u) => u.includes("hunter2"))).toBe(false);
    expect(calls.some((u) => u.includes("user:"))).toBe(false);
  });
});

describe("sameOriginLinks — pathological nesting", () => {
  it("does not throw on markup nested far past ordinary depth, still finding a shallow link", () => {
    const depth = 5000;
    const html =
      '<html><body><a href="/shallow">Shallow</a>' +
      "<div>".repeat(depth) +
      '<a href="/buried">Buried</a>' +
      "</div>".repeat(depth) +
      "</body></html>";
    let links: string[] = [];
    expect(() => {
      links = sameOriginLinks(html, "https://acme.example/");
    }).not.toThrow();
    expect(links).toContain("https://acme.example/shallow");
    expect(links).not.toContain("https://acme.example/buried");
  });
});

describe("defaultCrawlDeps — response size ceiling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names a generous, multi-megabyte ceiling", () => {
    expect(MAX_RESPONSE_BYTES).toBeGreaterThan(1_000_000);
    expect(MAX_RESPONSE_BYTES).toBeLessThan(50_000_000);
  });

  it("refuses early on a declared content-length over the ceiling, without reading the body", async () => {
    let bodyWasRead = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        url: "https://acme.example/",
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-length" ? String(MAX_RESPONSE_BYTES + 1) : null,
          forEach: (cb: (v: string, k: string) => void) => {
            cb(String(MAX_RESPONSE_BYTES + 1), "content-length");
          },
        },
        get body() {
          bodyWasRead = true;
          throw new Error("must not touch the body when content-length already refuses");
        },
        async text() {
          bodyWasRead = true;
          throw new Error("must not read the body when content-length already refuses");
        },
      })) as unknown as typeof fetch,
    );

    const deps = defaultCrawlDeps({ maxPages: 5, delayMs: 0 });
    await expect(deps.fetchUrl("https://acme.example/")).rejects.toThrow(
      /large|limit|ceiling|byte/i,
    );
    expect(bodyWasRead).toBe(false);
  });

  it("guards the actual read when content-length is missing or understates the body", async () => {
    const chunkSize = 1_000_000;
    const chunkCount = Math.ceil((MAX_RESPONSE_BYTES + chunkSize) / chunkSize);
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        url: "https://acme.example/",
        headers: { get: () => null, forEach: () => {} },
        body: {
          getReader: () => ({
            read: async () => {
              reads++;
              if (reads > chunkCount) return { done: true, value: undefined };
              return { done: false, value: new Uint8Array(chunkSize) };
            },
            cancel: async () => {},
          }),
        },
      })) as unknown as typeof fetch,
    );

    const deps = defaultCrawlDeps({ maxPages: 5, delayMs: 0 });
    await expect(deps.fetchUrl("https://acme.example/")).rejects.toThrow(
      /large|limit|ceiling|byte/i,
    );
    expect(reads).toBeLessThan(chunkCount + 1);
  });
});

describe("pacedEach", () => {
  it("waits between calls but not before the first", async () => {
    const calls: string[] = [];
    const sleeps: number[] = [];
    await pacedEach(
      ["a", "b", "c"],
      250,
      async (item) => {
        calls.push(item);
      },
      async (ms) => {
        sleeps.push(ms);
      },
    );
    expect(calls).toEqual(["a", "b", "c"]);
    expect(sleeps).toEqual([250, 250]);
  });

  it("never sleeps when delayMs is 0", async () => {
    const sleeps: number[] = [];
    await pacedEach(
      ["a", "b"],
      0,
      async () => {},
      async (ms) => {
        sleeps.push(ms);
      },
    );
    expect(sleeps).toEqual([]);
  });
});

describe("crawlSite — a hostile sitemap index must not become an SSRF", () => {
  /** Records every URL the crawler asks for, so we can assert on where it went. */
  function recordingDeps(routes: Record<string, Partial<FetchResponse>>) {
    const asked: string[] = [];
    const base = stubDeps(routes);
    return {
      asked,
      deps: {
        ...base,
        async fetchUrl(url: string) {
          asked.push(url);
          return base.fetchUrl(url);
        },
      } as CrawlDeps,
    };
  }

  const INDEX = (locs: string[]) =>
    `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
      .map((l) => `<sitemap><loc>${l}</loc></sitemap>`)
      .join("")}</sitemapindex>`;

  // The threat model is the point: this tool audits sites Reddoor wants to
  // pitch, so the audited site is UNTRUSTED input, and the runner is a GitHub
  // Actions job holding TURSO_AUTH_TOKEN, RESEND_API_KEY and ANTHROPIC_API_KEY.
  it("does not fetch internal addresses a nested <loc> points at", async () => {
    const internal = [
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      "http://127.0.0.1:8080/admin",
      "http://[::1]/",
      "http://localhost/secret",
    ];
    const { asked, deps } = recordingDeps({
      [HOME]: { body: fixture("bare.html") },
      "https://acme.example/sitemap.xml": { body: INDEX(internal) },
    });

    await crawlSite(HOME, deps);

    const reached = asked.filter((u) =>
      internal.some((i) => u.startsWith(i.split("/").slice(0, 3).join("/"))),
    );
    expect(reached).toEqual([]);
  });

  // Off-origin is refused even when the host is perfectly public: a sitemap
  // index legitimately only ever points at sitemaps on its own site, so
  // anything else is either a mistake or an attempt.
  it("does not follow a nested <loc> onto another origin", async () => {
    const { asked, deps } = recordingDeps({
      [HOME]: { body: fixture("bare.html") },
      "https://acme.example/sitemap.xml": { body: INDEX(["https://evil.example/sitemap.xml"]) },
    });

    await crawlSite(HOME, deps);
    expect(asked.filter((u) => u.includes("evil.example"))).toEqual([]);
  });

  // The control: a well-formed same-origin index must still work, or the fix
  // would have closed the hole by breaking the feature.
  it("still follows a same-origin nested sitemap", async () => {
    const { asked, deps } = recordingDeps({
      [HOME]: { body: fixture("bare.html") },
      "https://acme.example/sitemap.xml": {
        body: INDEX(["https://acme.example/sitemap-pages.xml"]),
      },
      "https://acme.example/sitemap-pages.xml": {
        body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://acme.example/a</loc></url></urlset>`,
      },
    });

    const result = await crawlSite(HOME, deps);
    expect(asked).toContain("https://acme.example/sitemap-pages.xml");
    expect(result.sitemap.urlCount).toBeGreaterThan(0);
  });
});

/**
 * #619 added `isSafeNestedSitemap` and applied it INSIDE the loop, after
 * `.slice(0, 3)`. That closes the SSRF, but leaves a quieter failure: three
 * hostile entries at the top of an index consume the whole budget, so the site's
 * real child sitemaps are never fetched and the crawl silently sees fewer pages.
 *
 * Found by a positive control, not by reading the loop.
 */
describe("a hostile sitemap index cannot starve out the real children", () => {
  const INDEX = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap><loc>http://169.254.169.254/latest/meta-data/</loc></sitemap>
    <sitemap><loc>http://127.0.0.1:8080/admin</loc></sitemap>
    <sitemap><loc>https://evil.example/steal</loc></sitemap>
    <sitemap><loc>https://acme.example/sitemap-pages.xml</loc></sitemap>
  </sitemapindex>`;

  function trackingDeps() {
    const fetched: string[] = [];
    const base = stubDeps({
      "https://acme.example/": { body: "<html><body>hi</body></html>" },
      "https://acme.example/sitemap.xml": { body: INDEX },
      "https://acme.example/sitemap-pages.xml": {
        body: `<?xml version="1.0"?><urlset><url><loc>https://acme.example/about</loc></url></urlset>`,
      },
    });
    const deps: CrawlDeps = {
      ...base,
      async fetchUrl(url) {
        fetched.push(url);
        return base.fetchUrl(url);
      },
    };
    return { fetched, deps };
  }

  it("still fetches the legitimate child sitemap sitting behind three hostile ones", async () => {
    const { fetched, deps } = trackingDeps();
    await crawlSite("https://acme.example/", deps);
    expect(fetched).toContain("https://acme.example/sitemap-pages.xml");
  });

  it("and still fetches none of the hostile ones", async () => {
    const { fetched, deps } = trackingDeps();
    await crawlSite("https://acme.example/", deps);
    expect(fetched.filter((u) => !u.startsWith("https://acme.example"))).toEqual([]);
  });

  it("refuses a private ENTRY url before any fetch at all", async () => {
    const { fetched, deps } = trackingDeps();
    await expect(crawlSite("http://169.254.169.254/latest/meta-data/", deps)).rejects.toThrow(
      /private address/,
    );
    expect(fetched).toEqual([]);
  });
});

describe("a URL the server refused is not a page of the site", () => {
  it("keeps no extract for a non-2xx page, even when the browser painted one", () => {
    // The bug this fixes: `rendered` was built from whatever Playwright
    // captured, without consulting the HTTP status, while `raw` was correctly
    // withheld. Cloudflare's email-protection interstitial answers 404 and
    // still paints — so every cross-page check that asked "is there an
    // extract?" admitted it, and it became the only dead end and the only
    // off-template page found anywhere in the stored corpus.
    const deps = stubDeps(
      {
        [HOME]: { body: '<html><body><a href="/gone">Gone</a></body></html>' },
        "https://acme.example/gone": { status: 404, body: "<html><body>Not found</body></html>" },
      },
      {
        async renderPages(urls) {
          return new Map(urls.map((u) => [u, "<html><body><p>painted anyway</p></body></html>"]));
        },
      },
    );

    return crawlSite(HOME, deps).then((crawl) => {
      const gone = crawl.pages.find((p) => p.url === "https://acme.example/gone");
      expect(gone?.status).toBe(404);
      expect(gone?.raw).toBeNull();
      expect(gone?.rendered).toBeNull();
    });
  });

  it("never follows a link into CDN or CMS infrastructure", () => {
    // /cdn-cgi/l/email-protection is linked from the obfuscated mailto that
    // Cloudflare injects, so a crawler finds it on sites that never chose it.
    const deps = stubDeps({
      [HOME]: {
        body:
          '<html><body><a href="/cdn-cgi/l/email-protection">email</a>' +
          '<a href="/wp-admin/admin-ajax.php">ajax</a>' +
          '<a href="/about">About</a></body></html>',
      },
      "https://acme.example/about": { body: "<html><body>About us</body></html>" },
    });

    return crawlSite(HOME, deps).then((crawl) => {
      const urls = crawl.pages.map((p) => p.url);
      expect(urls).not.toContain("https://acme.example/cdn-cgi/l/email-protection");
      expect(urls).not.toContain("https://acme.example/wp-admin/admin-ajax.php");
      expect(urls).toContain("https://acme.example/about");
    });
  });

  it("crawls one page once when the site links to it both with and without a trailing slash", () => {
    // Crawled twice, it was then reported as two pages sharing a title — a
    // duplicate-title defect that does not exist and a fix nobody can make.
    const deps = stubDeps({
      [HOME]: {
        body:
          '<html><body><a href="/services">Services</a>' +
          '<a href="/services/">Services again</a></body></html>',
      },
      "https://acme.example/services": {
        body: "<html><head><title>Services</title></head><body>x</body></html>",
      },
      "https://acme.example/services/": {
        body: "<html><head><title>Services</title></head><body>x</body></html>",
      },
    });

    return crawlSite(HOME, deps).then((crawl) => {
      const services = crawl.pages.filter((p) => /\/services\/?$/.test(p.url));
      expect(services).toHaveLength(1);
    });
  });
});

describe("settledOverflow — the mobile measurement waits for the reflow", () => {
  /** A page whose overflow reads down a scripted sequence, then holds. */
  const scripted = (values: number[]) => {
    let i = 0;
    return () => Promise.resolve(values[Math.min(i++, values.length - 1)]!);
  };
  const noWait = () => Promise.resolve();

  it("reports the settled number, not the transient", async () => {
    // Reproduced against apple.com's AirPods comparison page, resized from 1280
    // to 375: 303px at 250ms, 26px at 500ms, 0px from 1000ms on. Loaded at 375
    // it never overflows at all. The old code sampled once at 250ms and
    // reported 303 — "your page scrolls sideways on a phone" about a page that
    // does not.
    expect(await settledOverflow(scripted([303, 26, 0, 0]), noWait)).toBe(0);
  });

  it("reports a real overflow that holds still", async () => {
    expect(await settledOverflow(scripted([287, 287]), noWait)).toBe(287);
  });

  it("costs a settled page one extra read and no more", async () => {
    let reads = 0;
    const read = () => {
      reads += 1;
      return Promise.resolve(0);
    };
    await settledOverflow(read, noWait);
    expect(reads).toBe(2);
  });

  it("reports nothing rather than a transient when the page never settles", async () => {
    // A number we do not trust must not become a finding about somebody's site.
    let n = 0;
    const jitter = () => Promise.resolve(100 + n++);
    const wait = () => Promise.resolve();
    expect(await settledOverflow(jitter, wait, -1)).toBe(0);
  });
});

describe("robotsAllowsUs — our own crawler obeying the file", () => {
  // Two different questions live in this module and only one was being asked.
  // `evaluateAgentAccess` reports whether an owner turns away GPTBot. This is
  // whether WE may fetch a path — and until now we fetched whatever we liked,
  // which is not a defensible position for a tool that grades sites on crawler
  // access.
  const VIGET = [
    "User-agent: *",
    "Disallow: /admin",
    "Disallow: /exhibit",
    "Disallow: /login",
    "Disallow: /search?q=*",
    "Disallow: /*?*ref=*",
  ].join("\n");

  it("honours the real disallow list of the first site we pointed this at", () => {
    const may = (u: string) => robotsAllowsUs(VIGET, u, USER_AGENT);
    expect(may("https://www.viget.com/")).toBe(true);
    expect(may("https://www.viget.com/contact/")).toBe(true);
    expect(may("https://www.viget.com/articles/")).toBe(true);
    expect(may("https://www.viget.com/admin")).toBe(false);
    expect(may("https://www.viget.com/exhibit/whatever")).toBe(false);
    expect(may("https://www.viget.com/login")).toBe(false);
    expect(may("https://www.viget.com/search?q=roofing")).toBe(false);
    // `/*?*ref=*` — a wildcard in the middle, matched against path + query.
    expect(may("https://www.viget.com/articles/x?ref=twitter")).toBe(false);
  });

  it("treats no robots.txt as permission, because absence is not refusal", () => {
    expect(robotsAllowsUs(null, "https://acme.example/anything", USER_AGENT)).toBe(true);
  });

  it("takes the longest match, so an Allow can carve out of a Disallow", () => {
    const txt = "User-agent: *\nDisallow: /blog\nAllow: /blog/public";
    expect(robotsAllowsUs(txt, "https://acme.example/blog/secret", USER_AGENT)).toBe(false);
    expect(robotsAllowsUs(txt, "https://acme.example/blog/public/post", USER_AGENT)).toBe(true);
  });

  it("prefers a group that names us over the wildcard group", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: ReddoorAudit\nDisallow:";
    expect(robotsAllowsUs(txt, "https://acme.example/page", USER_AGENT)).toBe(true);
  });

  it("obeys a site-wide block aimed at everyone", () => {
    expect(
      robotsAllowsUs("User-agent: *\nDisallow: /", "https://acme.example/page", USER_AGENT),
    ).toBe(false);
  });
});

describe("the crawl does not fetch a disallowed path", () => {
  it("skips it and spends the budget elsewhere", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      // No menu, so the three sitemap URLs are the only candidates for the two
      // seats after the home page (a menu is read before the sitemap).
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/robots.txt": { body: "User-agent: *\nDisallow: /private" },
      "https://acme.example/sitemap.xml": {
        body: `<urlset>${["/private/a", "/open-b", "/open-c"]
          .map((p) => `<url><loc>https://acme.example${p}</loc></url>`)
          .join("")}</urlset>`,
      },
    };
    for (const p of ["/private/a", "/open-b", "/open-c"])
      routes[`https://acme.example${p}`] = { body: fixture("rich.html") };

    const result = await crawlSite(HOME, stubDeps(routes, { maxPages: 3 }));
    const urls = result.pages.map((p) => p.url);
    expect(urls).not.toContain("https://acme.example/private/a");
    expect(urls).toContain("https://acme.example/open-b");
  });
});

describe("which pages the 20 seats go to (W3)", () => {
  /** A home page with no menu and no links, so ranking alone is on trial. */
  const BARE = "<html><head><title>Acme</title></head><body><h1>Acme</h1></body></html>";
  const page = { body: BARE };

  /** 95 URLs: 18 dated posts first, then 75 more posts, then the pages a buyer
   *  reads — the shape of a CMS sitemap sorted by publish date. */
  function ninetyFive(host = "https://acme.example"): string[] {
    const dated = Array.from(
      { length: 18 },
      (_, i) => `${host}/20${10 + (i % 14)}/0${1 + (i % 9)}/post-${i}/`,
    );
    const more = Array.from({ length: 72 }, (_, i) => `${host}/news/2019/item-${i}/`);
    const pages = [
      "/services/",
      "/services/tenant-screening/",
      "/faqs/",
      "/about/",
      "/contact/",
    ].map((p) => `${host}${p}`);
    return [...dated, ...more, ...pages];
  }
  const urlset = (urls: string[]): string =>
    `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;

  it("reads the service and contact pages of a 95-URL sitemap that lists 18 dated posts first", async () => {
    const urls = ninetyFive();
    expect(urls).toHaveLength(95);
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: page,
      "https://acme.example/sitemap.xml": { body: urlset(urls) },
    };
    for (const u of urls) routes[u] = page;
    const result = await crawlSite(HOME, stubDeps(routes));
    const chosen = result.pages.map((p) => p.url);

    expect(chosen).toHaveLength(20);
    expect(chosen).toContain("https://acme.example/services/");
    expect(chosen).toContain("https://acme.example/contact/");
    expect(chosen).toContain("https://acme.example/services/tenant-screening/");
    expect(result.sitemap.urlCount).toBe(95);
    expect(result.selection?.pagesConsidered).toBe(96);
  });

  it("reads a sitemap written on http://www. for an https:// apex site as this site's pages", async () => {
    const urls = ["/", "/about", "/services", "/contact"].map((p) => `http://www.acme.example${p}`);
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: page,
      "https://acme.example/sitemap.xml": { body: urlset(urls) },
      "https://acme.example/about": page,
      "https://acme.example/services": page,
      "https://acme.example/contact": page,
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    const chosen = result.pages.map((p) => p.url);

    expect(chosen.length).toBeGreaterThan(1);
    expect(chosen).toContain("https://acme.example/services");
    // Fetched at the address the site answers on, never the sitemap's.
    expect(chosen.every((u) => u.startsWith("https://acme.example/"))).toBe(true);
    // And the mismatch is recorded as a finding of its own.
    expect(result.selection?.sitemapOffOrigin).toBe(4);
    expect(result.selection?.sitemapOffOriginExample).toBe("http://www.acme.example/");
  });

  it("does not take another subdomain for the same site", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: page,
      "https://acme.example/sitemap.xml": {
        body: urlset(["https://shop.acme.example/cart", "https://acme.example/about"]),
      },
      "https://acme.example/about": page,
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.pages.map((p) => p.url)).toEqual([HOME, "https://acme.example/about"]);
    expect(result.selection?.sitemapOffOrigin).toBe(0);
  });

  it("reads a contact page the home page links to seven times, though the sitemap lists it last", async () => {
    const urls = ninetyFive();
    const links = Array.from(
      { length: 7 },
      (_, i) =>
        `<p><a href="/contact/">${["CONTACT", "Contact Acme", "GET STARTED TODAY", "LET’S TALK", "Write to us", "Reach us", "Here"][i]}</a></p>`,
    ).join("");
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: `<html><body><h1>Acme</h1>${links}</body></html>` },
      "https://acme.example/sitemap.xml": { body: urlset(urls) },
    };
    for (const u of urls) routes[u] = page;
    const result = await crawlSite(HOME, stubDeps(routes, { maxPages: 3 }));
    // Three seats: the home page, the contact page its links name, and the
    // shallowest sitemap page.
    expect(result.pages.map((p) => p.url)).toEqual([
      HOME,
      "https://acme.example/contact/",
      "https://acme.example/services/",
    ]);
  });

  it("finds the sitemap robots.txt names, before /sitemap.xml", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: page,
      "https://acme.example/robots.txt": {
        body: "User-agent: *\nAllow: /\nSitemap: https://www.acme.example/sitemap.php\n",
      },
      "https://acme.example/sitemap.php": { body: urlset(["https://acme.example/projects"]) },
      "https://acme.example/projects": page,
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.sitemap).toMatchObject({ present: true, urlCount: 1 });
    expect(result.selection?.sitemapSource).toBe("https://acme.example/sitemap.php");
    expect(result.pages.map((p) => p.url)).toContain("https://acme.example/projects");
  });

  it("falls back to /sitemap_index.xml and then /wp-sitemap.xml", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: page,
      "https://acme.example/wp-sitemap.xml": { body: urlset(["https://acme.example/team"]) },
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.sitemap.present).toBe(true);
    expect(result.selection?.sitemapSource).toBe("https://acme.example/wp-sitemap.xml");
    expect(result.sidecarErrors.sitemap).toBeNull();
  });

  it("records no sitemap, and no sitemap error, when none of the addresses has one", async () => {
    const result = await crawlSite(HOME, stubDeps({ [HOME]: page }));
    expect(result.sitemap.present).toBe(false);
    expect(result.selection?.sitemapSource).toBeNull();
    expect(result.sidecarErrors.sitemap).toBeNull();
  });

  it("reads page-sitemap pages before post-sitemap posts whose paths carry no date", async () => {
    const posts = Array.from({ length: 30 }, (_, i) => `https://acme.example/a-post-${i}/`);
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: page,
      "https://acme.example/sitemap.xml": {
        body: `<sitemapindex><sitemap><loc>https://acme.example/post-sitemap.xml</loc></sitemap><sitemap><loc>https://acme.example/page-sitemap.xml</loc></sitemap></sitemapindex>`,
      },
      "https://acme.example/post-sitemap.xml": { body: urlset(posts) },
      "https://acme.example/page-sitemap.xml": {
        body: urlset(["https://acme.example/services/", "https://acme.example/contact/"]),
      },
    };
    const result = await crawlSite(HOME, stubDeps(routes, { maxPages: 3 }));
    expect(result.pages.map((p) => p.url)).toEqual([
      HOME,
      "https://acme.example/services/",
      "https://acme.example/contact/",
    ]);
  });

  it("reads tag, category and author archives after the pages they list", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: page,
      "https://acme.example/sitemap.xml": {
        body: urlset([
          "https://acme.example/tag/news/",
          "https://acme.example/category/blog/",
          "https://acme.example/author/ann/",
          "https://acme.example/services/",
        ]),
      },
    };
    const result = await crawlSite(HOME, stubDeps(routes, { maxPages: 2 }));
    expect(result.pages.map((p) => p.url)).toEqual([HOME, "https://acme.example/services/"]);
  });
});

describe("isContactLike", () => {
  it.each([
    ["https://acme.example/contact", ""],
    ["https://acme.example/contact-us/", ""],
    ["https://acme.example/request-demo", ""],
    ["https://acme.example/get-a-quote", ""],
    ["https://acme.example/book-now", ""],
    ["https://acme.example/get-started", ""],
    ["https://acme.example/start", "Get started"],
    ["https://acme.example/hello", "LET’S TALK"],
  ])("%s %s is contact-like", (href, text) => {
    expect(isContactLike(href, text)).toBe(true);
  });

  it.each([
    ["https://acme.example/ebook", ""],
    ["https://acme.example/facebook", ""],
    ["https://acme.example/books", ""],
    ["https://acme.example/blog/a-post", "Read more"],
    [
      "https://acme.example/blog/a-post",
      "A long paragraph that happens to be a link and mentions how to contact us",
    ],
  ])("%s %s is not", (href, text) => {
    expect(isContactLike(href, text)).toBe(false);
  });
});

// W3 review round 1 (maintenance findings). Each block names the finding it pins.
describe("W3 review round 1 — the crawl's address and sitemap rules", () => {
  const BARE = "<html><head><title>Acme</title></head><body><h1>Acme</h1></body></html>";
  const page = { body: BARE };
  const urlset = (urls: string[]): string =>
    `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;

  it("MAJOR port: a site on a non-default port is crawled, and its own pages are its own", async () => {
    const PORTED = "https://acme.example:8443/";
    const routes: Record<string, Partial<FetchResponse>> = {
      [PORTED]: { body: fixture("rich.html") },
      "https://acme.example:8443/services": { body: fixture("rich.html") },
      "https://acme.example:8443/about": { body: fixture("rich.html") },
    };
    const result = await crawlSite(PORTED, stubDeps(routes));
    expect(result.pages.map((p) => p.url)).toEqual([
      PORTED,
      "https://acme.example:8443/services",
      "https://acme.example:8443/about",
    ]);
    expect(toSameOrigin("https://acme.example:8443/x", "https://acme.example:8443")).toBe(
      "https://acme.example:8443/x",
    );
    // A different port is a different server, not a spelling of this one.
    expect(toSameOrigin("https://acme.example/x", "https://acme.example:8443")).toBeNull();
    expect(toSameOrigin("https://acme.example:9000/x", "https://acme.example")).toBeNull();
  });

  it("MAJOR port: a sitemap on http://www. for an https://host:8443 site is read onto that port", () => {
    expect(toSameOrigin("http://www.acme.example:8443/about", "https://acme.example:8443")).toBe(
      "https://acme.example:8443/about",
    );
  });

  it("MAJOR WP core: wp-sitemap-posts-page and -product are not post sitemaps; posts-post is", () => {
    expect(isPostSitemap("https://acme.example/wp-sitemap-posts-page-1.xml")).toBe(false);
    expect(isPostSitemap("https://acme.example/wp-sitemap-posts-product-1.xml")).toBe(false);
    expect(isPostSitemap("https://acme.example/wp-sitemap-posts-post-1.xml")).toBe(true);
    // Yoast and the blog patterns still hold.
    expect(isPostSitemap("https://acme.example/post-sitemap.xml")).toBe(true);
    expect(isPostSitemap("https://acme.example/blog-sitemap2.xml")).toBe(true);
    expect(isPostSitemap("https://acme.example/page-sitemap.xml")).toBe(false);
  });

  it("MAJOR WP core: WordPress core pages are read before its posts", async () => {
    const posts = Array.from({ length: 30 }, (_, i) => `https://acme.example/wp-post-${i}/`);
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: page,
      "https://acme.example/wp-sitemap.xml": {
        body: `<sitemapindex><sitemap><loc>https://acme.example/wp-sitemap-posts-post-1.xml</loc></sitemap><sitemap><loc>https://acme.example/wp-sitemap-posts-page-1.xml</loc></sitemap></sitemapindex>`,
      },
      "https://acme.example/wp-sitemap-posts-post-1.xml": { body: urlset(posts) },
      "https://acme.example/wp-sitemap-posts-page-1.xml": {
        body: urlset(["https://acme.example/services/", "https://acme.example/contact/"]),
      },
    };
    const result = await crawlSite(HOME, stubDeps(routes, { maxPages: 3 }));
    expect(result.pages.map((p) => p.url)).toEqual([
      HOME,
      "https://acme.example/services/",
      "https://acme.example/contact/",
    ]);
  });

  it("MAJOR sitemap fetches: robots.txt names 12 sitemaps, and at most 5 of them plus the 3 defaults are requested", async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `Sitemap: https://acme.example/s${i}.xml`);
    const requested: string[] = [];
    const deps = stubDeps({
      [HOME]: page,
      "https://acme.example/robots.txt": { body: `User-agent: *\n${lines.join("\n")}\n` },
    });
    const fetchUrl = deps.fetchUrl;
    deps.fetchUrl = async (url) => {
      requested.push(url);
      return fetchUrl(url);
    };
    await crawlSite(HOME, deps);
    const sitemapRequests = requested.filter((u) => /\.xml/.test(u));
    expect(sitemapRequests.length).toBeLessThanOrEqual(8);
    expect(sitemapRequests.filter((u) => /\/s\d+\.xml$/.test(u)).length).toBeLessThanOrEqual(5);
  });

  it("MAJOR sitemap fetches: a gzipped sitemap a robots line names is never requested", async () => {
    const requested: string[] = [];
    const deps = stubDeps({
      [HOME]: page,
      "https://acme.example/robots.txt": {
        body: "User-agent: *\nSitemap: https://acme.example/sitemap.xml.gz\n",
      },
    });
    const fetchUrl = deps.fetchUrl;
    deps.fetchUrl = async (url) => {
      requested.push(url);
      return fetchUrl(url);
    };
    await crawlSite(HOME, deps);
    expect(requested.some((u) => u.endsWith(".gz"))).toBe(false);
  });

  it("MAJOR sitemap fetches: the sitemap requests wait delayMs between them, as the page fetches do", async () => {
    const lines = Array.from({ length: 4 }, (_, i) => `Sitemap: https://acme.example/g${i}.xml`);
    const deps = stubDeps(
      {
        [HOME]: page,
        "https://acme.example/robots.txt": { body: `User-agent: *\n${lines.join("\n")}\n` },
      },
      { delayMs: 40 },
    );
    const started = Date.now();
    await crawlSite(HOME, deps);
    // Four named addresses and three defaults: seven requests, six gaps.
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  });

  it("MAJOR sitemap-same-host: a sitemap that answers 503 at an address the owner named is an error, not absence", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps({
        [HOME]: page,
        "https://acme.example/robots.txt": {
          body: "User-agent: *\nSitemap: https://acme.example/custom-map.xml\n",
        },
        "https://acme.example/custom-map.xml": { status: 503, body: "" },
      }),
    );
    expect(result.sitemap.present).toBe(false);
    expect(result.sidecarErrors.sitemap).not.toBeNull();
  });

  it("MAJOR sitemap-same-host: an entry that redirected away from a host is judged on that host, and the https address on an http entry is not a fault", async () => {
    // The entry is http://acme.example, the site serves both schemes, and its
    // sitemap lists https. Nothing says which the owner uses: not counted as a fault.
    const httpEntry = await crawlSite(
      "http://acme.example/",
      stubDeps({
        "http://acme.example/": page,
        "http://acme.example/sitemap.xml": {
          body: urlset(["https://acme.example/", "https://acme.example/about"]),
        },
        "https://acme.example/about": page,
      }),
    );
    expect(httpEntry.origin).toBe("http://acme.example");
    expect(httpEntry.selection?.sitemapOffOrigin).toBe(0);
    expect(httpEntry.selection?.sitemapAmbiguousOrigin).toBe(2);
    // And the https address is kept, never rewritten down to http.
    expect(httpEntry.pages.map((p) => p.url)).toContain("https://acme.example/about");

    // Entry on www., homepage redirected to the apex: a sitemap still listing the
    // www. host is a fault the site can be shown to have.
    const redirected = await crawlSite(
      "https://www.acme.example/",
      stubDeps({
        "https://www.acme.example/": { body: BARE, url: "https://acme.example/" },
        "https://acme.example/sitemap.xml": {
          body: urlset(["https://www.acme.example/a", "https://acme.example/b"]),
        },
        "https://acme.example/b": page,
      }),
    );
    expect(redirected.selection?.sitemapOffOrigin).toBe(1);
    expect(redirected.selection?.sitemapAmbiguousOrigin).toBe(0);
  });

  it("MINOR tests: robots.txt names a sitemap and /sitemap.xml also exists, so the named one is read", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps({
        [HOME]: page,
        "https://acme.example/robots.txt": {
          body: "User-agent: *\nSitemap: https://acme.example/custom.xml\n",
        },
        "https://acme.example/custom.xml": { body: urlset(["https://acme.example/one"]) },
        "https://acme.example/sitemap.xml": { body: urlset(["https://acme.example/two"]) },
      }),
    );
    expect(result.selection?.sitemapSource).toBe("https://acme.example/custom.xml");
    expect(result.sitemap.urlCount).toBe(1);
  });

  it("MINOR tests: /sitemap_index.xml alone is found", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps({
        [HOME]: page,
        "https://acme.example/sitemap_index.xml": {
          body: urlset(["https://acme.example/team"]),
        },
      }),
    );
    expect(result.selection?.sitemapSource).toBe("https://acme.example/sitemap_index.xml");
    expect(result.sitemap.present).toBe(true);
  });

  it("MINOR tests: a transport error on one candidate does not hide a sitemap found at another", async () => {
    const deps = stubDeps({
      [HOME]: page,
      "https://acme.example/robots.txt": {
        body: "User-agent: *\nSitemap: https://acme.example/broken.xml\n",
      },
      "https://acme.example/sitemap.xml": { body: urlset(["https://acme.example/one"]) },
    });
    const fetchUrl = deps.fetchUrl;
    deps.fetchUrl = async (url) => {
      if (url === "https://acme.example/broken.xml") throw new Error("socket hang up");
      return fetchUrl(url);
    };
    const result = await crawlSite(HOME, deps);
    expect(result.sitemap.present).toBe(true);
    expect(result.selection?.sitemapSource).toBe("https://acme.example/sitemap.xml");
    expect(result.sidecarErrors.sitemap).toBeNull();
  });

  it("MINOR tests: when every candidate fails in transport, the sitemap error is recorded", async () => {
    const deps = stubDeps({ [HOME]: page });
    const fetchUrl = deps.fetchUrl;
    deps.fetchUrl = async (url) => {
      if (url.includes("sitemap")) throw new Error("socket hang up");
      return fetchUrl(url);
    };
    const result = await crawlSite(HOME, deps);
    expect(result.sitemap.present).toBe(false);
    expect(result.sidecarErrors.sitemap).toBe("socket hang up");
  });

  it("MINOR footer navs: a footer's own <nav> is not the menu and does not rank ahead of the page's links", () => {
    const html = `<html><body><header><nav><a href="/services">Services</a></nav></header>
      <footer><nav><a href="/legal">Legal</a><a href="/sitemap-page">Sitemap</a></nav></footer></body></html>`;
    expect(navLinks(html, HOME)).toEqual(["https://acme.example/services"]);
  });

  it("NIT: a year as a whole path segment, and an archive anywhere in the path, rank last", () => {
    const ranked = rankCandidates({
      home: HOME,
      nav: [],
      contact: [],
      sitemap: [
        "https://acme.example/2019/",
        "https://acme.example/blog/tag/x/",
        "https://acme.example/a/b/c/d/",
      ],
      bodyLinks: [],
    });
    expect(ranked.slice(1)).toEqual([
      "https://acme.example/a/b/c/d/",
      "https://acme.example/2019/",
      "https://acme.example/blog/tag/x/",
    ]);
  });
});

describe("W3 review round 1 — isContactLike false positives and verb phrases", () => {
  it.each([
    ["https://acme.example/events/schedule", ""],
    ["https://acme.example/book/my-novel", ""],
    ["https://acme.example/work/demo-reel", ""],
    ["https://acme.example/blog/how-to-book-a-trip", ""],
    ["https://acme.example/reviews", "Book review"],
    ["https://acme.example/calendar", "View schedule"],
  ])("%s %s is not a contact link", (href, text) => {
    expect(isContactLike(href, text)).toBe(false);
  });

  it.each([
    ["https://acme.example/book", ""],
    ["https://acme.example/schedule-a-call", ""],
    ["https://acme.example/services/quote", ""],
    ["https://acme.example/request-demo", ""],
    ["https://acme.example/x", "Book a demo"],
    ["https://acme.example/x", "Get a free quote"],
  ])("%s %s is a contact link", (href, text) => {
    expect(isContactLike(href, text)).toBe(true);
  });
});

// W3 review round 2. Each block names the finding it pins.
describe("W3 review round 2 — the same site is the same site, whatever its scheme", () => {
  const BARE = "<html><head><title>Acme</title></head><body><h1>Acme</h1></body></html>";
  const urlset = (urls: string[]): string =>
    `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;

  it("MAJOR (a): a sitemap index on an http site may list its child on https, and the child is read", async () => {
    const HTTP_HOME = "http://acme.example/";
    const deps = stubDeps({
      [HTTP_HOME]: { body: BARE },
      "http://acme.example/sitemap.xml": {
        body: `<sitemapindex><sitemap><loc>https://acme.example/page-sitemap.xml</loc></sitemap></sitemapindex>`,
      },
      "https://acme.example/page-sitemap.xml": {
        body: urlset(["https://acme.example/services", "https://acme.example/about"]),
      },
    });
    const result = await crawlSite(HTTP_HOME, deps);
    expect(result.sitemap).toEqual({
      present: true,
      urlCount: 2,
      sample: ["https://acme.example/services", "https://acme.example/about"],
      truncated: false,
    });
  });

  it("MAJOR (a): a robots-named https sitemap on an http site is read, not dropped", async () => {
    const HTTP_HOME = "http://acme.example/";
    const deps = stubDeps({
      [HTTP_HOME]: { body: BARE },
      "http://acme.example/robots.txt": {
        body: "User-agent: *\nAllow: /\nSitemap: https://acme.example/sitemap-main.xml",
      },
      "https://acme.example/sitemap-main.xml": { body: urlset(["https://acme.example/services"]) },
    });
    const result = await crawlSite(HTTP_HOME, deps);
    expect(result.sitemap.present).toBe(true);
    expect(result.sitemap.urlCount).toBe(1);
    expect(result.selection?.sitemapSource).toBe("https://acme.example/sitemap-main.xml");
  });

  it("MAJOR (b): an https copy of a page already listed on http takes no second seat", () => {
    const HTTP = "http://acme.example/";
    const ranked = rankCandidates({
      home: HTTP,
      nav: ["http://acme.example/about"],
      contact: [],
      sitemap: ["https://acme.example/about", "https://acme.example/"],
      bodyLinks: [],
    });
    const { chosen, considered } = normalizeCandidates(ranked, "http://acme.example", 20, null);
    expect(chosen).toEqual(["http://acme.example/", "http://acme.example/about"]);
    expect(considered).toBe(2);
  });

  it("MAJOR (b): a www. copy of a page takes no second seat either", () => {
    const { chosen } = normalizeCandidates(
      ["https://acme.example/services", "https://www.acme.example/services/"],
      "https://acme.example",
      20,
      null,
    );
    expect(chosen).toEqual(["https://acme.example/services"]);
  });
});

describe("W3 review round 2 — contact-like links", () => {
  it.each([
    ["https://acme.example/contact-sales", ""],
    ["https://acme.example/contact-form", ""],
    ["https://acme.example/contact-page", ""],
    ["https://acme.example/contact-information", ""],
    ["https://acme.example/x", "Contact Sales"],
    ["https://acme.example/x", "Contact our team"],
    ["https://acme.example/x", "Free consultation"],
  ])("MAJOR (2): %s %s is a contact link", (href, text) => {
    expect(isContactLike(href, text)).toBe(true);
  });
});

describe("W3 review round 2 — a sitemap the owner named that we could not read", () => {
  it("MAJOR (3): a robots-named sitemap that 404s at our origin is recorded as a sidecar error, not as absent", async () => {
    const deps = stubDeps({
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/robots.txt": {
        body: "User-agent: *\nAllow: /\nSitemap: https://www.acme.example/sitemap-main.xml",
      },
    });
    const result = await crawlSite(HOME, deps);
    expect(result.sitemap.present).toBe(false);
    expect(result.sidecarErrors.sitemap).not.toBeNull();
  });

  it("a CMS default that 404s, with nothing named in robots, is still plain absence", async () => {
    const deps = stubDeps({ [HOME]: { body: NO_MENU_HOME } });
    const result = await crawlSite(HOME, deps);
    expect(result.sitemap.present).toBe(false);
    expect(result.sidecarErrors.sitemap).toBeNull();
  });
});

describe("W3 review round 2 — a mega-menu does not push the contact page out of the budget", () => {
  const products = Array.from(
    { length: 30 },
    (_, i) => `<a href="/product-${i}">Product ${i}</a>`,
  ).join("");
  const MENU_HOME = `<html><body><header><nav>${products}<a href="/contact">Contact</a></nav></header>
    <main><h1>Acme</h1></main></body></html>`;

  it("MAJOR (4): the contact link ranks right after the home page, ahead of the 30 product links", () => {
    const ranked = rankCandidates({
      home: HOME,
      nav: navLinks(MENU_HOME, HOME),
      contact: contactLinks(MENU_HOME, HOME),
      sitemap: [],
      bodyLinks: [],
    });
    expect(ranked.slice(0, 3)).toEqual([
      HOME,
      "https://acme.example/contact",
      "https://acme.example/product-0",
    ]);
  });

  it("MAJOR (4): with a 20-page cap the contact page is among the pages read", async () => {
    const deps = stubDeps({
      [HOME]: { body: MENU_HOME },
      "https://acme.example/contact": { body: BARE_PAGE },
    });
    const result = await crawlSite(HOME, deps);
    expect(result.pages.map((p) => p.url)).toContain("https://acme.example/contact");
    expect(result.pages.length).toBeLessThanOrEqual(20);
  });
});

const BARE_PAGE = "<html><head><title>Acme</title></head><body><h1>Acme</h1></body></html>";

describe("W3 review round 2 — a probe that runs out of time is not a finding", () => {
  it("NIT (7): a timed-out form probe is absent (not measured), never null", async () => {
    const never = new Promise<null>(() => {});
    expect(await budgetedFormProbe(never, 5)).toBeUndefined();
  });

  it("a probe that fails is absent too, and a probe that ran and found no form is null", async () => {
    expect(await budgetedFormProbe(Promise.reject(new Error("boom")), 1000)).toBeUndefined();
    expect(await budgetedFormProbe(Promise.resolve(null), 1000)).toBeNull();
  });
});

// W3 review round 3. A contact word is a whole word or a known contact page,
// not a prefix; "consultation" is a verb phrase and never a blog's; and the
// menu keeps its seats whatever the body links say.
describe("W3 review round 3 — contact-like means a contact page, not a prefix", () => {
  it.each([
    ["https://acme.example/contact-lenses", ""],
    ["https://acme.example/contact-lenses/brand-3", ""],
    ["https://acme.example/contactless-payments", ""],
    ["https://acme.example/x", "Contact lenses"],
    ["https://acme.example/blog/x", "Consultation tips for owners"],
    ["https://acme.example/blog/consultation", ""],
    ["https://acme.example/2026/05/consultation", ""],
  ])("%s %s is NOT contact-like", (href, text) => {
    expect(isContactLike(href, text)).toBe(false);
  });

  it.each([
    ["https://acme.example/contactus", ""],
    ["https://acme.example/contact-sales", ""],
    ["https://acme.example/contact-info", ""],
    ["https://acme.example/contact-our-team", ""],
    ["https://acme.example/contact-support", ""],
    ["https://acme.example/x", "Contact"],
    ["https://acme.example/x", "Contact us"],
    ["https://acme.example/x", "Contact me"],
    ["https://acme.example/x", "Get in touch"],
    ["https://acme.example/x", "Book a consultation"],
    ["https://acme.example/x", "Request a consultation"],
    ["https://acme.example/x", "Schedule a consultation"],
  ])("%s %s IS contact-like", (href, text) => {
    expect(isContactLike(href, text)).toBe(true);
  });

  it("a menu of eye-clinic pages, a footer /contact and 25 lens pages: the contact and menu pages are read within 20", async () => {
    const lensLinks = Array.from(
      { length: 25 },
      (_, i) => `<a href="/contact-lenses/brand-${i}">Brand ${i}</a>`,
    ).join("");
    const home = `<html><body><header><nav><a href="/services">Services</a><a href="/eye-exams">Eye exams</a><a href="/about">About</a></nav></header>
      <main><h1>Acme</h1>${lensLinks}</main>
      <footer><a href="/contact">Contact</a></footer></body></html>`;
    const deps = stubDeps({
      [HOME]: { body: home },
      "https://acme.example/contact": { body: BARE_PAGE },
      "https://acme.example/services": { body: BARE_PAGE },
      "https://acme.example/eye-exams": { body: BARE_PAGE },
      "https://acme.example/about": { body: BARE_PAGE },
    });
    const result = await crawlSite(HOME, deps);
    const urls = result.pages.map((p) => p.url);
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://acme.example/contact",
        "https://acme.example/services",
        "https://acme.example/eye-exams",
        "https://acme.example/about",
      ]),
    );
    expect(urls.length).toBeLessThanOrEqual(20);
  });

  it("30 request-appointment links under locations do not push the menu out of the budget", () => {
    const locations = Array.from(
      { length: 30 },
      (_, i) => `<a href="/locations/city-${i}/request-appointment">Visit ${i}</a>`,
    ).join("");
    const html = `<html><body><header><nav><a href="/services">Services</a><a href="/about">About</a></nav></header>
      <main>${locations}</main></body></html>`;
    const ranked = rankCandidates({
      home: HOME,
      nav: navLinks(html, HOME),
      contact: contactLinks(html, HOME),
      sitemap: [],
      bodyLinks: [],
    });
    const { chosen } = normalizeCandidates(ranked, "https://acme.example", 20, null);
    expect(chosen).toEqual(expect.arrayContaining(["https://acme.example/services"]));
    expect(chosen).toEqual(expect.arrayContaining(["https://acme.example/about"]));
    expect(ranked.indexOf("https://acme.example/about")).toBeLessThan(
      ranked.indexOf("https://acme.example/locations/city-5/request-appointment"),
    );
  });

  it("at most three contact-like links rank right after the home page", () => {
    const contact = [
      "https://acme.example/contact",
      "https://acme.example/contact-sales",
      "https://acme.example/contact-form",
      "https://acme.example/contact-page",
    ];
    const nav = ["https://acme.example/services"];
    const ranked = rankCandidates({ home: HOME, nav, contact, sitemap: [], bodyLinks: [] });
    expect(ranked.slice(0, 4)).toEqual([HOME, ...contact.slice(0, 3)]);
    expect(ranked[4]).toBe("https://acme.example/services");
    expect(ranked[5]).toBe(contact[3]);
  });
});

// W3 review round 4. Each test names its finding.
describe("W3 review round 4 — the menu is not a dated post (finding 3)", () => {
  const services = Array.from({ length: 12 }, (_, i) => `https://acme.example/service-${i + 1}/`);
  const posts = Array.from(
    { length: 10 },
    (_, i) =>
      `<article><header><a href="/2024/0${(i % 9) + 1}/post-${i}/">Post ${i}</a></header></article>`,
  ).join("");
  const menu = `<header><nav><a href="/about">About</a><a href="/fees">Fees</a><a href="/team">Team</a></nav></header>`;
  const homeWithPosts = `<html><body>${menu}<main><h1>Acme</h1>${posts}</main></body></html>`;

  it("a header inside an article is not the menu, so 12 service pages outrank 10 dated posts", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: homeWithPosts },
      "https://acme.example/sitemap.xml": {
        body: `<urlset>${services.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`,
      },
    };
    for (const u of services) routes[u] = { body: NO_MENU_HOME };
    const result = await crawlSite(HOME, stubDeps(routes));
    const chosen = result.pages.map((p) => p.url);
    expect(services.filter((u) => chosen.includes(u))).toHaveLength(12);
    expect(chosen.filter((u) => u.includes("/2024/"))).toHaveLength(20 - 1 - 3 - 12);
  });

  it("navLinks does not read a header inside an article, and still reads the site's header and nav", () => {
    const html = `<html><body>${menu}<article><header><a href="/2024/01/post-1/">Post</a></header></article></body></html>`;
    expect(navLinks(html, HOME)).toEqual([
      "https://acme.example/about",
      "https://acme.example/fees",
      "https://acme.example/team",
    ]);
  });

  it("a dated or paginated link in the menu ranks after the sitemap's service pages", () => {
    const ranked = rankCandidates({
      home: HOME,
      nav: ["https://acme.example/about", "https://acme.example/2024/01/post-1/"],
      contact: [],
      sitemap: services,
      bodyLinks: [],
    });
    expect(ranked.indexOf("https://acme.example/2024/01/post-1/")).toBeGreaterThan(
      ranked.indexOf(services[11]!),
    );
    expect(ranked.indexOf("https://acme.example/about")).toBeLessThan(ranked.indexOf(services[0]!));
  });
});

describe("W3 review round 4 — a query-string variant takes no seat (finding 5)", () => {
  it("/shop/ and 30 of its ?orderby variants: two pages considered, two chosen", () => {
    const SORTS = ["price", "date", "popularity", "rating"];
    const variants = Array.from(
      { length: 30 },
      (_, i) => `https://acme.example/shop/?orderby=${SORTS[i % 4]}&add-to-cart=${i}`,
    );
    const { chosen, considered } = normalizeCandidates(
      [HOME, "https://acme.example/shop/", ...variants],
      "https://acme.example",
      20,
      null,
    );
    expect(considered).toBe(2);
    expect(chosen).toEqual([HOME, "https://acme.example/shop/"]);
  });
});

describe("W3 review round 4 — a pagination variant keeps its seat (finding 5, approved)", () => {
  it("/shop/ with ?orderby variants and ?page=2: three considered, three chosen", () => {
    const SORTS = ["price", "date", "popularity", "rating"];
    const variants = Array.from(
      { length: 30 },
      (_, i) => `https://acme.example/shop/?orderby=${SORTS[i % 4]}&add-to-cart=${i}`,
    );
    const { chosen, considered } = normalizeCandidates(
      [HOME, "https://acme.example/shop/", ...variants, "https://acme.example/shop/?page=2"],
      "https://acme.example",
      20,
      null,
    );
    expect(considered).toBe(3);
    expect(chosen).toEqual([
      HOME,
      "https://acme.example/shop/",
      "https://acme.example/shop/?page=2",
    ]);
  });
});

describe("W3 review round 4 — the named .gz sitemap is a sitemap we did not read (finding 6)", () => {
  it("a robots-named sitemap.xml.gz that is skipped is recorded as unread, not as no sitemap", async () => {
    const deps = stubDeps({
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/robots.txt": {
        body: "User-agent: *\nAllow: /\nSitemap: https://acme.example/sitemap.xml.gz",
      },
    });
    const result = await crawlSite(HOME, deps);
    expect(result.sitemap.present).toBe(false);
    expect(result.sidecarErrors.sitemap).not.toBeNull();
  });
});

describe("W3 review round 4 — contact words that are not contact pages (findings 7 and 8)", () => {
  it.each([
    ["https://acme.example/events", "Schedule"],
    ["https://acme.example/books", "Book"],
    ["https://acme.example/blog/why-you-should-request-a-demo", ""],
    ["https://acme.example/news/book-a-demo", ""],
    ["https://acme.example/insights/contact-us", ""],
    ["https://acme.example/news/x", "Contact us"],
  ])("%s %s is NOT contact-like", (href, text) => {
    expect(isContactLike(href, text)).toBe(false);
  });

  it.each([
    ["https://acme.example/x", "Book now"],
    ["https://acme.example/x", "Book a call"],
    ["https://acme.example/request-a-demo", ""],
  ])("%s %s IS contact-like", (href, text) => {
    expect(isContactLike(href, text)).toBe(true);
  });
});

describe("W3 review round 4 — percent-escapes are one page (finding 9)", () => {
  it("/caf%C3%A9 and /caf%c3%a9 are the same page: one seat", () => {
    const { chosen, considered } = normalizeCandidates(
      [HOME, "https://acme.example/caf%C3%A9", "https://acme.example/caf%c3%a9"],
      "https://acme.example",
      20,
      null,
    );
    expect(considered).toBe(2);
    expect(chosen).toHaveLength(2);
  });
});

// W3 review round 5, finding 1. A query variant of a path already seen is a page
// of its own when one of its keys has content (page_id, route, page). Only
// tracking and sort keys make it the same page.
describe("W3 review round 5 — a content query variant is its own page (finding 1)", () => {
  const BARE_PAGE = "<html><head><title>Acme</title></head><body><h1>Acme</h1></body></html>";

  it("WordPress plain permalinks: the ?page_id= pages of the menu are five pages, all read", async () => {
    const ids = [2, 7, 9, 11];
    const menu = ids.map((id) => `<a href="/?page_id=${id}">Page ${id}</a>`).join("");
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: {
        body: `<html><head><title>Acme</title></head><body><nav>${menu}</nav><h1>Acme</h1></body></html>`,
      },
      "https://acme.example/sitemap.xml": {
        body: `<urlset>${ids.map((id) => `<url><loc>https://acme.example/?page_id=${id}</loc></url>`).join("")}</urlset>`,
      },
    };
    for (const id of ids) routes[`https://acme.example/?page_id=${id}`] = { body: BARE_PAGE };

    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.pages).toHaveLength(5);
    expect(result.selection?.pagesConsidered).toBe(5);
    for (const id of ids) {
      expect(result.pages.map((p) => p.url)).toContain(`https://acme.example/?page_id=${id}`);
    }
  });

  it("OpenCart: two routes under one /index.php path are two pages, and the shop page is read", async () => {
    const contact = "https://acme.example/index.php?route=information/contact";
    const shop = "https://acme.example/index.php?route=product/category&path=20";
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/sitemap.xml": {
        body: `<urlset><url><loc>${contact}</loc></url><url><loc>${shop}</loc></url></urlset>`,
      },
      [contact]: { body: BARE_PAGE },
      [shop]: { body: BARE_PAGE },
    };

    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.pages.map((p) => p.url)).toEqual(expect.arrayContaining([contact, shop]));
    expect(result.selection?.pagesConsidered).toBe(3);
  });

  it("normalizeCandidates: a route variant after the same path takes its own seat", () => {
    const contact = "https://acme.example/index.php?route=information/contact";
    const shop = "https://acme.example/index.php?route=product/category&path=20";
    const { chosen, considered } = normalizeCandidates(
      [HOME, contact, shop],
      "https://acme.example",
      20,
      null,
    );
    expect(considered).toBe(3);
    expect(chosen).toEqual([HOME, contact, shop]);
  });

  it("a variant whose only key is tracking is still one page: no extra seat", () => {
    const { considered } = normalizeCandidates(
      [HOME, "https://acme.example/about", "https://acme.example/about?utm_source=news"],
      "https://acme.example",
      20,
      null,
    );
    expect(considered).toBe(2);
  });
});

// W3 review round 5, finding 2. A sort or tracking variant listed before the bare
// page must not take the page's place: the bare page is read instead.
describe("W3 review round 5 — a sort variant does not take the bare page's place (finding 2)", () => {
  it("/shop/?orderby=price listed before /shop/: /shop/ is read, the variant is not", () => {
    const { chosen, considered } = normalizeCandidates(
      [HOME, "https://acme.example/shop/?orderby=price", "https://acme.example/shop/"],
      "https://acme.example",
      20,
      null,
    );
    expect(considered).toBe(2);
    expect(chosen).toEqual([HOME, "https://acme.example/shop/"]);
  });

  it("the same through crawlSite: a menu link to the variant, and the sitemap's bare page, reads /shop/", async () => {
    const BARE_PAGE = "<html><head><title>Acme</title></head><body><h1>Acme</h1></body></html>";
    const variant = "https://acme.example/shop/?orderby=price";
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: {
        body: `<html><head><title>Acme</title></head><body><nav><a href="/shop/?orderby=price">Shop</a></nav><h1>Acme</h1></body></html>`,
      },
      "https://acme.example/sitemap.xml": {
        body: `<urlset><url><loc>https://acme.example/shop/</loc></url></urlset>`,
      },
      "https://acme.example/shop/": { body: BARE_PAGE },
      [variant]: { body: BARE_PAGE },
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    const urls = result.pages.map((p) => p.url);
    expect(urls).toContain("https://acme.example/shop/");
    expect(urls).not.toContain(variant);
    expect(result.selection?.pagesConsidered).toBe(2);
  });

  it("control: a sort variant with no bare page anywhere is fetched as it is, in its place", () => {
    const variant = "https://acme.example/shop/?orderby=price";
    const { chosen, considered } = normalizeCandidates(
      [HOME, variant],
      "https://acme.example",
      20,
      null,
    );
    expect(considered).toBe(2);
    expect(chosen).toEqual([HOME, variant]);
  });
});

// W3 review round 5, finding 4. A sitemap index whose children are not all read
// as urlsets is a truncated count, whatever the number of URLs that did come out.
describe("W3 review round 5 — a sitemap index's count is truncated unless every child was read (finding 4)", () => {
  const INDEX = (locs: string[]) =>
    `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
      .map((l) => `<sitemap><loc>${l}</loc></sitemap>`)
      .join("")}</sitemapindex>`;
  const URLSET = (urls: string[]) =>
    `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;
  const PAGES_XML = URLSET(["https://acme.example/services", "https://acme.example/about"]);

  it("(a) a child on another host is a child we did not read: truncated", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/sitemap.xml": {
        body: INDEX([
          "https://acme.example/pages.xml",
          "https://cdn.acme-static.example/products.xml",
        ]),
      },
      "https://acme.example/pages.xml": { body: PAGES_XML },
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.sitemap.urlCount).toBe(2);
    expect(result.sitemap.truncated).toBe(true);
  });

  it("(b) a child that answers with an HTML body and no urlset is a child we did not read: truncated", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/sitemap.xml": {
        body: INDEX(["https://acme.example/pages.xml", "https://acme.example/old-posts.xml"]),
      },
      "https://acme.example/pages.xml": { body: PAGES_XML },
      "https://acme.example/old-posts.xml": { body: "<html><body>Hello</body></html>" },
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.sitemap.urlCount).toBe(2);
    expect(result.sitemap.truncated).toBe(true);
  });

  it("(c) a child that is itself an index adds none of its addresses as pages, and is truncated", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/sitemap.xml": {
        body: INDEX(["https://acme.example/pages.xml", "https://acme.example/child.xml"]),
      },
      "https://acme.example/pages.xml": { body: PAGES_XML },
      "https://acme.example/child.xml": {
        body: INDEX(["https://acme.example/grandchild.xml"]),
      },
      "https://acme.example/grandchild.xml": { body: URLSET(["https://acme.example/x"]) },
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.sitemap.urlCount).toBe(2);
    expect(result.sitemap.sample).not.toContain("https://acme.example/grandchild.xml");
    expect(result.sitemap.truncated).toBe(true);
  });

  it("control: an index whose two same-origin children are both urlsets is read whole", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/sitemap.xml": {
        body: INDEX(["https://acme.example/pages.xml", "https://acme.example/posts.xml"]),
      },
      "https://acme.example/pages.xml": { body: PAGES_XML },
      "https://acme.example/posts.xml": { body: URLSET(["https://acme.example/news"]) },
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.sitemap.urlCount).toBe(3);
    expect(result.sitemap.truncated).toBe(false);
  });
});

// W3 review round 5, finding 5. A sitemap the owner named as .gz that we skipped,
// with the default /sitemap.xml read instead, is not the whole of their sitemap.
describe("W3 review round 5 — a skipped named .gz sitemap truncates a default one (finding 5)", () => {
  it("robots names sitemap.xml.gz; /sitemap.xml answers: present, and truncated", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/robots.txt": {
        body: "User-agent: *\nAllow: /\nSitemap: https://acme.example/sitemap.xml.gz",
      },
      "https://acme.example/sitemap.xml": {
        body: `<urlset><url><loc>https://acme.example/services</loc></url><url><loc>https://acme.example/about</loc></url></urlset>`,
      },
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.sitemap.present).toBe(true);
    expect(result.sitemap.urlCount).toBe(2);
    expect(result.sitemap.truncated).toBe(true);
  });

  it("control: robots names a plain sitemap.xml that is read: not truncated", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/robots.txt": {
        body: "User-agent: *\nAllow: /\nSitemap: https://acme.example/sitemap.xml",
      },
      "https://acme.example/sitemap.xml": {
        body: `<urlset><url><loc>https://acme.example/services</loc></url></urlset>`,
      },
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.sitemap.truncated).toBe(false);
  });
});

// W3 review round 6, finding 1. The home page is page one whatever its query
// string: a home that redirected to `?route=…` or `?lang=…` is still the home.
describe("W3 review round 6 — the home page is always the first page (finding 1)", () => {
  const BARE_PAGE = "<html><head><title>Acme</title></head><body><h1>Acme</h1></body></html>";
  const ROUTE_HOME = "https://acme.example/index.php?route=common/home";
  const LANG_HOME = "https://acme.example/?lang=en";
  const SITEMAP_PAGES = Array.from({ length: 25 }, (_, i) => `https://acme.example/p${i}`);

  it("repro A: a home redirected to a routed URL is pages[0], ahead of 25 sitemap pages", () => {
    const { chosen } = normalizeCandidates(
      rankCandidates({
        home: ROUTE_HOME,
        nav: [],
        contact: [],
        sitemap: SITEMAP_PAGES,
        bodyLinks: [],
      }),
      "https://acme.example",
      20,
      null,
    );
    expect(chosen[0]).toBe(ROUTE_HOME);
    expect(chosen).toHaveLength(20);
  });

  it("repro B: a home redirected to /?lang=en is pages[0], ahead of the menu", () => {
    const about = "https://acme.example/about";
    const services = "https://acme.example/services";
    const { chosen } = normalizeCandidates(
      rankCandidates({
        home: LANG_HOME,
        nav: [about, services],
        contact: [],
        sitemap: [],
        bodyLinks: [],
      }),
      "https://acme.example",
      20,
      null,
    );
    expect(chosen).toEqual([LANG_HOME, about, services]);
  });

  it("through crawlSite: the home that redirected to a routed URL is the first page read", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME, url: ROUTE_HOME },
      "https://acme.example/sitemap.xml": {
        body: `<urlset>${SITEMAP_PAGES.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`,
      },
    };
    for (const u of SITEMAP_PAGES) routes[u] = { body: BARE_PAGE };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.pages[0]?.url).toBe(ROUTE_HOME);
    expect(result.pages).toHaveLength(20);
  });

  it("a duplicate of the home page takes no second seat", () => {
    const about = "https://acme.example/about";
    const { chosen, considered } = normalizeCandidates(
      [LANG_HOME, "https://acme.example/?lang=en&utm_source=news", about],
      "https://acme.example",
      20,
      null,
    );
    expect(chosen).toEqual([LANG_HOME, about]);
    expect(considered).toBe(2);
  });
});

// W3 review round 6, finding 2. Of a group of addresses that are one page, the
// clean one is fetched, never a tracking variant listed first.
describe("W3 review round 6 — a tracking variant is not fetched in place of its clean page (finding 2)", () => {
  const BARE_PAGE = "<html><head><title>Acme</title></head><body><h1>Acme</h1></body></html>";
  const IDS = [2, 7, 9, 11];

  it("normalizeCandidates: the utm variant listed before the clean page loses to it", () => {
    const clean = "https://acme.example/?page_id=2";
    const { chosen, considered } = normalizeCandidates(
      [HOME, "https://acme.example/?page_id=2&utm_source=x", clean],
      "https://acme.example",
      20,
      null,
    );
    expect(chosen).toEqual([HOME, clean]);
    expect(considered).toBe(2);
  });

  it("through crawlSite: menu links carrying utm_source fetch the clean pages the sitemap lists", async () => {
    const menu = IDS.map(
      (id) => `<a href="/?page_id=${id}&amp;utm_source=nav">Page ${id}</a>`,
    ).join("");
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: {
        body: `<html><head><title>Acme</title></head><body><nav>${menu}</nav><h1>Acme</h1></body></html>`,
      },
      "https://acme.example/sitemap.xml": {
        body: `<urlset>${IDS.map((id) => `<url><loc>https://acme.example/?page_id=${id}</loc></url>`).join("")}</urlset>`,
      },
    };
    for (const id of IDS) routes[`https://acme.example/?page_id=${id}`] = { body: BARE_PAGE };
    const base = stubDeps(routes);
    const fetched: string[] = [];
    const deps: CrawlDeps = {
      ...base,
      async fetchUrl(url) {
        fetched.push(url);
        return base.fetchUrl(url);
      },
    };
    const result = await crawlSite(HOME, deps);
    const cleanUrls = IDS.map((id) => `https://acme.example/?page_id=${id}`);
    expect(result.pages.map((p) => p.url)).toEqual([HOME, ...cleanUrls]);
    expect(fetched.filter((u) => u.includes("page_id"))).toEqual(cleanUrls);
  });

  it("a utm-only address with no clean member is fetched as its stripped address", () => {
    const { chosen } = normalizeCandidates(
      [HOME, "https://acme.example/?page_id=2&utm_source=nav"],
      "https://acme.example",
      20,
      null,
    );
    expect(chosen).toEqual([HOME, "https://acme.example/?page_id=2"]);
  });
});

// W3 review round 6, finding 3. A self-closing <urlset/> is a urlset: an empty
// child is read, not a child we failed to read.
describe("W3 review round 6 — an empty self-closing urlset is read, not truncated (finding 3)", () => {
  it("an index whose second child is <urlset/> is read whole: not truncated", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/sitemap.xml": {
        body: `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://acme.example/a.xml</loc></sitemap><sitemap><loc>https://acme.example/b.xml</loc></sitemap></sitemapindex>`,
      },
      "https://acme.example/a.xml": {
        body: `<urlset><url><loc>https://acme.example/services</loc></url></urlset>`,
      },
      "https://acme.example/b.xml": { body: `<?xml version="1.0"?><urlset/>` },
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.sitemap.urlCount).toBe(1);
    expect(result.sitemap.truncated).toBe(false);
  });

  it("a top-level <urlset/> is a sitemap that was read, not an absent one", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/sitemap.xml": { body: `<?xml version="1.0"?><urlset/>` },
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.sitemap.present).toBe(true);
    expect(result.sitemap.urlCount).toBe(0);
    expect(result.sitemap.truncated).toBe(false);
  });
});

// W3 review round 6, finding 4. A paginated or dated variant keeps its late-tier
// place rather than being demoted behind the distinct paths.
describe("W3 review round 6 — pagination keeps its late-tier order (finding 4)", () => {
  it("normalizeCandidates: [HOME, /blog/?page=2, /2019/04/post] keeps that order", () => {
    const blog2 = "https://acme.example/blog/?page=2";
    const post = "https://acme.example/2019/04/post";
    const { chosen } = normalizeCandidates([HOME, blog2, post], "https://acme.example", 20, null);
    expect(chosen).toEqual([HOME, blog2, post]);
  });

  it("through rankCandidates: the late sitemap entries sort by depth, the page-2 listing first", () => {
    const blog2 = "https://acme.example/blog/?page=2";
    const post = "https://acme.example/2019/04/post";
    const { chosen } = normalizeCandidates(
      rankCandidates({ home: HOME, nav: [], contact: [], sitemap: [post, blog2], bodyLinks: [] }),
      "https://acme.example",
      20,
      null,
    );
    expect(chosen).toEqual([HOME, blog2, post]);
  });
});

// W3 review round 6, finding (a). Two or more robots-named sitemaps: we read one,
// so the count is not the whole of their sitemaps.
describe("W3 review round 6 — two robots-named sitemaps, one read, is truncated (finding a)", () => {
  it("robots names a.xml.gz and b.xml; b.xml is read: truncated, and no further sitemap is fetched", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/robots.txt": {
        body: "User-agent: *\nAllow: /\nSitemap: https://acme.example/a.xml.gz\nSitemap: https://acme.example/b.xml",
      },
      "https://acme.example/b.xml": {
        body: `<urlset><url><loc>https://acme.example/services</loc></url></urlset>`,
      },
      "https://acme.example/sitemap.xml": {
        body: `<urlset><url><loc>https://acme.example/about</loc></url></urlset>`,
      },
    };
    const base = stubDeps(routes);
    const fetched: string[] = [];
    const deps: CrawlDeps = {
      ...base,
      async fetchUrl(url) {
        fetched.push(url);
        return base.fetchUrl(url);
      },
    };
    const result = await crawlSite(HOME, deps);
    expect(result.sitemap.urlCount).toBe(1);
    expect(result.sitemap.truncated).toBe(true);
    expect(fetched).not.toContain("https://acme.example/sitemap.xml");
  });

  it("control: robots names exactly one sitemap, which is read: not truncated", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/robots.txt": {
        body: "User-agent: *\nAllow: /\nSitemap: https://acme.example/b.xml",
      },
      "https://acme.example/b.xml": {
        body: `<urlset><url><loc>https://acme.example/services</loc></url></urlset>`,
      },
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.sitemap.urlCount).toBe(1);
    expect(result.sitemap.truncated).toBe(false);
  });
});

// W3 review round 6, finding (b). The same child listed twice is fetched once and
// its URLs counted once.
describe("W3 review round 6 — a repeated child or page is counted once (finding b)", () => {
  it("an index listing /a.xml twice: one fetch of /a.xml, urlCount 1", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/sitemap.xml": {
        body: `<sitemapindex><sitemap><loc>https://acme.example/a.xml</loc></sitemap><sitemap><loc>https://acme.example/a.xml</loc></sitemap></sitemapindex>`,
      },
      "https://acme.example/a.xml": {
        body: `<urlset><url><loc>https://acme.example/services</loc></url></urlset>`,
      },
    };
    const base = stubDeps(routes);
    const fetched: string[] = [];
    const deps: CrawlDeps = {
      ...base,
      async fetchUrl(url) {
        fetched.push(url);
        return base.fetchUrl(url);
      },
    };
    const result = await crawlSite(HOME, deps);
    expect(fetched.filter((u) => u === "https://acme.example/a.xml")).toHaveLength(1);
    expect(result.sitemap.urlCount).toBe(1);
    expect(result.sitemap.truncated).toBe(false);
  });

  it("a page listed by two children is counted once", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/sitemap.xml": {
        body: `<sitemapindex><sitemap><loc>https://acme.example/a.xml</loc></sitemap><sitemap><loc>https://acme.example/b.xml</loc></sitemap></sitemapindex>`,
      },
      "https://acme.example/a.xml": {
        body: `<urlset><url><loc>https://acme.example/news</loc></url></urlset>`,
      },
      "https://acme.example/b.xml": {
        body: `<urlset><url><loc>https://acme.example/news</loc></url><url><loc>https://acme.example/about</loc></url></urlset>`,
      },
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.sitemap.urlCount).toBe(2);
    expect(result.sitemap.truncated).toBe(false);
  });
});

// W3 review round 7, finding 1. A tracking key is removed from the raw query, so
// the remaining keys keep the encoding they were listed with: the clean twin and
// its tracking variant are one page, and the fetch address is the one listed.
describe("W3 review round 7 — removing a key keeps the rest of the query as written (finding 1)", () => {
  const ORIGIN = "https://acme.example";
  const CAT = "https://acme.example/index.php?route=product/category&path=20";

  it("repro A: a utm variant listed first and its clean twin are one seat, the clean URL as listed", () => {
    const { chosen, considered } = normalizeCandidates(
      [HOME, `${CAT}&utm_source=nav`, CAT],
      ORIGIN,
      20,
      null,
    );
    expect(chosen).toEqual([HOME, CAT]);
    expect(considered).toBe(2);
  });

  it("repro B: /?s=a%20b&utm_source=nav and /?s=a%20b are one seat, fetched as listed", () => {
    const clean = "https://acme.example/?s=a%20b";
    const { chosen, considered } = normalizeCandidates(
      [HOME, `${clean}&utm_source=nav`, clean],
      ORIGIN,
      20,
      null,
    );
    expect(chosen).toEqual([HOME, clean]);
    expect(considered).toBe(2);
  });

  it("repro C: an OpenCart home with a utm twin is the home once, first", () => {
    const ROUTE_HOME = "https://acme.example/index.php?route=common/home";
    const about = "https://acme.example/about";
    const { chosen, considered } = normalizeCandidates(
      [ROUTE_HOME, `${ROUTE_HOME}&utm_source=x`, about],
      ORIGIN,
      20,
      null,
    );
    expect(chosen).toEqual([ROUTE_HOME, about]);
    expect(considered).toBe(2);
  });

  it("repro D: a utm-only address is fetched as its stripped address, encoding kept", () => {
    const { chosen } = normalizeCandidates(
      [HOME, `${CAT.replace("&path=20", "")}&utm_source=x`],
      ORIGIN,
      20,
      null,
    );
    expect(chosen).toEqual([HOME, "https://acme.example/index.php?route=product/category"]);
  });
});

// W3 review round 7, finding 2. Two robots-named sitemaps are truncated only when a
// named one is neither the sitemap read nor a child of it that was read.
describe("W3 review round 7 — a named sitemap the index lists is not unread (finding 2)", () => {
  const urlset = (urls: string[]): string =>
    `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;

  it("repro: robots names /sitemap_index.xml and /page-sitemap.xml; the index lists the latter: not truncated", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/robots.txt": {
        body: "User-agent: *\nAllow: /\nSitemap: https://acme.example/sitemap_index.xml\nSitemap: https://acme.example/page-sitemap.xml",
      },
      "https://acme.example/sitemap_index.xml": {
        body: `<sitemapindex><sitemap><loc>https://acme.example/page-sitemap.xml</loc></sitemap></sitemapindex>`,
      },
      "https://acme.example/page-sitemap.xml": { body: urlset(["https://acme.example/services"]) },
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.sitemap.urlCount).toBe(1);
    expect(result.sitemap.truncated).toBe(false);
  });

  it("control: the same robots, but the index does not list the second named sitemap: truncated", async () => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/robots.txt": {
        body: "User-agent: *\nAllow: /\nSitemap: https://acme.example/sitemap_index.xml\nSitemap: https://acme.example/other.xml",
      },
      "https://acme.example/sitemap_index.xml": {
        body: `<sitemapindex><sitemap><loc>https://acme.example/page-sitemap.xml</loc></sitemap></sitemapindex>`,
      },
      "https://acme.example/page-sitemap.xml": { body: urlset(["https://acme.example/services"]) },
      "https://acme.example/other.xml": { body: urlset(["https://acme.example/about"]) },
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.sitemap.urlCount).toBe(1);
    expect(result.sitemap.truncated).toBe(true);
  });
});

// W3 review round 7, finding 3. A listed address that is off-origin is counted
// whatever order it is listed in, including after its same-site twin.
describe("W3 review round 7 — an off-origin listing is counted in either order (finding 3)", () => {
  const urlset = (urls: string[]): string =>
    `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;

  it.each([
    ["https first, http second", ["https://acme.example/x", "http://acme.example/x"]],
    ["http first, https second", ["http://acme.example/x", "https://acme.example/x"]],
  ])("%s: sitemapOffOrigin is 1, one URL", async (_label, locs) => {
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: NO_MENU_HOME },
      "https://acme.example/sitemap.xml": { body: urlset(locs) },
    };
    const result = await crawlSite(HOME, stubDeps(routes));
    expect(result.selection?.sitemapOffOrigin).toBe(1);
    expect(result.sitemap.urlCount).toBe(1);
  });
});

// W3 review round 7, finding 4. The same robots-named sitemap written with http and
// with https is one named address, not two.
describe("W3 review round 7 — one named sitemap written with two schemes is one address (finding 4)", () => {
  it("http origin: robots names http and https /sitemap.xml; the http one is read: not truncated", async () => {
    const HTTP_HOME = "http://acme.example/";
    const routes: Record<string, Partial<FetchResponse>> = {
      [HTTP_HOME]: { body: NO_MENU_HOME },
      "http://acme.example/robots.txt": {
        body: "User-agent: *\nAllow: /\nSitemap: http://acme.example/sitemap.xml\nSitemap: https://acme.example/sitemap.xml",
      },
      "http://acme.example/sitemap.xml": {
        body: `<urlset><url><loc>http://acme.example/services</loc></url></urlset>`,
      },
    };
    const result = await crawlSite(HTTP_HOME, stubDeps(routes));
    expect(result.sitemap.present).toBe(true);
    expect(result.sitemap.truncated).toBe(false);
  });
});
