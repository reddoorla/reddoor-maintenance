import { describe, it, expect } from "vitest";
import { defaultReportSubject } from "../../src/reports/subject.js";

const DATE = new Date("2026-05-26T12:00:00Z");

describe("defaultReportSubject", () => {
  it("announcement: full name with bare (www-stripped) domain", () => {
    expect(
      defaultReportSubject({
        name: "Acme Co",
        url: "https://www.acme.example.com/",
        type: "Announcement",
        date: DATE,
      }),
    ).toBe("Your testing & maintenance report for Acme Co (acme.example.com)");
  });
  it("announcement: falls back to name alone when the URL can't be parsed", () => {
    expect(
      defaultReportSubject({ name: "Acme Co", url: "not a url", type: "Announcement", date: DATE }),
    ).toBe("Your testing & maintenance report for Acme Co");
  });
  it("maintenance/testing: name — Month YYYY Type Report (UTC)", () => {
    expect(
      defaultReportSubject({ name: "Acme Co", url: "x", type: "Maintenance", date: DATE }),
    ).toBe("Acme Co — May 2026 Maintenance Report");
    expect(defaultReportSubject({ name: "Acme Co", url: "x", type: "Testing", date: DATE })).toBe(
      "Acme Co — May 2026 Testing Report",
    );
  });
});
