/** crawlSite composes the index + detail extractors into a full IR; collectAssets
 *  derives the dedupe'd content-image manifest the migration step downloads. */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { collectAssets, crawlSite } from "../../src/webflow/crawl.js";

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf-8");

const FIXTURE_BY_PATH: Record<string, string> = {
  "/": fx("home.html"),
  "/our-team": fx("our-team.html"),
  "/services": fx("services-index.html"),
  "/ask-the-doctor": fx("ask-the-doctor.html"),
};

it("crawlSite builds an IR from index pages + detail fetches", async () => {
  // Serve every detail path with a representative fixture — selector shapes are
  // identical across items of a collection (Webflow template pages).
  const fakeFetch = async (path: string) =>
    FIXTURE_BY_PATH[path] ??
    (path.startsWith("/team-members/")
      ? fx("team-dr-robert-quan.html")
      : path.startsWith("/services/")
        ? fx("service-dental-crowns.html")
        : fx("question-tooth-broke-off.html"));

  const ir = await crawlSite(
    "https://www.beachfrontdentistry.com",
    fakeFetch,
    () => "2026-07-27T00:00:00Z",
  );
  expect(ir.team).toHaveLength(11);
  expect(ir.services).toHaveLength(24);
  expect(ir.questions).toHaveLength(40);
  expect(ir.serviceCategories).toHaveLength(4);
  expect(ir.reviews).toHaveLength(5);
  expect(ir.questions[0]?.order).toBe(0);
  expect(ir.questions[0]?.slug).toBe("regular-dental-cleanings-support-your-whole-body-health");
  expect(ir.services[0]?.slug).toBe("tooth-discoloration");
  expect(ir.capturedAt).toBe("2026-07-27T00:00:00Z");
});

it("collectAssets dedupes content-CDN urls across the IR", () => {
  const ir = {
    team: [{ photo: { url: "https://cdn/x/a.jpg" } }, { photo: { url: "https://cdn/x/a.jpg" } }],
    services: [{ hero: { url: "https://cdn/x/b.jpg" } }],
    questions: [{ image: { url: "https://cdn/x/c.jpg" } }],
    reviews: [{ reviewerPhoto: { url: "https://cdn/x/d.jpg" } }],
  };
  const assets = collectAssets(ir as never);
  expect(assets.map((a) => a.url).sort()).toEqual([
    "https://cdn/x/a.jpg",
    "https://cdn/x/b.jpg",
    "https://cdn/x/c.jpg",
    "https://cdn/x/d.jpg",
  ]);
  expect(assets[0]?.filename).toBe("a.jpg");
});

it("collectAssets keeps percent-encoded filenames encoded (runMigration dedupe key)", () => {
  const ir = {
    team: [{ photo: { url: "https://cdn/x/logo%3Dwhite.svg" } }],
    services: [],
    questions: [],
    reviews: [],
  };
  const assets = collectAssets(ir as never);
  expect(assets).toEqual([{ url: "https://cdn/x/logo%3Dwhite.svg", filename: "logo%3Dwhite.svg" }]);
});
