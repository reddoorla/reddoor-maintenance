import { describe, it, expect } from "vitest";
import { DEFAULT_COPY, resolveCopy } from "../../src/reports/copy.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

// Minimal WebsiteRow with the 3 copy override fields; controller provides the full factory.
function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    copyIntro: null,
    copyContact: null,
    copyFooter: null,
    name: "Acme",
    id: "rec1",
    ...over,
  } as WebsiteRow;
}

describe("resolveCopy", () => {
  it("with no overrides returns the defaults verbatim", () => {
    const c = resolveCopy(site());
    expect(c).toEqual(DEFAULT_COPY);
  });

  it("overrides the maintenance intro from copyIntro", () => {
    const c = resolveCopy(site({ copyIntro: "Custom intro." }));
    expect(c.maintenanceIntro).toBe("Custom intro.");
    expect(c.maintenanceChecks).toEqual(DEFAULT_COPY.maintenanceChecks); // untouched
  });

  it("splits a multi-line contact override into lines", () => {
    const c = resolveCopy(site({ copyContact: "Line one\nLine two" }));
    expect(c.contact).toEqual(["Line one", "Line two"]);
  });

  it("footer override: first line → org, rest → address lines", () => {
    const c = resolveCopy(site({ copyFooter: "Beta LLC\n1 Main St\nAustin, TX 78701" }));
    expect(c.footerOrg).toBe("Beta LLC");
    expect(c.footerAddress).toEqual(["1 Main St", "Austin, TX 78701"]);
  });

  it("treats a blank/whitespace override as absent (keeps default)", () => {
    const c = resolveCopy(site({ copyIntro: "   " }));
    expect(c.maintenanceIntro).toBe(DEFAULT_COPY.maintenanceIntro);
  });
});
