import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  extractQuestionOrder,
  extractReviews,
  extractServiceCategories,
  extractTeamOrder,
} from "../../src/webflow/indexes.js";

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf-8");

it("team order: 11 slugs, Dr. Quan first", () => {
  const slugs = extractTeamOrder(fx("our-team.html"));
  expect(slugs).toHaveLength(11);
  expect(slugs[0]).toBe("dr-robert-quan");
});

it("service categories: 4 groups covering all 24 services", () => {
  const cats = extractServiceCategories(fx("services-index.html"));
  expect(cats.map((c) => c.name)).toEqual([
    "Cosmetic Dentistry",
    "Restore Your Smile",
    "General Dentistry",
    "Specialty Services",
  ]);
  expect(cats.flatMap((c) => c.slugs)).toHaveLength(24);
  expect(cats[0]?.intro).toMatch(/Cosmetic dentistry focuses/);
});

it("question order: 40 slugs in page order", () => {
  const slugs = extractQuestionOrder(fx("ask-the-doctor.html"));
  expect(slugs).toHaveLength(40);
});

it("reviews: 5 items with quote/name/yelp url", () => {
  const reviews = extractReviews(fx("home.html"));
  expect(reviews).toHaveLength(5);
  expect(reviews[0]?.reviewerName).toBeTruthy();
  expect(reviews[0]?.quote.length).toBeGreaterThan(40);
  expect(reviews[0]?.reviewUrl).toContain("yelp.com");
});
