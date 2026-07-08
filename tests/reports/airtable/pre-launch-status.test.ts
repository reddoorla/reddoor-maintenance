import { describe, it, expect } from "vitest";
import { isPreLaunch } from "../../../src/reports/airtable/websites.js";

describe("isPreLaunch", () => {
  it("is true for the pre-live stages", () => {
    expect(isPreLaunch("in development")).toBe(true);
    expect(isPreLaunch("launch period")).toBe(true);
  });

  it("is false for live and terminal stages", () => {
    expect(isPreLaunch("maintenance")).toBe(false);
    expect(isPreLaunch("hosting")).toBe(false);
    expect(isPreLaunch("deprecated")).toBe(false);
    expect(isPreLaunch("probably not our problem")).toBe(false);
  });

  it("is false for a null status (never treat unknown as pre-launch)", () => {
    expect(isPreLaunch(null)).toBe(false);
  });
});
