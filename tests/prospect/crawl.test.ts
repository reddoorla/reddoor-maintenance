import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  crawlSite,
  pacedEach,
  sameOriginLinks,
  defaultCrawlDeps,
  MAX_RESPONSE_BYTES,
  ResponseTooLargeError,
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
    expect(result.sitemap).toEqual({ present: false, urlCount: 0 });
  });

  it("prefers sitemap URLs and honours maxPages", async () => {
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

    expect(result.sitemap).toEqual({ present: true, urlCount: 5 });
    expect(result.pages).toHaveLength(3);
    expect(result.pages.map((p) => p.url)).toEqual([
      HOME,
      "https://acme.example/p0",
      "https://acme.example/p1",
    ]);
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
