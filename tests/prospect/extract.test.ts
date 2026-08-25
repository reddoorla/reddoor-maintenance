import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { extractPage } from "../../src/prospect/extract.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(here, "../fixtures/prospect", name), "utf-8");

describe("extractPage — a fully marked-up page", () => {
  const page = extractPage(fixture("rich.html"));

  it("reads the title, description and canonical", () => {
    expect(page.title).toBe("Acme Roofing — Commercial Roof Repair in Boise, Idaho");
    expect(page.metaDescription).toContain("Treasure Valley");
    expect(page.canonical).toBe("https://acme.example/");
  });

  it("collects only og:/twitter: metas as social", () => {
    expect(page.social["og:title"]).toBe("Acme Roofing");
    expect(page.social["og:image"]).toBe("https://acme.example/og.jpg");
    expect(page.social["twitter:card"]).toBe("summary_large_image");
    expect(page.social["description"]).toBeUndefined();
    expect(page.social["viewport"]).toBeUndefined();
  });

  it("reads headings in document order, flattening inline markup", () => {
    expect(page.headings).toEqual([
      { level: 1, text: "Commercial roof repair in Boise" },
      { level: 2, text: "What it costs" },
    ]);
  });

  it("captures JSON-LD blocks verbatim", () => {
    expect(page.jsonLd).toHaveLength(1);
    expect(JSON.parse(page.jsonLd[0]!)["@type"]).toBe("LocalBusiness");
  });

  it("counts images with a non-empty alt", () => {
    expect(page.images).toEqual({ total: 2, withAlt: 1 });
  });

  it("detects the viewport meta", () => {
    expect(page.hasViewportMeta).toBe(true);
  });

  it("returns word-separated visible text without script or head content", () => {
    expect(page.text).toContain("roof repair in Boise We repair flat commercial roofs");
    expect(page.text).not.toContain("should not appear in text");
    expect(page.text).not.toContain("Acme Roofing — Commercial");
    expect(page.text).not.toContain("<!doctype");
  });
});

describe("extractPage — a client-rendered shell", () => {
  const page = extractPage(fixture("bare.html"));

  it("has a title but no body text, headings or schema", () => {
    expect(page.title).toBe("Acme");
    expect(page.text).toBe("");
    expect(page.headings).toEqual([]);
    expect(page.jsonLd).toEqual([]);
  });

  it("reports the missing description and canonical as null", () => {
    expect(page.metaDescription).toBeNull();
    expect(page.canonical).toBeNull();
  });
});

describe("extractPage — text rendered the way a browser does", () => {
  it("skips a <template> stamp's headings, images and schema entirely, while a real sibling heading still counts", () => {
    const page = extractPage(
      '<template><h1>Phantom</h1><img src="/x.jpg" alt="phantom"><script type="application/ld+json">{"a":1}</script></template><h1>Real</h1>',
    );
    expect(page.headings).toEqual([{ level: 1, text: "Real" }]);
    expect(page.images).toEqual({ total: 0, withAlt: 0 });
    expect(page.jsonLd).toEqual([]);
  });

  it("does not insert a space between adjacent inline runs", () => {
    const page = extractPage("<p>Welcome to <b>Acme</b>Corp today.</p>");
    expect(page.text).toContain("AcmeCorp");
  });

  it("does not insert a space before trailing punctuation split across inline elements", () => {
    const page = extractPage('<p>Call <a href="tel:+12085550199">208-555-0199</a>. Now.</p>');
    expect(page.text).toContain("208-555-0199.");
  });

  it("still separates adjacent block elements with no whitespace between them in the source", () => {
    const page = extractPage("<p>alpha</p><p>beta</p>");
    expect(page.text).toBe("alpha beta");
  });

  it("breaks a heading at a <br> instead of jamming the two lines together", () => {
    const page = extractPage("<h1>Big Bold<br>Headline</h1>");
    expect(page.headings).toEqual([{ level: 1, text: "Big Bold Headline" }]);
  });

  it("reads a <title> misplaced inside <body> into page.title but keeps it out of text", () => {
    const page = extractPage("<body><title>Sneaky</title><p>Hello</p></body>");
    expect(page.title).toBe("Sneaky");
    expect(page.text).not.toContain("Sneaky");
  });
});
