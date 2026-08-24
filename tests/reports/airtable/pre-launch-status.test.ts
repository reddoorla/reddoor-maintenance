import { describe, it, expect } from "vitest";
import { isPreLaunch } from "../../../src/reports/airtable/websites.js";

describe("isPreLaunch", () => {
  it("is true for the pre-live stages", () => {
    expect(isPreLaunch("building")).toBe(true);
    expect(isPreLaunch("launching")).toBe(true);
  });

  it("is false for live and terminal stages", () => {
    expect(isPreLaunch("maintained")).toBe(false);
    expect(isPreLaunch("hosted-only")).toBe(false);
    expect(isPreLaunch("archived")).toBe(false);
    expect(isPreLaunch("external")).toBe(false);
  });

  it("is false for a null status (never treat unknown as pre-launch)", () => {
    expect(isPreLaunch(null)).toBe(false);
  });
});
