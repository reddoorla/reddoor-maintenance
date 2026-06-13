import { describe, it, expect } from "vitest";
import { resolveDashboardBaseUrl, resolveSlug } from "../../src/dashboard/handler-helpers.js";

describe("resolveDashboardBaseUrl", () => {
  it("falls back to the canonical Netlify URL when unset", () => {
    expect(resolveDashboardBaseUrl(undefined)).toBe("https://reddoor-maintenance.netlify.app");
  });
  it("falls back when the value is blank/whitespace", () => {
    expect(resolveDashboardBaseUrl("   ")).toBe("https://reddoor-maintenance.netlify.app");
  });
  it("trims and strips a single trailing slash from a custom value", () => {
    expect(resolveDashboardBaseUrl("  https://ops.reddoor.test/  ")).toBe(
      "https://ops.reddoor.test",
    );
  });
  it("leaves a no-trailing-slash value unchanged", () => {
    expect(resolveDashboardBaseUrl("https://ops.reddoor.test")).toBe("https://ops.reddoor.test");
  });
});

describe("resolveSlug", () => {
  it("prefers the path param", () => {
    expect(resolveSlug("acme", "ignored")).toBe("acme");
  });
  it("falls back to the query slug when no path param", () => {
    expect(resolveSlug(undefined, "acme")).toBe("acme");
  });
  it("returns null when neither is present (→ health check)", () => {
    expect(resolveSlug(undefined, null)).toBeNull();
  });
});
