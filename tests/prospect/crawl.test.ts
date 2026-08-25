import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { crawlSite, type CrawlDeps, type FetchResponse } from "../../src/prospect/crawl.js";

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
      return { status: hit.status ?? 200, body: hit.body ?? "", headers: hit.headers ?? {} };
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
});
