import { describe, it, expect } from "vitest";
import { DEFAULT_COPY, resolveCopy } from "../../src/reports/copy.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

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

  it("exposes launch copy defaults", () => {
    expect(DEFAULT_COPY.launchHeading).toBe("LAUNCHED");
    expect(typeof DEFAULT_COPY.launchBody).toBe("string");
    expect(Array.isArray(DEFAULT_COPY.launchSetupItems)).toBe(true);
    expect(DEFAULT_COPY.launchSetupItems.length).toBeGreaterThan(0);
  });

  it("exposes announcement copy defaults", () => {
    expect(DEFAULT_COPY.announceHeading).toBe("YOUR MONTHLY REPORT");
    expect(DEFAULT_COPY.announceMonitorItems).toHaveLength(4);
  });

  it("passes the announce* keys through resolveCopy unchanged", () => {
    const c = resolveCopy(makeWebsiteRow({}));
    expect(c.announceHeading).toBe(DEFAULT_COPY.announceHeading);
    expect(c.announceBody).toBe(DEFAULT_COPY.announceBody);
    expect(c.announceMonitorItems).toEqual(DEFAULT_COPY.announceMonitorItems);
    expect(c.announcePreviewLabel).toBe(DEFAULT_COPY.announcePreviewLabel);
    expect(c.announceImprovementResend).toBe(DEFAULT_COPY.announceImprovementResend);
    expect(c.announceImprovementSvelte5).toBe(DEFAULT_COPY.announceImprovementSvelte5);
    expect(c.announceCadence).toBe(DEFAULT_COPY.announceCadence);
    expect(c.announceOpenDoor).toBe(DEFAULT_COPY.announceOpenDoor);
  });
});
