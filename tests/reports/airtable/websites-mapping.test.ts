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

describe("websites/mapRow → dashboardToken", () => {
  it("maps a non-empty Dashboard Token to dashboardToken", () => {
    expect(row({ "Dashboard Token": "abc123xyz" }).dashboardToken).toBe("abc123xyz");
  });

  it("returns null when the Dashboard Token field is absent", () => {
    expect(row({}).dashboardToken).toBeNull();
  });

  it("returns null when the Dashboard Token field is the empty string", () => {
    expect(row({ "Dashboard Token": "" }).dashboardToken).toBeNull();
  });

  it("trims surrounding whitespace (operators occasionally paste with newlines)", () => {
    expect(row({ "Dashboard Token": "  tok  \n" }).dashboardToken).toBe("tok");
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
