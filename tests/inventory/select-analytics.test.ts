import { describe, it, expect } from "vitest";
import { selectFleetSites } from "../../src/inventory/select.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

/**
 * What the analytics audit needs from the roster: the row's GA4 property and
 * the `no analytics` opt-out (#936, spec D8), read through the same predicate
 * the setup check and the cockpit use.
 */
describe("selectFleetSites carries the analytics half of the row", () => {
  it("carries the GA4 property", () => {
    const [site] = selectFleetSites([makeWebsiteRow({ ga4PropertyId: "500039567" })], "/w");
    expect(site?.ga4PropertyId).toBe("500039567");
  });

  it("flags a site that accepts `no analytics`, in any spelling the setup check accepts", () => {
    for (const accepted of ["no analytics", "No Analytics ", "no-analytics", "ga4"]) {
      const [site] = selectFleetSites(
        [makeWebsiteRow({ acceptedWatchConditions: [accepted] })],
        "/w",
      );
      expect(site?.analyticsOptedOut).toBe(true);
    }
  });

  it("does not flag a site that accepted something else", () => {
    const [site] = selectFleetSites(
      [makeWebsiteRow({ acceptedWatchConditions: ["no search console", "Best Practices"] })],
      "/w",
    );
    expect(site).not.toHaveProperty("analyticsOptedOut");
  });
});
