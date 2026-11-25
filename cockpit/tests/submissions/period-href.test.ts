import { describe, it, expect } from "vitest";
import { periodHref, periodLinks } from "../../src/routes/submissions/view.js";

/** P1-127: the one-click periods on /submissions. */
const NOW = new Date("2026-11-24T20:00:00Z"); // 12:00pm PT
const model = (filter: Record<string, string>) =>
  ({
    filter: { site: "", type: "", status: "", q: "", from: "", to: "", reason: "", ...filter },
  }) as never;

describe("periodHref", () => {
  it("starts the last 30 days where the leads panel's window starts (Pacific)", () => {
    expect(periodHref(model({}), 30, NOW)).toBe("/submissions?from=2026-10-25");
    expect(periodHref(model({}), 90, NOW)).toBe("/submissions?from=2026-08-26");
  });

  it("keeps every other filter, replaces the dates and drops the page", () => {
    expect(
      periodHref(
        model({ site: "acme", status: "new", from: "2025-01-01", to: "2025-02-01" }),
        30,
        NOW,
      ),
    ).toBe("/submissions?site=acme&status=new&from=2026-10-25");
  });

  it("all time clears the dates", () => {
    expect(periodHref(model({ site: "acme", from: "2026-10-25" }), null, NOW)).toBe(
      "/submissions?site=acme",
    );
    expect(periodHref(model({}), null, NOW)).toBe("/submissions");
  });
});

describe("periodLinks", () => {
  it("labels each link with the date it sets, not a window it does not count", () => {
    expect(periodLinks(model({ site: "acme" }), NOW)).toEqual([
      { label: "Since Oct 25", href: "/submissions?site=acme&from=2026-10-25" },
      { label: "Since Aug 26", href: "/submissions?site=acme&from=2026-08-26" },
      { label: "All time", href: "/submissions?site=acme" },
    ]);
  });
});
