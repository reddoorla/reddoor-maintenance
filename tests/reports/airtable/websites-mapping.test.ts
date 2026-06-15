import { describe, it, expect } from "vitest";
import { mapRow } from "../../../src/reports/airtable/websites.js";

function row(fields: Record<string, unknown>) {
  return mapRow({
    id: "recTEST",
    fields: {
      Name: "Acme",
      ...fields,
    },
  });
}

describe("websites/mapRow → copy override fields", () => {
  it("maps non-empty Copy — Intro/Contact/Footer (em-dash column names)", () => {
    const r = row({
      "Copy — Intro": "custom intro",
      "Copy — Contact": "custom contact",
      "Copy — Footer": "custom footer",
    });
    expect(r.copyIntro).toBe("custom intro");
    expect(r.copyContact).toBe("custom contact");
    expect(r.copyFooter).toBe("custom footer");
  });

  it("returns null when the copy fields are absent", () => {
    const r = row({});
    expect(r.copyIntro).toBeNull();
    expect(r.copyContact).toBeNull();
    expect(r.copyFooter).toBeNull();
  });

  it("trims and treats blank copy fields as null", () => {
    expect(row({ "Copy — Intro": "" }).copyIntro).toBeNull();
    expect(row({ "Copy — Contact": "   \n" }).copyContact).toBeNull();
    expect(row({ "Copy — Footer": "  body  " }).copyFooter).toBe("body");
  });
});

describe("websites/mapRow → new metric fields", () => {
  it("maps A11y Violations", () => {
    expect(row({ "A11y Violations": 3 }).a11yViolations).toBe(3);
    expect(row({}).a11yViolations).toBeNull();
    expect(row({ "A11y Violations": 0 }).a11yViolations).toBe(0);
  });

  it("maps Deps Drifted and Deps Major Behind", () => {
    const r = row({ "Deps Drifted": 5, "Deps Major Behind": 1 });
    expect(r.depsDrifted).toBe(5);
    expect(r.depsMajorBehind).toBe(1);
    expect(row({}).depsDrifted).toBeNull();
    expect(row({}).depsMajorBehind).toBeNull();
  });

  it("maps Deps Outdated (the real installed-version drift signal)", () => {
    expect(row({ "Deps Outdated": 7 }).depsOutdated).toBe(7);
    expect(row({}).depsOutdated).toBeNull();
  });

  it("maps the four Security Vulns severity counts", () => {
    const r = row({
      "Security Vulns Critical": 1,
      "Security Vulns High": 2,
      "Security Vulns Moderate": 3,
      "Security Vulns Low": 4,
    });
    expect(r.securityVulnsCritical).toBe(1);
    expect(r.securityVulnsHigh).toBe(2);
    expect(r.securityVulnsModerate).toBe(3);
    expect(r.securityVulnsLow).toBe(4);
  });

  it("returns nulls (not zeros) for missing severity counts", () => {
    const r = row({});
    expect(r.securityVulnsCritical).toBeNull();
    expect(r.securityVulnsHigh).toBeNull();
    expect(r.securityVulnsModerate).toBeNull();
    expect(r.securityVulnsLow).toBeNull();
  });
});
