import { describe, it, expect } from "vitest";
import {
  parseSitemapUrls,
  parseHtmlLinks,
  sampleRoutePaths,
  familyCountsOf,
  discoverRoutes,
  type DiscoverDeps,
} from "../../src/audits/route-discovery.js";

describe("parseSitemapUrls", () => {
  it("extracts loc URLs, tolerant of whitespace", () => {
    const xml = `<urlset><url><loc>https://a.com/</loc></url><url><loc> https://a.com/work/x </loc></url></urlset>`;
    expect(parseSitemapUrls(xml)).toEqual(["https://a.com/", "https://a.com/work/x"]);
  });
  it("returns [] for non-sitemap junk", () => {
    expect(parseSitemapUrls("<html>nope</html>")).toEqual([]);
  });
});

describe("parseHtmlLinks", () => {
  it("returns same-origin pathnames, dropping anchors / mailto / off-origin", () => {
    const html = `<a href="/about">a</a><a href="#x">x</a><a href="mailto:a@b.com">m</a>
      <a href="https://other.com/y">o</a><a href="/work/z">w</a>`;
    expect(parseHtmlLinks(html, "https://a.com").sort()).toEqual(["/about", "/work/z"]);
  });
});

describe("sampleRoutePaths — representative, CMS-aware", () => {
  it("always includes the homepage", () => {
    expect(sampleRoutePaths([])).toEqual(["/"]);
  });

  it("represents EVERY family before doubling up on any (CMS pages not skipped)", () => {
    // 10 /blog + 10 /work + /about. A naive first-N would be all /blog; round-robin must include
    // /work and /about within the first few picks.
    const urls = [
      ...Array.from({ length: 10 }, (_, i) => `/blog/post-${i}`),
      ...Array.from({ length: 10 }, (_, i) => `/work/proj-${i}`),
      "/about",
    ];
    const sample = sampleRoutePaths(urls, 7);
    expect(sample[0]).toBe("/");
    const fams = new Set(sample.slice(1).map((p) => p.split("/")[1]));
    expect(fams.has("blog")).toBe(true);
    expect(fams.has("work")).toBe(true);
    expect(fams.has("about")).toBe(true);
    expect(sample).toHaveLength(7);
  });

  it("caps the total and dedupes", () => {
    const urls = ["/a", "/a", "/b/1", "/b/2", "/b/3", "/c"];
    expect(sampleRoutePaths(urls, 3)).toHaveLength(3);
    // dedupe: /a appears once
    expect(sampleRoutePaths(urls, 15).filter((p) => p === "/a")).toHaveLength(1);
  });

  it("accepts absolute URLs and reduces them to pathnames", () => {
    expect(sampleRoutePaths(["https://a.com/work/x"], 15)).toEqual(["/", "/work/x"]);
  });

  // 2026-07-16 false-alarm cluster: a homepage-linked PDF was sampled as a "route" — a browser
  // probe of a download can never have a title/meta and page.goto throws, so one asset URL
  // guaranteed reachability + titles-meta fails (MSOT's capabilities PDF, live).
  it("drops asset/file URLs — only real pages are probed", () => {
    const urls = [
      "/pdfs/MSOT_Capabilities.pdf",
      "/img/logo.svg",
      "/photos/team.jpg",
      "/feed.xml",
      "/site.webmanifest",
      "/about",
    ];
    expect(sampleRoutePaths(urls, 15)).toEqual(["/", "/about"]);
  });

  it("keeps .html pages and dotted page slugs (blocklist, not allowlist)", () => {
    expect(sampleRoutePaths(["/legacy/index.html", "/blog/v2.0-release"], 15).sort()).toEqual([
      "/",
      "/blog/v2.0-release",
      "/legacy/index.html",
    ]);
  });

  // 2026-07-16: revogen.com's homepage linked both /surgical-grafts and /surgical-grafts/ — the
  // SAME page sampled twice, guaranteeing a bogus "duplicate title" titles-meta fail.
  it("normalizes trailing slashes so /a and /a/ sample once", () => {
    expect(sampleRoutePaths(["/surgical-grafts", "/surgical-grafts/"], 15)).toEqual([
      "/",
      "/surgical-grafts",
    ]);
    expect(sampleRoutePaths(["https://a.com/b/"], 15)).toEqual(["/", "/b"]);
  });
});

describe("familyCountsOf", () => {
  it("counts by family with a leading slash", () => {
    expect(familyCountsOf(["/", "/work/a", "/work/b", "/blog/c"])).toEqual({
      "/": 1,
      "/work": 2,
      "/blog": 1,
    });
  });
});

describe("discoverRoutes", () => {
  const deps = (map: Record<string, string | null>): DiscoverDeps => ({
    fetchText: async (url) => map[url] ?? null,
  });

  it("uses the sitemap when present", async () => {
    const r = await discoverRoutes(
      "https://a.com",
      deps({
        "https://a.com/sitemap.xml": `<urlset><url><loc>https://a.com/</loc></url><url><loc>https://a.com/work/x</loc></url></urlset>`,
      }),
    );
    expect(r.source).toBe("sitemap");
    expect(r.routes).toContain("https://a.com/work/x");
    expect(r.routes[0]).toBe("https://a.com/");
  });

  it("falls back to homepage links when there's no sitemap", async () => {
    const r = await discoverRoutes(
      "https://a.com",
      deps({
        "https://a.com/sitemap.xml": null,
        "https://a.com": `<a href="/contact">c</a>`,
      }),
    );
    expect(r.source).toBe("homepage-links");
    expect(r.routes).toContain("https://a.com/contact");
  });

  it("degrades to root-only when nothing is reachable", async () => {
    const r = await discoverRoutes("https://a.com", deps({}));
    expect(r).toMatchObject({ source: "root-only", routes: ["https://a.com/"] });
  });
});
