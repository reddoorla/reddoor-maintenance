import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
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

it("team order: repeated links dedupe to first-occurrence order", () => {
  const html =
    '<a href="/team-members/a"></a><a href="/team-members/b"></a>' +
    '<a href="/team-members/a"></a><a href="/team-members/c"></a>' +
    '<a href="/team-members/b"></a>';
  expect(extractTeamOrder(html)).toEqual(["a", "b", "c"]);
});

it("team order: throws when no /team-members/ links match", () => {
  expect(() => extractTeamOrder('<main><a href="/services/x">x</a></main>')).toThrowError(
    "team order: no /team-members/ links found — page shape may have changed",
  );
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
  const byName = new Map(cats.map((c) => [c.name, c.slugs]));
  expect(byName.get("Cosmetic Dentistry")).toContain("dental-veneers");
  expect(byName.get("Restore Your Smile")).toContain("dental-crowns");
});

it("service categories: drops a heading with no service links", () => {
  const html =
    '<h3 class="mb-4">Empty Group</h3><p class="para-20px">Intro that goes nowhere.</p>' +
    '<h3 class="mb-4">Real Group</h3><p class="para-20px">Real intro.</p>' +
    '<a href="/services/one">One</a>';
  expect(extractServiceCategories(html)).toEqual([
    { name: "Real Group", intro: "Real intro.", slugs: ["one"] },
  ]);
});

it("service categories: throws when no populated category exists", () => {
  expect(() => extractServiceCategories('<h3 class="mb-4">Lonely</h3>')).toThrowError(
    "service categories: no h3.mb-4 group with /services/ links found — page shape may have changed",
  );
});

it("question order: 40 slugs in page order", () => {
  const slugs = extractQuestionOrder(fx("ask-the-doctor.html"));
  expect(slugs).toHaveLength(40);
  expect(slugs[0]).toBe("regular-dental-cleanings-support-your-whole-body-health");
  expect(slugs[39]).toBe("why-do-teeth-hurt-more-at-night");
});

it("question order: throws when no /questions/ links match", () => {
  expect(() => extractQuestionOrder("<main></main>")).toThrowError(
    "question order: no /questions/ links found — page shape may have changed",
  );
});

it("reviews: 5 items with quote/name/yelp url", () => {
  const reviews = extractReviews(fx("home.html"));
  expect(reviews).toHaveLength(5);
  expect(reviews[0]?.reviewerName).toBeTruthy();
  expect(reviews[0]?.quote.length).toBeGreaterThan(40);
  expect(reviews[0]?.reviewUrl).toContain("yelp.com");
});

it("reviews: returns [] and warns when no .big-review-item matches", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(extractReviews("<main></main>")).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(".big-review-item"));
  } finally {
    warn.mockRestore();
  }
});
