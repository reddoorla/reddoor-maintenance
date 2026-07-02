import { describe, it, expect } from "vitest";
import { mapRow, parseSecurityAdvisories } from "../../../src/reports/airtable/websites.js";

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

  it("maps Deps Major Outdated (how many are a major behind npm latest)", () => {
    expect(row({ "Deps Major Outdated": 2 }).depsMajorOutdated).toBe(2);
    expect(row({ "Deps Major Outdated": 0 }).depsMajorOutdated).toBe(0);
    expect(row({}).depsMajorOutdated).toBeNull();
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

  it("parses the Security advisories JSON cell into a typed list", () => {
    const r = row({
      "Security advisories": JSON.stringify([
        { module: "axios", severity: "high", title: "ReDoS", cves: ["CVE-2"], url: "https://a" },
      ]),
    });
    expect(r.securityAdvisories).toEqual([
      { module: "axios", severity: "high", title: "ReDoS", cves: ["CVE-2"], url: "https://a" },
    ]);
  });

  it("treats an absent advisories cell as null (never audited)", () => {
    expect(row({}).securityAdvisories).toBeNull();
  });

  it("maps Security Auto-Fix Attempts (number, null when absent)", () => {
    expect(row({ "Security Auto-Fix Attempts": 3 }).securityAutoFixAttempts).toBe(3);
    expect(row({ "Security Auto-Fix Attempts": 0 }).securityAutoFixAttempts).toBe(0);
    expect(row({}).securityAutoFixAttempts).toBeNull();
  });
});

describe("parseSecurityAdvisories", () => {
  it("returns null for absent / blank / unparseable / non-array input", () => {
    expect(parseSecurityAdvisories(undefined)).toBeNull();
    expect(parseSecurityAdvisories("")).toBeNull();
    expect(parseSecurityAdvisories("   ")).toBeNull();
    expect(parseSecurityAdvisories("{not json")).toBeNull();
    expect(parseSecurityAdvisories(JSON.stringify({ not: "an array" }))).toBeNull();
  });

  it("returns an empty array for a clean run ('[]') — audited, no vulns", () => {
    expect(parseSecurityAdvisories("[]")).toEqual([]);
  });

  it("drops malformed entries and defaults cves/url", () => {
    const out = parseSecurityAdvisories(
      JSON.stringify([
        { module: "ok", severity: "low" }, // kept, defaulted
        { severity: "high" }, // dropped — no module
        { module: "x", severity: "nope" }, // dropped — bad severity
      ]),
    );
    expect(out).toEqual([{ module: "ok", severity: "low", title: "", cves: [], url: null }]);
  });

  it("preserves a runtime/development dependency scope, omits an absent or invalid one", () => {
    const out = parseSecurityAdvisories(
      JSON.stringify([
        {
          module: "shell-quote",
          severity: "critical",
          title: "x",
          cves: [],
          url: null,
          scope: "development",
        },
        { module: "cookie", severity: "low", title: "y", cves: [], url: null, scope: "runtime" },
        { module: "axios", severity: "high", title: "z", cves: [], url: null }, // no scope key
        { module: "weird", severity: "low", title: "w", cves: [], url: null, scope: "garbage" }, // invalid → omitted
      ]),
    );
    expect(out).toEqual([
      {
        module: "shell-quote",
        severity: "critical",
        title: "x",
        cves: [],
        url: null,
        scope: "development",
      },
      { module: "cookie", severity: "low", title: "y", cves: [], url: null, scope: "runtime" },
      { module: "axios", severity: "high", title: "z", cves: [], url: null },
      { module: "weird", severity: "low", title: "w", cves: [], url: null },
    ]);
  });
});

describe("websites/mapRow → requireTurnstile (ships dark, boolean guard)", () => {
  it("maps Require Turnstile true when the column is boolean true", () => {
    expect(row({ "Require Turnstile": true }).requireTurnstile).toBe(true);
  });

  it("maps Require Turnstile false when the column is boolean false", () => {
    expect(row({ "Require Turnstile": false }).requireTurnstile).toBe(false);
  });

  it("defaults to false when the column is absent (ships dark)", () => {
    expect(row({}).requireTurnstile).toBe(false);
  });

  it("defaults to false for a non-boolean value (never coerces a truthy string)", () => {
    expect(row({ "Require Turnstile": "true" }).requireTurnstile).toBe(false);
    expect(row({ "Require Turnstile": 1 }).requireTurnstile).toBe(false);
  });
});
