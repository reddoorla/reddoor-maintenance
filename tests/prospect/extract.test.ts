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
