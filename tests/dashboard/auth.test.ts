import { describe, it, expect } from "vitest";
import { verifyDashboardToken } from "../../src/dashboard/auth.js";

describe("verifyDashboardToken", () => {
  it("accepts an exact match", () => {
    expect(verifyDashboardToken("abc123", "abc123")).toBe(true);
  });

  it("rejects a single-char difference", () => {
    expect(verifyDashboardToken("abc123", "abc124")).toBe(false);
  });

  it("rejects a length mismatch (long vs short)", () => {
    expect(verifyDashboardToken("abc123", "abc1234")).toBe(false);
    expect(verifyDashboardToken("abc1234", "abc123")).toBe(false);
  });

  it("rejects when the expected token is null (site has no dashboard configured)", () => {
    expect(verifyDashboardToken("anything", null)).toBe(false);
  });

  it("rejects when the provided token is null/undefined/empty", () => {
    expect(verifyDashboardToken(null, "abc123")).toBe(false);
    expect(verifyDashboardToken(undefined, "abc123")).toBe(false);
    expect(verifyDashboardToken("", "abc123")).toBe(false);
  });

  it("rejects when both sides are null", () => {
    expect(verifyDashboardToken(null, null)).toBe(false);
  });
});
