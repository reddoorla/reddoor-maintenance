import { describe, it, expect } from "vitest";
import {
  AI_AGENTS,
  ALL_AGENTS,
  evaluateAgentAccess,
  pathCoversRoot,
  sameOriginLinks,
  parseSitemapLocs,
  isSitemapIndex,
} from "../../src/prospect/crawl.js";

const accessFor = (robots: string | null, agent: string): boolean =>
  evaluateAgentAccess(robots).find((a) => a.agent === agent)!.allowed;

describe("evaluateAgentAccess", () => {
  it("treats a missing robots.txt as full access for every agent", () => {
    const matrix = evaluateAgentAccess(null);
    expect(matrix).toHaveLength(ALL_AGENTS.length);
    expect(matrix.every((a) => a.allowed)).toBe(true);
    expect(matrix.every((a) => a.matchedRule === null)).toBe(true);
  });

  it("blocks every agent under a wildcard Disallow: /", () => {
    const matrix = evaluateAgentAccess("User-agent: *\nDisallow: /");
    expect(matrix.every((a) => !a.allowed)).toBe(true);
    expect(matrix[0]!.matchedRule).toContain("Disallow: /");
  });

  it("blocks only the named AI agent when the rule is agent-specific", () => {
    const robots = "User-agent: *\nDisallow:\n\nUser-agent: GPTBot\nDisallow: /";
    expect(accessFor(robots, "GPTBot")).toBe(false);
    expect(accessFor(robots, "ClaudeBot")).toBe(true);
    expect(accessFor(robots, "Googlebot")).toBe(true);
  });

  it("lets an agent-specific group override a blocking wildcard", () => {
    const robots = "User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\nDisallow: /";
    expect(accessFor(robots, "Googlebot")).toBe(true);
    expect(accessFor(robots, "GPTBot")).toBe(false);
  });

  it("does not treat a path-scoped Disallow as a site-wide block", () => {
    const matrix = evaluateAgentAccess("User-agent: *\nDisallow: /admin\nDisallow: /cart");
    expect(matrix.every((a) => a.allowed)).toBe(true);
  });

  it("groups consecutive User-agent lines into one rule set", () => {
    const robots = "User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /";
    expect(accessFor(robots, "GPTBot")).toBe(false);
    expect(accessFor(robots, "CCBot")).toBe(false);
    expect(accessFor(robots, "PerplexityBot")).toBe(true);
  });

  it("ignores comments and matches agents case-insensitively", () => {
    const robots = "# keep the bots out\nUser-agent: gptbot\nDisallow: / # everything";
    expect(accessFor(robots, "GPTBot")).toBe(false);
  });

  it("covers the six AI agents the report scores", () => {
    expect([...AI_AGENTS]).toEqual([
      "GPTBot",
      "OAI-SearchBot",
      "ClaudeBot",
      "PerplexityBot",
      "Google-Extended",
      "CCBot",
    ]);
  });

  it("blocks every agent under Disallow: /* (wildcard root spelling)", () => {
    const matrix = evaluateAgentAccess("User-agent: *\nDisallow: /*");
    expect(matrix.every((a) => !a.allowed)).toBe(true);
  });

  it("blocks every agent under Disallow: /$ (anchored root spelling)", () => {
    const matrix = evaluateAgentAccess("User-agent: *\nDisallow: /$");
    expect(matrix.every((a) => !a.allowed)).toBe(true);
  });

  it("merges multiple groups naming the same agent, regardless of file order", () => {
    // Root-blocking rule appears in the SECOND of two GPTBot groups.
    const forward = "User-agent: GPTBot\nDisallow: /old\n\nUser-agent: GPTBot\nDisallow: /";
    // Same two groups, reversed. A first-match-wins reader would flip the verdict;
    // per RFC 9309 §2.2.1 all matching groups combine, so the verdict must not move.
    const reversed = "User-agent: GPTBot\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /old";
    expect(accessFor(forward, "GPTBot")).toBe(false);
    expect(accessFor(reversed, "GPTBot")).toBe(false);
  });

  it("does not fall back to a blocking wildcard when the agent has its own group that never mentions root", () => {
    const robots = "User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /blog";
    expect(accessFor(robots, "GPTBot")).toBe(true);
  });
});

