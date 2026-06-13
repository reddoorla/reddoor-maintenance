import { describe, it, expect } from "vitest";
import { siteLabel } from "../../src/util/site.js";

describe("siteLabel", () => {
  it("prefers the inventory name", () => {
    expect(siteLabel({ path: "/tmp/caltex", name: "caltex-landing" })).toBe("caltex-landing");
  });

  it("falls back to the path when name is undefined", () => {
    expect(siteLabel({ path: "/tmp/site" })).toBe("/tmp/site");
  });

  it("falls back to the path when name is the EMPTY string (|| not ??)", () => {
    // An Airtable Name that slugs to "" must not render a blank label — `??`
    // would have let the empty string through.
    expect(siteLabel({ path: "/tmp/site", name: "" })).toBe("/tmp/site");
  });
});
