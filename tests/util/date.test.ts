import { describe, it, expect } from "vitest";
import { formatIsoDate, ymd } from "../../src/util/date.js";

describe("ymd", () => {
  it("is the UTC calendar date, not the local one", () => {
    expect(ymd(new Date("2026-10-19T23:30:00-07:00"))).toBe("2026-10-20");
    expect(ymd(new Date("2026-01-02T00:00:00Z"))).toBe("2026-01-02");
  });
});

describe("formatIsoDate", () => {
  it("writes the UTC date in long US form", () => {
    expect(formatIsoDate("2026-10-19T23:30:00-07:00")).toBe("October 20, 2026");
  });

  it("returns an unparseable timestamp unchanged rather than 'Invalid Date'", () => {
    expect(formatIsoDate("not-a-date")).toBe("not-a-date");
  });
});