describe("pathCoversRoot", () => {
  it("recognizes the three site-wide spellings", () => {
    expect(pathCoversRoot("/")).toBe(true);
    expect(pathCoversRoot("/*")).toBe(true);
    expect(pathCoversRoot("/$")).toBe(true);
  });

  it("does not treat a scoped or empty pattern as covering root", () => {
    expect(pathCoversRoot("")).toBe(false);
    expect(pathCoversRoot("/admin")).toBe(false);
    expect(pathCoversRoot("/*.pdf$")).toBe(false);
  });
});

describe("sameOriginLinks", () => {
  const html = `<a href="/services">a</a><a href="/services#top">b</a>
    <a href="https://acme.example/about">c</a><a href="https://other.example/x">d</a>
    <a href="mailto:hi@acme.example">e</a><a>no href</a>`;

  it("returns absolute, deduped, same-origin http(s) links without fragments", () => {
    expect(sameOriginLinks(html, "https://acme.example/")).toEqual([
      "https://acme.example/services",
      "https://acme.example/about",
    ]);
  });

  it("resolves a relative href against <base href> while it stays same-origin", () => {
    const withBase = `<base href="https://acme.example/blog/"><a href="post-1">a</a>`;
    expect(sameOriginLinks(withBase, "https://acme.example/")).toEqual([
      "https://acme.example/blog/post-1",
    ]);
  });

  it("excludes links resolved via an off-origin <base> as off-origin", () => {
    const cdnBase = `<base href="https://cdn.other.example/"><a href="asset.js">a</a>`;
    expect(sameOriginLinks(cdnBase, "https://acme.example/")).toEqual([]);
  });

  it("ignores links inside a <template>, an unrendered subtree", () => {
    const withTemplate = `<template><a href="/hidden">hidden</a></template><a href="/visible">visible</a>`;
    expect(sameOriginLinks(withTemplate, "https://acme.example/")).toEqual([
      "https://acme.example/visible",
    ]);
  });
});

describe("sitemap parsing", () => {
  it("pulls every <loc> out of a urlset", () => {
    const xml = `<urlset><url><loc>https://acme.example/</loc></url>
      <url><loc> https://acme.example/about </loc></url></urlset>`;
    expect(parseSitemapLocs(xml)).toEqual(["https://acme.example/", "https://acme.example/about"]);
    expect(isSitemapIndex(xml)).toBe(false);
  });

  it("recognizes a sitemap index", () => {
    const xml = `<sitemapindex><sitemap><loc>https://acme.example/sitemap-1.xml</loc></sitemap></sitemapindex>`;
    expect(isSitemapIndex(xml)).toBe(true);
    expect(parseSitemapLocs(xml)).toEqual(["https://acme.example/sitemap-1.xml"]);
  });

  it("decodes &amp; in a query string", () => {
    const xml = `<urlset><url><loc>https://acme.example/search?q=a&amp;b=2</loc></url></urlset>`;
    expect(parseSitemapLocs(xml)).toEqual(["https://acme.example/search?q=a&b=2"]);
  });

  it("unwraps CDATA-wrapped <loc> values", () => {
    const xml = `<urlset><url><loc><![CDATA[https://acme.example/cdata?x=1&y=2]]></loc></url></urlset>`;
    expect(parseSitemapLocs(xml)).toEqual(["https://acme.example/cdata?x=1&y=2"]);
  });

  it("reads a namespace-prefixed <sitemap:loc>", () => {
    const xml = `<sitemap:urlset><sitemap:url><sitemap:loc>https://acme.example/</sitemap:loc></sitemap:url></sitemap:urlset>`;
    expect(parseSitemapLocs(xml)).toEqual(["https://acme.example/"]);
  });
});
